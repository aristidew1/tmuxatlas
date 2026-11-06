package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/LosFurina/tmuxatlas/pkg/accounts"
	"github.com/LosFurina/tmuxatlas/pkg/activity"
	"github.com/LosFurina/tmuxatlas/pkg/auth"
	"github.com/LosFurina/tmuxatlas/pkg/identity"
	"github.com/LosFurina/tmuxatlas/pkg/peer"
	"github.com/LosFurina/tmuxatlas/pkg/preferences"
	"github.com/LosFurina/tmuxatlas/pkg/state"
	"github.com/LosFurina/tmuxatlas/pkg/tmux"
	"github.com/LosFurina/tmuxatlas/pkg/toolevents"
	"github.com/gorilla/websocket"
	"golang.org/x/crypto/bcrypt"
)

func TestOwnerNameIsMarkedInTmuxSession(t *testing.T)     { runAccountsIntegration(t, "owner-name") }
func TestAccountsModeIntegration(t *testing.T)            { runAccountsIntegration(t, "standard") }
func TestFailedClaimDoesNotDisconnectOthers(t *testing.T) { runAccountsIntegration(t, "claim") }
func TestPreferencesHideOtherUsersData(t *testing.T)      { runAccountsIntegration(t, "preferences") }
func TestExpiredSessionClosesOpenTerminal(t *testing.T)   { runAccountsIntegration(t, "expiry") }

