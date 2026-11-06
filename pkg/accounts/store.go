// Package accounts provides persistent account records for accounts authentication.
package accounts

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/LosFurina/tmuxatlas/pkg/paths"
	"golang.org/x/crypto/bcrypt"
	"golang.org/x/sys/unix"
)

var (
	ErrInvalidUsername   = errors.New("nom d'utilisateur invalide")
	ErrDuplicateUsername = errors.New("nom d'utilisateur déjà utilisé")
	ErrNotFound          = errors.New("compte introuvable")
	ErrInvalidHash       = errors.New("hash bcrypt invalide")
)

func ValidUsername(username string) bool {
	return usernamePattern.MatchString(username)
}

var usernamePattern = regexp.MustCompile(`^[a-zA-Z0-9._-]{2,32}$`)

type User struct {
	ID                string    `json:"id"`
	Username          string    `json:"username"`
	PasswordHash      string    `json:"password_hash"`
	Role              string    `json:"role"`
	Disabled          bool      `json:"disabled"`
	CreatedAt         time.Time `json:"created_at"`
	PasswordChangedAt time.Time `json:"password_changed_at"`
}

type Store struct {
	mu   sync.Mutex
	path string
}

func NewStore() (*Store, error) {
	dir, err := paths.ConfigDir()
	if err != nil {
		return nil, err
	}
	return OpenStore(filepath.Join(dir, "users.json")), nil
}

func OpenStore(path string) *Store { return &Store{path: path} }

// withLock serializes reads and updates across Store instances and processes.
func (s *Store) withLock(fn func([]User) ([]User, bool, error)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return err
	}
	lock, err := os.OpenFile(s.path+".lock", os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return err
	}
	defer lock.Close()
	if err := unix.Flock(int(lock.Fd()), unix.LOCK_EX); err != nil {
		return err
	}
	defer unix.Flock(int(lock.Fd()), unix.LOCK_UN)
	var users []User
	raw, err := os.ReadFile(s.path)
	if err == nil {
		if err := json.Unmarshal(raw, &users); err != nil {
			return fmt.Errorf("lecture des comptes : %w", err)
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	updated, changed, err := fn(users)
	if err != nil || !changed {
		return err
	}
	raw, err = json.MarshalIndent(updated, "", "  ")
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(s.path), ".users-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if err = f.Chmod(0o600); err == nil {
		_, err = f.Write(raw)
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if err := os.Rename(f.Name(), s.path); err != nil {
		return err
	}
	dir, err := os.Open(filepath.Dir(s.path))
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}

func (s *Store) List() ([]User, error) {
	var result []User
	err := s.withLock(func(users []User) ([]User, bool, error) {
		result = append([]User{}, users...)
		return nil, false, nil
	})
	return result, err
}

// Create stores a validated bcrypt hash. Password hashes must never be exposed by API handlers.
func (s *Store) Create(username, hash, role string) (User, error) {
	if !usernamePattern.MatchString(username) {
		return User{}, ErrInvalidUsername
	}
	if _, err := bcrypt.Cost([]byte(hash)); err != nil {
		return User{}, ErrInvalidHash
	}
	if role != "admin" && role != "user" {
		return User{}, errors.New("rôle invalide")
	}
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		return User{}, err
	}
	now := time.Now().UTC()
	user := User{ID: hex.EncodeToString(id[:]), Username: username, PasswordHash: hash, Role: role, CreatedAt: now, PasswordChangedAt: now}
	err := s.withLock(func(users []User) ([]User, bool, error) {
		for _, existing := range users {
			if strings.EqualFold(existing.Username, username) {
				return nil, false, ErrDuplicateUsername
			}
		}
		return append(users, user), true, nil
	})
	if err != nil {
		return User{}, err
	}
	return user, nil
}

