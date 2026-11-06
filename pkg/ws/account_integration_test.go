package ws

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/LosFurina/tmuxatlas/pkg/accounts"
	"github.com/LosFurina/tmuxatlas/pkg/auth"
	"github.com/LosFurina/tmuxatlas/pkg/state"
	"github.com/LosFurina/tmuxatlas/pkg/tmux"
	"github.com/gorilla/websocket"
	"golang.org/x/crypto/bcrypt"
)

func accountWebSocketFixture(t *testing.T) (*state.Coordinator, *auth.SessionManager, accounts.User, accounts.User, string) {
	t.Helper()
	store := accounts.OpenStore(filepath.Join(t.TempDir(), "users.json"))
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
	sessions := auth.NewSessionManager(time.Hour)
	a, err := auth.NewAccountsAuth(store, sessions)
	if err != nil {
		t.Fatal(err)
	}
	coordinator := state.NewCoordinatorWithInstanceID("instance")
	t.Cleanup(coordinator.Close)
	hub := NewHub(nil, nil)
	hub.SetCoordinator(coordinator)
	server := httptest.NewServer(a.Middleware(http.HandlerFunc(hub.HandleEvents)))
	t.Cleanup(server.Close)
	return coordinator, sessions, alice, bob, "ws" + strings.TrimPrefix(server.URL, "http") + "?schema=1"
}

func accountWebSocket(t *testing.T, sessions *auth.SessionManager, id, endpoint string) *websocket.Conn {
	t.Helper()
	token, err := sessions.CreateForAccount(id)
	if err != nil {
		t.Fatal(err)
	}
	headers := http.Header{}
	headers.Set("Cookie", "tmuxatlas_session="+token)
	conn, _, err := websocket.DefaultDialer.Dial(endpoint, headers)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	_ = conn.SetReadDeadline(time.Now().Add(4 * time.Second))
	return conn
}

func TestAccountProjectionKeepsSessionAfterReassign(t *testing.T) {
	c, sessions, alice, bob, endpoint := accountWebSocketFixture(t)
	key := state.NewSessionKey("host", "secret-session")
	windowKey := state.NewWindowKey("host", "secret-session", "@1")
	paneKey := state.NewPaneKey("host", "secret-session", "@1", "%1")
	session := state.Session{Key: key, HostID: "host", Name: "secret-session", Owner: tmux.Owner(alice.ID)}
	window := state.Window{Key: windowKey, SessionKey: key, Name: "secret-window"}
	pane := state.Pane{Key: paneKey, WindowKey: windowKey, CurrentCommand: "secret-command"}
	_, err := c.Commit(context.Background(), state.Operation{Kind: state.OperationUpsertSession, Session: &session}, state.Operation{Kind: state.OperationUpsertWindow, Window: &window}, state.Operation{Kind: state.OperationUpsertPane, Pane: &pane})
	if err != nil {
		t.Fatal(err)
	}
	conn := accountWebSocket(t, sessions, alice.ID, endpoint)
	_, initial, err := conn.ReadMessage()
	if err != nil || !strings.Contains(string(initial), "secret-command") {
		t.Fatalf("initial: %s, %v", initial, err)
	}
	session.Owner = tmux.Owner(bob.ID)
	if _, err := c.Commit(context.Background(), state.Operation{Kind: state.OperationUpsertSession, Session: &session}); err != nil {
		t.Fatal(err)
	}
	_, after, err := conn.ReadMessage()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(after), `"type":"snapshot"`) || !strings.Contains(string(after), "secret-command") {
		t.Fatalf("projection après réattribution : %s", after)
	}
}

func TestRevocationClosesAccountConnections(t *testing.T) {
	c, sessions, alice, bob, endpoint := accountWebSocketFixture(t)
	a := accountWebSocket(t, sessions, alice.ID, endpoint)
	b := accountWebSocket(t, sessions, bob.ID, endpoint)
	if _, _, err := a.ReadMessage(); err != nil {
		t.Fatal(err)
	}
	if _, _, err := b.ReadMessage(); err != nil {
		t.Fatal(err)
	}
	sessions.RevokeAccount(alice.ID, "")
	if _, _, err := a.ReadMessage(); err == nil {
		t.Fatal("connexion révoquée encore ouverte")
	}
	host := state.Host{Key: state.NewHostKey("host"), ID: "host"}
	if _, err := c.Commit(context.Background(), state.Operation{Kind: state.OperationUpsertHost, Host: &host}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := b.ReadMessage(); err != nil {
		t.Fatalf("autre compte déconnecté : %v", err)
	}
}
