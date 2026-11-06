package accounts

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func TestDeleteWithValidatesBeforeReleaseAndKeepsUserOnFailure(t *testing.T) {
	store := OpenStore(filepath.Join(t.TempDir(), "users.json"))
	hash, err := bcrypt.GenerateFromPassword([]byte("mot de passe"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	admin, err := store.Create("admin", string(hash), "admin")
	if err != nil {
		t.Fatal(err)
	}
	user, err := store.Create("alice", string(hash), "user")
	if err != nil {
		t.Fatal(err)
	}
	called := false
	if err := store.DeleteWith(admin.ID, admin.ID, func() error {
		called = true
		return nil
	}); !errors.Is(err, ErrProtectedAdmin) || called {
		t.Fatalf("protected deletion: err=%v, callback=%v", err, called)
	}
	releaseErr := errors.New("release failed")
	if err := store.DeleteWith(user.ID, admin.ID, func() error { return releaseErr }); !errors.Is(err, releaseErr) {
		t.Fatalf("release error lost: %v", err)
	}
	users, err := store.List()
	if err != nil || len(users) != 2 {
		t.Fatalf("failed release removed user: %v, %v", users, err)
	}
	if err := store.DeleteWith(user.ID, admin.ID, func() error {
		called = true
		return nil
	}); err != nil || !called {
		t.Fatalf("successful deletion: err=%v, callback=%v", err, called)
	}
}

func TestStorePermissionsAndUniqueness(t *testing.T) {
	path := filepath.Join(t.TempDir(), "users.json")
	hash, err := bcrypt.GenerateFromPassword([]byte("unmotdepasse"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	const count = 12
	var wg sync.WaitGroup
	errs := make(chan error, count)
	for i := 0; i < count; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := OpenStore(path).Create("Alice", string(hash), "user")
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	successes := 0
	for err := range errs {
		if err == nil {
			successes++
		} else if !errors.Is(err, ErrDuplicateUsername) {
			t.Fatal(err)
		}
	}
	if successes != 1 {
		t.Fatalf("successes = %d", successes)
	}
	if _, err := OpenStore(path).Create("alice", string(hash), "user"); !errors.Is(err, ErrDuplicateUsername) {
		t.Fatalf("case-insensitive duplicate: %v", err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("permissions: %o", info.Mode().Perm())
	}
}

func TestStoreAtomicVisibility(t *testing.T) {
	path := filepath.Join(t.TempDir(), "users.json")
	store := OpenStore(path)
	hash, err := bcrypt.GenerateFromPassword([]byte("unmotdepasse"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Create("initial", string(hash), "admin"); err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		for i := 0; i < 30; i++ {
			name := string(rune('a'+i/26)) + string(rune('a'+i%26))
			if _, err := store.Create(name, string(hash), "user"); err != nil {
				t.Error(err)
				return
			}
		}
	}()
	for {
		select {
		case <-done:
			return
		default:
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		var users []User
		if err := json.Unmarshal(raw, &users); err != nil {
			t.Fatalf("partial file: %v", err)
		}
	}
}

func TestBootstrapAndAdminProtection(t *testing.T) {
	store := OpenStore(filepath.Join(t.TempDir(), "users.json"))
	hash, err := bcrypt.GenerateFromPassword([]byte("un-mot-de-passe"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	admin, err := store.BootstrapAdmin("admin", string(hash), false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.BootstrapAdmin("autre", string(hash), false); err == nil {
		t.Fatal("un second amorçage sans force a réussi")
	}
	if err := store.Delete(admin.ID, "autre"); !errors.Is(err, ErrProtectedAdmin) {
		t.Fatalf("suppression du dernier admin : %v", err)
	}
	disabled := true
	if _, err := store.Update(admin.ID, "autre", "", &disabled); !errors.Is(err, ErrProtectedAdmin) {
		t.Fatalf("désactivation du dernier admin : %v", err)
	}
	replaced, err := store.BootstrapAdmin("autre", string(hash), true)
	if err != nil || replaced.ID != admin.ID {
		t.Fatalf("remplacement : %+v, %v", replaced, err)
	}
}