// BootstrapAdmin creates an administrator or replaces the existing administrator
// when force is set. The decision and update are made under the same file lock.
func (s *Store) BootstrapAdmin(username, hash string, force bool) (User, error) {
	if !usernamePattern.MatchString(username) {
		return User{}, ErrInvalidUsername
	}
	if _, err := bcrypt.Cost([]byte(hash)); err != nil {
		return User{}, ErrInvalidHash
	}
	var result User
	err := s.withLock(func(users []User) ([]User, bool, error) {
		admin := -1
		for i, user := range users {
			if user.Role == "admin" && admin == -1 {
				admin = i
			}
			if strings.EqualFold(user.Username, username) && user.Role != "admin" {
				return nil, false, ErrDuplicateUsername
			}
		}
		if admin >= 0 && !force {
			return nil, false, errors.New("un administrateur existe déjà ; utilisez --force")
		}
		for i, user := range users {
			if strings.EqualFold(user.Username, username) && i != admin {
				return nil, false, ErrDuplicateUsername
			}
		}
		now := time.Now().UTC()
		if admin >= 0 {
			result = users[admin]
			result.Username = username
			result.PasswordHash = hash
			result.PasswordChangedAt = now
			result.Disabled = false
			users[admin] = result
			return users, true, nil
		}
		var id [16]byte
		if _, err := rand.Read(id[:]); err != nil {
			return nil, false, err
		}
		result = User{ID: hex.EncodeToString(id[:]), Username: username, PasswordHash: hash, Role: "admin", CreatedAt: now, PasswordChangedAt: now}
		return append(users, result), true, nil
	})
	return result, err
}

var ErrProtectedAdmin = errors.New("opération interdite sur cet administrateur")

// Update modifies one account while enforcing the last-administrator invariant.
// A nil disabled value leaves the state unchanged. An empty hash leaves the
// password unchanged. The actor cannot disable their own account.
func (s *Store) Update(id, actor, hash string, disabled *bool) (User, error) {
	if hash != "" {
		if _, err := bcrypt.Cost([]byte(hash)); err != nil {
			return User{}, ErrInvalidHash
		}
	}
	var result User
	err := s.withLock(func(users []User) ([]User, bool, error) {
		for i := range users {
			if users[i].ID != id {
				continue
			}
			if disabled != nil && *disabled && !users[i].Disabled {
				if id == actor || (users[i].Role == "admin" && activeAdmins(users) <= 1) {
					return nil, false, ErrProtectedAdmin
				}
			}
			if disabled != nil {
				users[i].Disabled = *disabled
			}
			if hash != "" {
				users[i].PasswordHash = hash
				users[i].PasswordChangedAt = time.Now().UTC()
			}
			result = users[i]
			return users, true, nil
		}
		return nil, false, ErrNotFound
	})
	return result, err
}

// Delete removes an account without allowing self-deletion or removal of the
// last enabled administrator.
func (s *Store) Delete(id, actor string) error {
	return s.DeleteWith(id, actor, nil)
}

// DeleteWith calls beforeDelete after validating the deletion, under the same
// lock as the account update. If the callback fails, the account remains.
// The callback should be idempotent because an interrupted release can be
// retried. It must not call the account store.
func (s *Store) DeleteWith(id, actor string, beforeDelete func() error) error {
	return s.withLock(func(users []User) ([]User, bool, error) {
		for i, user := range users {
			if user.ID != id {
				continue
			}
			if id == actor || (user.Role == "admin" && !user.Disabled && activeAdmins(users) <= 1) {
				return nil, false, ErrProtectedAdmin
			}
			if beforeDelete != nil {
				if err := beforeDelete(); err != nil {
					return nil, false, err
				}
			}
			return append(users[:i], users[i+1:]...), true, nil
		}
		return nil, false, ErrNotFound
	})
}

func activeAdmins(users []User) int {
	count := 0
	for _, user := range users {
		if user.Role == "admin" && !user.Disabled {
			count++
		}
	}
	return count
}

// UpgradeHash replaces only the hash that was verified, under the store lock.
func (s *Store) UpgradeHash(id, oldHash, newHash string) error {
	return s.withLock(func(users []User) ([]User, bool, error) {
		for i := range users {
			if users[i].ID == id && users[i].PasswordHash == oldHash && !users[i].Disabled {
				users[i].PasswordHash = newHash
				return users, true, nil
			}
		}
		return nil, false, ErrNotFound
	})
}
