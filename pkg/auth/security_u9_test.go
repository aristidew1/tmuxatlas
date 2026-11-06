package auth

import (
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/LosFurina/tmuxatlas/pkg/accounts"
	"golang.org/x/crypto/bcrypt"
)

func TestUsernameLockoutDoesNotBlockOtherSources(t *testing.T) {
	store := accounts.OpenStore(filepath.Join(t.TempDir(), "users.json"))
	hash, _ := bcrypt.GenerateFromPassword([]byte("valid password"), bcrypt.MinCost)
	if _, err := store.Create("admin", string(hash), "admin"); err != nil {
		t.Fatal(err)
	}
	a, err := NewAccountsAuth(store, NewSessionManager(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	call := func(ip, password string) int {
		r := httptest.NewRequest("POST", "/", strings.NewReader(`{"username":"admin","password":"`+password+`"}`))
		r.RemoteAddr = ip + ":1234"
		w := httptest.NewRecorder()
		a.Login(w, r)
		return w.Code
	}
	for i := 0; i < 3; i++ {
		if got := call("192.0.2.1", "wrong"); got != 401 {
			t.Fatal(got)
		}
	}
	if got := call("192.0.2.1", "valid password"); got != 429 {
		t.Fatal(got)
	}
	if got := call("192.0.2.2", "valid password"); got != 200 {
		t.Fatal(got)
	}
}

func TestImportedHashIsUpgradedOnLogin(t *testing.T) {
	store := accounts.OpenStore(filepath.Join(t.TempDir(), "users.json"))
	hash, _ := bcrypt.GenerateFromPassword([]byte("valid password"), bcrypt.MinCost)
	if _, err := store.Create("admin", string(hash), "admin"); err != nil {
		t.Fatal(err)
	}
	a, err := NewAccountsAuth(store, NewSessionManager(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	a.Login(w, httptest.NewRequest("POST", "/", strings.NewReader(`{"username":"admin","password":"valid password"}`)))
	if w.Code != 200 {
		t.Fatal(w.Code)
	}
	users, err := store.List()
	if err != nil {
		t.Fatal(err)
	}
	cost, err := bcrypt.Cost([]byte(users[0].PasswordHash))
	if err != nil || cost != 12 || !accounts.VerifyPassword(users[0].PasswordHash, "valid password") {
		t.Fatal(cost, err)
	}
}
