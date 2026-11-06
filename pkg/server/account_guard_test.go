package server

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/LosFurina/tmuxatlas/pkg/accounts"
	"github.com/LosFurina/tmuxatlas/pkg/auth"
	"github.com/LosFurina/tmuxatlas/pkg/identity"
	"github.com/LosFurina/tmuxatlas/pkg/peer"
	"github.com/LosFurina/tmuxatlas/pkg/state"
	"github.com/LosFurina/tmuxatlas/pkg/tmux"
	"golang.org/x/crypto/bcrypt"
)

func TestAccountPolicyFailsClosed(t *testing.T) {
	store := accounts.OpenStore(filepath.Join(t.TempDir(), "users.json"))
	hash, err := bcrypt.GenerateFromPassword([]byte("mot de passe"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	user, err := store.Create("alice", string(hash), "user")
	if err != nil {
		t.Fatal(err)
	}
	sessions := auth.NewSessionManager(time.Hour)
	authenticator, err := auth.NewAccountsAuth(store, sessions)
	if err != nil {
		t.Fatal(err)
	}
	token, err := sessions.CreateForAccount(user.ID)
	if err != nil {
		t.Fatal(err)
	}
	handler := authenticator.Middleware(newAccountPolicy(&Options{}).Middleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})))
	for _, tc := range []struct {
		method string
		path   string
		status int
	}{
		{http.MethodGet, "/api/preferences", http.StatusNoContent},
		{http.MethodPost, "/api/auth/change-password", http.StatusNoContent},
		{http.MethodGet, "/api/sessions", http.StatusNoContent},
		{http.MethodGet, "/ws/session", http.StatusForbidden},
		{http.MethodGet, "/ws/events", http.StatusNoContent},
		{http.MethodGet, "/api/new-unclassified-route", http.StatusForbidden},
	} {
		req := httptest.NewRequest(tc.method, tc.path, nil)
		req.AddCookie(&http.Cookie{Name: "tmuxatlas_session", Value: token})
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, req)
		if response.Code != tc.status {
			t.Errorf("%s %s: got %d, want %d", tc.method, tc.path, response.Code, tc.status)
		}
	}
}

func TestAccountPolicyRejectsRevokedRequestWaitingForLock(t *testing.T) {
	store := accounts.OpenStore(filepath.Join(t.TempDir(), "users.json"))
	hash, err := bcrypt.GenerateFromPassword([]byte("mot de passe"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	user, err := store.Create("alice", string(hash), "user")
	if err != nil {
		t.Fatal(err)
	}
	sessions := auth.NewSessionManager(time.Hour)
	a, err := auth.NewAccountsAuth(store, sessions)
	if err != nil {
		t.Fatal(err)
	}
	token, err := sessions.CreateForAccount(user.ID)
	if err != nil {
		t.Fatal(err)
	}
	policy := newAccountPolicy(&Options{})
	identified := make(chan struct{})
	result := make(chan int, 1)
	handler := a.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(identified)
		policy.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusNoContent)
		})).ServeHTTP(w, r)
	}))
	policy.mu.Lock()
	go func() {
		request := httptest.NewRequest(http.MethodGet, "/api/preferences", nil)
		request.AddCookie(&http.Cookie{Name: "tmuxatlas_session", Value: token})
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		result <- response.Code
	}()
	<-identified
	sessions.Revoke(token)
	policy.mu.Unlock()
	if status := <-result; status != http.StatusUnauthorized {
		t.Fatalf("requête révoquée autorisée : %d", status)
	}
}

func TestAccountCannotUseAnotherUsersSession(t *testing.T) {
	dir, err := os.MkdirTemp("/tmp", "atlas-accounts-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	t.Setenv("TMUX_TMPDIR", dir)
	client, err := tmux.NewClient()
	if err != nil {
		t.Fatal(err)
	}
	store := accounts.OpenStore(filepath.Join(dir, "users.json"))
	hash, err := bcrypt.GenerateFromPassword([]byte("mot de passe"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	alice, err := store.Create("alice", string(hash), "user")
	if err != nil {
		t.Fatal(err)
	}
	bob, err := store.Create("bob", string(hash), "user")
	if err != nil {
		t.Fatal(err)
	}
	if err := client.NewOwnedSession("alice", "", alice.ID); err != nil {
		t.Fatal(err)
	}
	if err := client.NewOwnedSession("bob", "", bob.ID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = client.Exec("kill-server") })
	local, err := identity.Generate("test")
	if err != nil {
		t.Fatal(err)
	}
	manager := state.NewManager(client)
	peers := peer.NewManager(local, nil, manager)
	sessions := auth.NewSessionManager(time.Hour)
	a, err := auth.NewAccountsAuth(store, sessions)
	if err != nil {
		t.Fatal(err)
	}
	token, err := sessions.CreateForAccount(alice.ID)
	if err != nil {
		t.Fatal(err)
	}
	h := a.Middleware(newAccountPolicy(&Options{Client: client, StateMgr: manager, PeerMgr: peers}).Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})))
	for _, name := range []string{"alice", "bob"} {
		for _, operation := range []string{"preview", "rename", "kill", "select-window", "select-pane", "reply", "release"} {
			method := http.MethodPost
			url := "/api/session/" + operation
			body := fmt.Sprintf(`{"host_id":%q,"session":%q}`, peers.LocalID(), name)
			if operation == "preview" {
				method = http.MethodGet
				url += "?host_id=" + peers.LocalID() + "&session=" + name
			}
			r := httptest.NewRequest(method, url, strings.NewReader(body))
			r.AddCookie(&http.Cookie{Name: "tmuxatlas_session", Value: token})
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			want := http.StatusNoContent
			if name == "bob" {
				want = http.StatusForbidden
			}
			if w.Code != want {
				t.Errorf("%s %s: %d, want %d", name, operation, w.Code, want)
			}
		}
		url := "/ws/session?host=" + peers.LocalID() + "&name=" + name
		r := httptest.NewRequest(http.MethodGet, url, nil)
		r.AddCookie(&http.Cookie{Name: "tmuxatlas_session", Value: token})
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		want := http.StatusNoContent
		if name == "bob" {
			want = http.StatusForbidden
		}
		if w.Code != want {
			t.Errorf("%s pty: %d, want %d", name, w.Code, want)
		}
	}
}

func TestToolEventDeleteCannotTargetAnotherHost(t *testing.T) {
	store := accounts.OpenStore(filepath.Join(t.TempDir(), "users.json"))
	hash, _ := bcrypt.GenerateFromPassword([]byte("mot de passe"), bcrypt.MinCost)
	user, err := store.Create("alice", string(hash), "user")
	if err != nil {
		t.Fatal(err)
	}
	sessions := auth.NewSessionManager(time.Hour)
	a, err := auth.NewAccountsAuth(store, sessions)
	if err != nil {
		t.Fatal(err)
	}
	token, err := sessions.CreateForAccount(user.ID)
	if err != nil {
		t.Fatal(err)
	}
	invoked := false
	handler := a.Middleware(newAccountPolicy(&Options{}).Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { invoked = true })))
	r := httptest.NewRequest("DELETE", "/api/tool-event", strings.NewReader(`{"host_id":"local","host":"foreign","session":"same"}`))
	r.AddCookie(&http.Cookie{Name: "tmuxatlas_session", Value: token})
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	if w.Code != 400 || invoked {
		t.Fatalf("status=%d handler=%v", w.Code, invoked)
	}
}
