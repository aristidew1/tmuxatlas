package auth

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/LosFurina/tmuxatlas/pkg/accounts"
)

func TestAccountsLoginStatusAndPasswordChange(t *testing.T) {
	store := accounts.OpenStore(filepath.Join(t.TempDir(), "users.json"))
	hash, err := accounts.HashPassword("mot de passe initial")
	if err != nil {
		t.Fatal(err)
	}
	user, err := store.Create("alice", hash, "user")
	if err != nil {
		t.Fatal(err)
	}
	sessions := NewSessionManager(time.Hour)
	a, err := NewAccountsAuth(store, sessions)
	if err != nil {
		t.Fatal(err)
	}
	login := func(name, password string) *httptest.ResponseRecorder {
		t.Helper()
		body, _ := json.Marshal(map[string]string{"username": name, "password": password})
		r := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(body))
		r.RemoteAddr = "127.0.0.1:3000"
		r.Header.Set("X-Forwarded-Proto", "https")
		w := httptest.NewRecorder()
		a.Login(w, r)
		return w
	}
	wrong := login("inconnu", "mot de passe initial")
	if wrong.Code != http.StatusUnauthorized {
		t.Fatalf("unexpected failed login: %d", wrong.Code)
	}
	response := login("ALICE", "mot de passe initial")
	if response.Code != http.StatusOK || len(response.Result().Cookies()) != 1 {
		t.Fatalf("login: %d %s", response.Code, response.Body.String())
	}
	cookie := response.Result().Cookies()[0]
	if !cookie.Secure || !cookie.HttpOnly || cookie.SameSite != http.SameSiteStrictMode {
		t.Fatal("insecure cookie")
	}
	other, err := sessions.CreateForAccount(user.ID)
	if err != nil {
		t.Fatal(err)
	}
	_, done, _ := sessions.AccountSession(other)
	status := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/auth/status", nil)
	r.AddCookie(cookie)
	a.Status(status, r)
	if !strings.Contains(status.Body.String(), `"username":"alice"`) || strings.Contains(status.Body.String(), hash) {
		t.Fatalf("status: %s", status.Body.String())
	}
	change := httptest.NewRecorder()
	r = httptest.NewRequest(http.MethodPost, "/api/auth/change-password", strings.NewReader(`{"old_password":"mot de passe initial","new_password":"nouveau mot de passe"}`))
	r.AddCookie(cookie)
	a.Middleware(http.HandlerFunc(a.ChangePassword)).ServeHTTP(change, r)
	if change.Code != http.StatusNoContent || !sessions.Validate(cookie.Value) || sessions.Validate(other) {
		t.Fatalf("password change: %d", change.Code)
	}
	select {
	case <-done:
	default:
		t.Fatal("other session was not actively revoked")
	}
}

func TestAccountProxyHeadersRequireLoopback(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = "192.0.2.8:1234"
	r.Header.Set("X-Forwarded-Proto", "https")
	r.Header.Set("X-Forwarded-For", "203.0.113.1")
	if accountRequestSecure(r) || accountClientIP(r) != "192.0.2.8" {
		t.Fatal("trusted headers from remote host")
	}
	r.RemoteAddr = "127.0.0.1:1234"
	if !accountRequestSecure(r) || accountClientIP(r) != "203.0.113.1" {
		t.Fatal("ignored trusted proxy headers")
	}
}

func TestAdminAccountChangesRevokeSessions(t *testing.T) {
	store := accounts.OpenStore(filepath.Join(t.TempDir(), "users.json"))
	hash, err := accounts.HashPassword("mot de passe initial")
	if err != nil {
		t.Fatal(err)
	}
	user, err := store.Create("alice", hash, "user")
	if err != nil {
		t.Fatal(err)
	}
	sessions := NewSessionManager(time.Hour)
	a, err := NewAccountsAuth(store, sessions)
	if err != nil {
		t.Fatal(err)
	}
	token, err := sessions.CreateForAccount(user.ID)
	if err != nil {
		t.Fatal(err)
	}
	_, done, _ := sessions.AccountSession(token)
	disabled := true
	if _, err := a.UpdateAccount(user.ID, "admin", "", &disabled); err != nil {
		t.Fatal(err)
	}
	select {
	case <-done:
	default:
		t.Fatal("disabling an account did not close its sessions")
	}
	if sessions.Validate(token) {
		t.Fatal("disabled account session is still valid")
	}
	if err := a.DeleteAccount(user.ID, "admin"); err != nil {
		t.Fatal(err)
	}
}