func runAccountsIntegration(t *testing.T, scenario string) {
	dir, err := os.MkdirTemp("/tmp", "atlas-account-integration-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	t.Setenv("TMUX_TMPDIR", dir)
	t.Setenv("TMUXATLAS_MONITOR", "off")
	client, err := tmux.NewClient()
	if err != nil {
		t.Fatal(err)
	}
	store := accounts.OpenStore(filepath.Join(dir, "users.json"))
	hash, err := bcrypt.GenerateFromPassword([]byte("mot de passe initial"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	admin, err := store.Create("admin", string(hash), "admin")
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
	if err := client.NewOwnedSession("alice-work", "", alice.ID); err != nil {
		t.Fatal(err)
	}
	if err := client.NewOwnedSession("bob-work", "", bob.ID); err != nil {
		t.Fatal(err)
	}
	if err := client.NewSession("free-work"); err != nil {
		t.Fatal(err)
	}
	if err := client.NewSession("still-free"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = client.Exec("kill-server") })
	node, err := identity.Generate("test")
	if err != nil {
		t.Fatal(err)
	}
	stateManager := state.NewManager(client)
	peerManager := peer.NewManager(node, nil, stateManager)
	peerManager.UpdatePeerSessions(peerManager.LocalID(), stateManager.GetSessions())
	ttl := time.Hour
	if scenario == "expiry" {
		ttl = 700 * time.Millisecond
	}
	sessions := auth.NewSessionManager(ttl)
	t.Setenv("XDG_CONFIG_HOME", dir)
	prefStore, err := preferences.NewStore()
	if err != nil {
		t.Fatal(err)
	}
	prefs := preferences.Default()
	prefs.Sidebar.HiddenSessions = []string{"bob-work"}
	prefs.HostAliases = map[string]string{"secret-host": "secret-alias"}
	if err := prefStore.Update(prefs); err != nil {
		t.Fatal(err)
	}
	a, err := auth.NewAccountsAuth(store, sessions)
	if err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	listener.Close()
	base := "http://" + address
	ctx, cancel := context.WithCancel(context.Background())
	go peerManager.RunContext(ctx)
	done := make(chan error, 1)
	go func() {
		done <- Run(ctx, &Options{Role: "standalone", ListenAddress: address, PublicURL: base,
			SocketPath: filepath.Join(dir, "server.sock"), Client: client, StateMgr: stateManager,
			PrefStore: prefStore, Tracker: toolevents.NewTracker(), ActivityTracker: activity.NewTracker(), PeerMgr: peerManager,
			AuthEnabled: true, AccountsAuth: a, SessionMgr: sessions})
	}()
	t.Cleanup(func() {
		cancel()
		select {
		case err := <-done:
			if err != nil {
				t.Error(err)
			}
		case <-time.After(5 * time.Second):
			t.Error("serveur non arrêté")
		}
	})
	for deadline := time.Now().Add(5 * time.Second); ; {
		response, err := http.Get(base + "/api/auth/status")
		if err == nil {
			response.Body.Close()
			break
		}
		if time.Now().After(deadline) {
			t.Fatal(err)
		}
		time.Sleep(20 * time.Millisecond)
	}
	type login struct {
		cookie *http.Cookie
		csrf   string
	}
	call := func(method, path, body string, credential login) *http.Response {
		t.Helper()
		r, err := http.NewRequest(method, base+path, strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		r.Header.Set("Origin", base)
		if body != "" {
			r.Header.Set("Content-Type", "application/json")
		}
		if credential.cookie != nil {
			r.AddCookie(credential.cookie)
			r.Header.Set(auth.CSRFHeader, credential.csrf)
		}
		response, err := http.DefaultClient.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		return response
	}
	loginAs := func(username string) login {
		t.Helper()
		response := call(http.MethodPost, "/api/auth/login", fmt.Sprintf(`{"username":%q,"password":"mot de passe initial"}`, username), login{})
		defer response.Body.Close()
		var data struct {
			CSRF string `json:"csrf_token"`
		}
		if response.StatusCode != http.StatusOK || json.NewDecoder(response.Body).Decode(&data) != nil || len(response.Cookies()) == 0 || data.CSRF == "" {
			t.Fatalf("connexion %s : %s", username, response.Status)
		}
		return login{response.Cookies()[0], data.CSRF}
	}
	response := call(http.MethodGet, "/api/sessions", "", login{})
	response.Body.Close()
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("accès anonyme : %d", response.StatusCode)
	}
	adminLogin := loginAs(admin.Username)
	aliceLogin := loginAs(alice.Username)
	bobLogin := loginAs(bob.Username)
	if scenario == "owner-name" {
		check := func(session, want string) {
			t.Helper()
			got, err := client.Exec("show-options", "-v", "-t", tmux.ExactWindow(session, ""), "@atlas-owner-name")
			if want == "" {
				if err == nil {
					t.Fatalf("%s: option présente : %q", session, got)
				}
			} else if err != nil || strings.TrimSpace(got) != want {
				t.Fatalf("%s: nom %q, erreur %v; attendu %q", session, got, err, want)
			}
		}
		action := func(path, body string, user login) {
			t.Helper()
			response := call(http.MethodPost, path, body, user)
			defer response.Body.Close()
			if response.StatusCode != http.StatusOK {
				data, _ := io.ReadAll(response.Body)
				t.Fatalf("%s: %s %s", path, response.Status, data)
			}
		}
		target := fmt.Sprintf(`{"host_id":%q,"session":"free-work"}`, peerManager.LocalID())
		action("/api/session/claim", target, aliceLogin)
		check("free-work", "alice")
		action("/api/session/release", target, aliceLogin)
		check("free-work", "")
		assign := fmt.Sprintf(`{"host_id":%q,"session":"free-work","owner":%q}`, peerManager.LocalID(), bob.ID)
		action("/api/session/claim", assign, adminLogin)
		check("free-work", "bob")
		response := call(http.MethodDelete, "/api/admin/users/"+bob.ID, "", adminLogin)
		response.Body.Close()
		if response.StatusCode != http.StatusNoContent {
			t.Fatalf("suppression : %s", response.Status)
		}
		check("free-work", "")
		newTarget := fmt.Sprintf(`{"host_id":%q,"session":"new-owned"}`, peerManager.LocalID())
		action("/api/session/new", newTarget, aliceLogin)
		check("new-owned", "alice")
		if err := tmux.MigrateOwners(client, filepath.Join(dir, "migration"), admin.ID, admin.Username); err != nil {
			t.Fatal(err)
		}
		check("still-free", "admin")
		return
	}
	if scenario == "preferences" {
		response := call(http.MethodGet, "/api/preferences", "", aliceLogin)
		data, _ := io.ReadAll(response.Body)
		response.Body.Close()
		if response.StatusCode != 200 || bytes.Contains(data, []byte("bob-work")) || bytes.Contains(data, []byte("secret-host")) || bytes.Contains(data, []byte("secret-alias")) {
			t.Fatalf("préférences : %d %s", response.StatusCode, data)
		}
		return
	}
	if scenario == "claim" {
		headers := http.Header{"Origin": []string{base}, "Cookie": []string{bobLogin.cookie.String()}}
		terminal, _, err := websocket.DefaultDialer.Dial("ws://"+address+"/ws/session?host="+peerManager.LocalID()+"&name=bob-work", headers)
		if err != nil {
			t.Fatal(err)
		}
		defer terminal.Close()
		events, _, err := websocket.DefaultDialer.Dial("ws://"+address+"/ws/events?schema=1", headers)
		if err != nil {
			t.Fatal(err)
		}
		defer events.Close()
		_ = events.SetReadDeadline(time.Now().Add(5 * time.Second))
		if _, _, err := events.ReadMessage(); err != nil {
			t.Fatal(err)
		}
		for _, tc := range []struct {
			name   string
			status int
		}{{"bob-work", 409}, {"still-free", 200}} {
			response := call(http.MethodPost, "/api/session/claim", fmt.Sprintf(`{"host_id":%q,"session":%q}`, peerManager.LocalID(), tc.name), aliceLogin)
			response.Body.Close()
			if response.StatusCode != tc.status {
				t.Fatalf("claim %s: %d", tc.name, response.StatusCode)
			}
		}
		if err := terminal.WriteMessage(websocket.BinaryMessage, []byte("echo U9_TERMINAL_ALIVE\n")); err != nil {
			t.Fatal(err)
		}
		_ = terminal.SetReadDeadline(time.Now().Add(5 * time.Second))
		for {
			_, message, err := terminal.ReadMessage()
			if err != nil {
				t.Fatal(err)
			}
			if bytes.Contains(message, []byte("U9_TERMINAL_ALIVE")) {
				break
			}
		}
		if _, _, err := events.ReadMessage(); err != nil {
			t.Fatalf("flux déconnecté : %v", err)
		}
		return
	}
	if scenario == "expiry" {
		headers := http.Header{"Origin": []string{base}, "Cookie": []string{aliceLogin.cookie.String()}}
		terminal, _, err := websocket.DefaultDialer.Dial("ws://"+address+"/ws/session?host="+peerManager.LocalID()+"&name=alice-work", headers)
		if err != nil {
			t.Fatal(err)
		}
		defer terminal.Close()
		events, _, err := websocket.DefaultDialer.Dial("ws://"+address+"/ws/events?schema=1", headers)
		if err != nil {
			t.Fatal(err)
		}
		defer events.Close()
		if _, _, err := events.ReadMessage(); err != nil {
			t.Fatal(err)
		}
		time.Sleep(400 * time.Millisecond)
		if !sessions.Validate(aliceLogin.cookie.Value) {
			t.Fatal("session prématurément expirée")
		}
		time.Sleep(400 * time.Millisecond)
		if !sessions.Validate(aliceLogin.cookie.Value) {
			t.Fatal("session active coupée")
		}
		_ = terminal.SetReadDeadline(time.Now().Add(3 * time.Second))
		_ = events.SetReadDeadline(time.Now().Add(3 * time.Second))
		for {
			_, _, err := terminal.ReadMessage()
			if err != nil {
				if ne, ok := err.(net.Error); ok && ne.Timeout() {
					t.Fatal("PTY non fermé")
				}
				break
			}
		}
		for {
			_, _, err := events.ReadMessage()
			if err != nil {
				if ne, ok := err.(net.Error); ok && ne.Timeout() {
					t.Fatal("événements non fermés")
				}
				break
			}
		}
		return
	}

	noOrigin, err := http.Post(base+"/api/auth/login", "application/json", strings.NewReader(`{"username":"admin","password":"mot de passe initial"}`))
	if err != nil {
		t.Fatal(err)
	}
	noOrigin.Body.Close()
	if noOrigin.StatusCode != http.StatusForbidden {
		t.Fatalf("connexion sans Origin : %d", noOrigin.StatusCode)
	}
	withoutCSRF, err := http.NewRequest(http.MethodPost, base+"/api/admin/users", strings.NewReader(`{"username":"charlie","password":"mot de passe initial"}`))
	if err != nil {
		t.Fatal(err)
	}
	withoutCSRF.Header.Set("Origin", base)
	withoutCSRF.Header.Set("Content-Type", "application/json")
	withoutCSRF.AddCookie(adminLogin.cookie)
	csrfResponse, err := http.DefaultClient.Do(withoutCSRF)
	if err != nil {
		t.Fatal(err)
	}
	csrfResponse.Body.Close()
	if csrfResponse.StatusCode != http.StatusForbidden {
		t.Fatalf("mutation sans jeton CSRF : %d", csrfResponse.StatusCode)
	}
	claim := fmt.Sprintf(`{"host_id":%q,"session":"free-work"}`, peerManager.LocalID())
	response = call(http.MethodPost, "/api/session/claim", claim, aliceLogin)
	if data, _ := io.ReadAll(response.Body); response.StatusCode != http.StatusOK {
		t.Fatalf("claim: %s %s", response.Status, data)
	}
	response.Body.Close()
	response = call(http.MethodGet, "/api/sessions", "", bobLogin)
	data, _ := io.ReadAll(response.Body)
	response.Body.Close()
	if response.StatusCode != http.StatusOK || bytes.Contains(data, []byte("alice-work")) || bytes.Contains(data, []byte("free-work")) || !bytes.Contains(data, []byte("bob-work")) || !bytes.Contains(data, []byte("still-free")) {
		t.Fatalf("projection bob : %d %s", response.StatusCode, data)
	}
	response = call(http.MethodGet, "/ws/session?host="+peerManager.LocalID()+"&name=free-work", "", bobLogin)
	response.Body.Close()
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("PTY d'autrui : %d", response.StatusCode)
	}
	headers := http.Header{"Origin": []string{base}, "Cookie": []string{aliceLogin.cookie.String()}}
	pty, _, err := websocket.DefaultDialer.Dial("ws://"+address+"/ws/session?host="+peerManager.LocalID()+"&name=alice-work", headers)
	if err != nil {
		t.Fatal(err)
	}
	defer pty.Close()
	_ = pty.SetReadDeadline(time.Now().Add(5 * time.Second))
	if _, _, err := pty.ReadMessage(); err != nil {
		t.Fatalf("PTY initial : %v", err)
	}
	assign := fmt.Sprintf(`{"host_id":%q,"session":"alice-work","owner":%q}`, peerManager.LocalID(), bob.ID)
	response = call(http.MethodPost, "/api/session/claim", assign, adminLogin)
	response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("réattribution : %s", response.Status)
	}
	for {
		if _, _, err := pty.ReadMessage(); err != nil {
			if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
				t.Fatal("PTY encore ouvert après réattribution")
			}
			break
		}
	}
	conn, _, err := websocket.DefaultDialer.Dial("ws://"+address+"/ws/events?schema=1", headers)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	if _, _, err := conn.ReadMessage(); err != nil {
		t.Fatal(err)
	}
	response = call(http.MethodPatch, "/api/admin/users/"+alice.ID, `{"disabled":true}`, adminLogin)
	response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("désactivation : %s", response.Status)
	}
	if _, _, err := conn.ReadMessage(); err == nil {
		t.Fatal("WebSocket non fermé à la révocation")
	}
}
