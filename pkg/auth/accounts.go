package auth

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/LosFurina/tmuxatlas/pkg/accounts"
	"golang.org/x/crypto/bcrypt"
)

type accountContextKey struct{}

type AccountIdentity struct {
	User  accounts.User
	Token string
	Done  <-chan struct{}
}

func AccountFromContext(ctx context.Context) (AccountIdentity, bool) {
	identity, ok := ctx.Value(accountContextKey{}).(AccountIdentity)
	return identity, ok
}

type loginFailures struct {
	count int
	until time.Time
	last  time.Time
}

type AccountsAuth struct {
	Store     *accounts.Store
	Sessions  *SessionManager
	lifecycle sync.RWMutex
	mu        sync.Mutex
	failures  map[string]loginFailures
	dummyHash string
}

func NewAccountsAuth(store *accounts.Store, sessions *SessionManager) (*AccountsAuth, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte("atlas-dummy-password"), 12)
	if err != nil {
		return nil, err
	}
	return &AccountsAuth{Store: store, Sessions: sessions, failures: make(map[string]loginFailures), dummyHash: string(hash)}, nil
}

func trustedLoopback(remote string) bool {
	host, _, err := net.SplitHostPort(remote)
	if err != nil {
		return false
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func accountRequestSecure(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	return trustedLoopback(r.RemoteAddr) && strings.EqualFold(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")), "https")
}

func ClientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	if trustedLoopback(r.RemoteAddr) {
		parts := strings.Split(r.Header.Get("X-Forwarded-For"), ",")
		for i := len(parts) - 1; i >= 0; i-- {
			ip := net.ParseIP(strings.TrimSpace(parts[i]))
			if ip == nil {
				break
			}
			host = ip.String()
			if !ip.IsLoopback() {
				break
			}
		}
	}
	return host
}

func accountClientIP(r *http.Request) string { return ClientIP(r) }

func (a *AccountsAuth) blocked(keys ...string) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	now := time.Now()
	for key, value := range a.failures {
		if now.Sub(value.last) > 30*time.Minute {
			delete(a.failures, key)
		}
	}
	for _, key := range keys {
		if now.Before(a.failures[key].until) {
			return true
		}
	}
	return false
}

func (a *AccountsAuth) failed(keys ...string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	now := time.Now()
	for _, key := range keys {
		entry := a.failures[key]
		entry.count++
		entry.last = now
		if entry.count >= 3 {
			delay := time.Second << min(entry.count-3, 6)
			if entry.count >= 8 {
				delay = 5 * time.Minute
			}
			entry.until = now.Add(delay)
		}
		a.failures[key] = entry
	}
}

func (a *AccountsAuth) identity(r *http.Request) (AccountIdentity, bool) {
	token := SessionCookie(r)
	id, done, valid := a.Sessions.AccountSession(token)
	if !valid || id == "" {
		return AccountIdentity{}, false
	}
	users, err := a.Store.List()
	if err != nil {
		return AccountIdentity{}, false
	}
	for _, user := range users {
		if user.ID == id && !user.Disabled {
			return AccountIdentity{User: user, Token: token, Done: done}, true
		}
	}
	a.Sessions.Revoke(token)
	return AccountIdentity{}, false
}

func (a *AccountsAuth) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		identity, ok := a.identity(r)
		if !ok {
			writeError(w, http.StatusUnauthorized, "authentification requise")
			return
		}
		SetSessionCookie(w, identity.Token, a.Sessions.TTL(), accountRequestSecure(r))
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), accountContextKey{}, identity)))
	})
}

