package server

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
	"github.com/LosFurina/tmuxatlas/pkg/auth"
	"github.com/go-chi/chi/v5"
	"golang.org/x/crypto/bcrypt"
)

func TestAccountAdministrationHidesHashesAndRevokes(t *testing.T) {
	store := accounts.OpenStore(filepath.Join(t.TempDir(), "users.json"))
	hash, err := bcrypt.GenerateFromPassword([]byte("mot de passe"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	admin, err := store.Create("admin", string(hash), "admin")
	if err != nil {
		t.Fatal(err)
	}
	sessions := auth.NewSessionManager(time.Hour)
	a, err := auth.NewAccountsAuth(store, sessions)
	if err != nil {
		t.Fatal(err)
	}
	token, err := sessions.CreateForAccount(admin.ID)
	if err != nil {
		t.Fatal(err)
	}
	opts := &Options{AccountsAuth: a}
	router := chi.NewRouter()
	router.Use(a.Middleware)
	router.Use(accountAdminOnly)
	router.Post("/users", func(w http.ResponseWriter, r *http.Request) { handleAdminUsers(w, r, opts) })
	router.Get("/users", func(w http.ResponseWriter, r *http.Request) { handleAdminUsers(w, r, opts) })
	router.Patch("/users/{id}", func(w http.ResponseWriter, r *http.Request) { handleAdminUserUpdate(w, r, opts) })
	request := func(method, path, body string) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.AddCookie(&http.Cookie{Name: "tmuxatlas_session", Value: token})
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		return w
	}
	created := request(http.MethodPost, "/users", `{"username":"alice","password":"motdepasse-alice-1","role":"admin"}`)
	if created.Code != http.StatusCreated || bytes.Contains(created.Body.Bytes(), []byte("password_hash")) || bytes.Contains(created.Body.Bytes(), []byte("motdepasse-alice-1")) {
		t.Fatalf("create: %d %s", created.Code, created.Body.String())
	}
	var user accountView
	if err := json.Unmarshal(created.Body.Bytes(), &user); err != nil || user.Role != "user" {
		t.Fatalf("created user: %+v %v", user, err)
	}
	list := request(http.MethodGet, "/users", "")
	if list.Code != http.StatusOK || strings.Contains(list.Body.String(), string(hash)) || strings.Contains(list.Body.String(), "password_hash") {
		t.Fatalf("list: %d %s", list.Code, list.Body.String())
	}
	userToken, err := sessions.CreateForAccount(user.ID)
	if err != nil {
		t.Fatal(err)
	}
	_, done, _ := sessions.AccountSession(userToken)
	updated := request(http.MethodPatch, "/users/"+user.ID, `{"disabled":true}`)
	if updated.Code != http.StatusOK || sessions.Validate(userToken) {
		t.Fatalf("disable: %d %s", updated.Code, updated.Body.String())
	}
	select {
	case <-done:
	default:
		t.Fatal("disable did not close active sessions")
	}
}