func (a *AccountsAuth) Status(w http.ResponseWriter, r *http.Request) {
	identity, ok := a.identity(r)
	result := map[string]any{"mode": "accounts", "authenticated": ok, "username": "", "role": ""}
	if ok {
		result["username"] = identity.User.Username
		result["role"] = identity.User.Role
		result["csrf_token"], _ = a.Sessions.CSRF(identity.Token)
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(result)
}

// Logout removes the current browser session and expires its cookie using the
// same transport-security decision as login.
func (a *AccountsAuth) Logout(w http.ResponseWriter, r *http.Request) {
	LogoutHandler(a.Sessions, accountRequestSecure(r))(w, r)
}

func (a *AccountsAuth) Login(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if json.NewDecoder(r.Body).Decode(&request) != nil {
		writeError(w, http.StatusBadRequest, "requête invalide")
		return
	}
	ip := ClientIP(r)
	keys := []string{"ip:" + ip, "pair:" + ip + "\x00" + strings.ToLower(request.Username)}
	if a.blocked(keys...) {
		writeError(w, http.StatusTooManyRequests, "trop de tentatives")
		return
	}
	a.lifecycle.RLock()
	defer a.lifecycle.RUnlock()
	users, err := a.Store.List()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "erreur interne")
		return
	}
	var found *accounts.User
	for i := range users {
		if strings.EqualFold(users[i].Username, request.Username) {
			found = &users[i]
			break
		}
	}
	hash := a.dummyHash
	if found != nil {
		hash = found.PasswordHash
	}
	valid := accounts.VerifyPassword(hash, request.Password)
	if !valid || found == nil || found.Disabled {
		a.failed(keys...)
		writeError(w, http.StatusUnauthorized, "identifiants invalides")
		return
	}
	if cost, err := bcrypt.Cost([]byte(found.PasswordHash)); err == nil && cost != 12 {
		hash, err := accounts.RehashPassword(request.Password)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "erreur interne")
			return
		}
		if err := a.Store.UpgradeHash(found.ID, found.PasswordHash, hash); err != nil {
			writeError(w, http.StatusInternalServerError, "erreur interne")
			return
		}
	}
	token, err := a.Sessions.CreateForAccount(found.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "erreur interne")
		return
	}
	SetSessionCookie(w, token, a.Sessions.TTL(), accountRequestSecure(r))
	csrf, _ := a.Sessions.CSRF(token)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(map[string]any{"authenticated": true, "username": found.Username, "role": found.Role, "csrf_token": csrf})
}

func (a *AccountsAuth) ChangePassword(w http.ResponseWriter, r *http.Request) {
	identity, ok := AccountFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentification requise")
		return
	}
	var request struct {
		OldPassword string `json:"old_password"`
		NewPassword string `json:"new_password"`
	}
	if json.NewDecoder(r.Body).Decode(&request) != nil {
		writeError(w, http.StatusBadRequest, "requête invalide")
		return
	}
	a.lifecycle.Lock()
	defer a.lifecycle.Unlock()
	current, valid := a.identity(r)
	if !valid || current.User.ID != identity.User.ID || !accounts.VerifyPassword(current.User.PasswordHash, request.OldPassword) {
		writeError(w, http.StatusUnauthorized, "identifiants invalides")
		return
	}
	hash, err := accounts.HashPassword(request.NewPassword)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if _, err := a.Store.Update(identity.User.ID, identity.User.ID, hash, nil); err != nil {
		writeError(w, http.StatusInternalServerError, "erreur interne")
		return
	}
	a.Sessions.RevokeAccount(identity.User.ID, identity.Token)
	w.WriteHeader(http.StatusNoContent)
}

// UpdateAccount serializes credential changes with login, so that a successful
// login cannot create a session after the account was disabled or reset.
func (a *AccountsAuth) UpdateAccount(id, actor, hash string, disabled *bool) (accounts.User, error) {
	a.lifecycle.Lock()
	defer a.lifecycle.Unlock()
	user, err := a.Store.Update(id, actor, hash, disabled)
	if err == nil && (hash != "" || (disabled != nil && *disabled)) {
		a.Sessions.RevokeAccount(id, "")
	}
	return user, err
}

// DeleteAccount prevents a concurrent login from outliving account deletion.
func (a *AccountsAuth) DeleteAccount(id, actor string) error {
	return a.DeleteAccountWith(id, actor, nil)
}

// DeleteAccountWith prevents a login from racing account deletion, and only
// deletes the record after its sessions have been released successfully.
func (a *AccountsAuth) DeleteAccountWith(id, actor string, beforeDelete func() error) error {
	a.lifecycle.Lock()
	defer a.lifecycle.Unlock()
	if err := a.Store.DeleteWith(id, actor, beforeDelete); err != nil {
		return err
	}
	a.Sessions.RevokeAccount(id, "")
	return nil
}
