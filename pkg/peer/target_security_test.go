package peer

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/LosFurina/tmuxatlas/pkg/identity"
	"github.com/LosFurina/tmuxatlas/pkg/state"
	"github.com/LosFurina/tmuxatlas/pkg/tmux"
)

func TestSessionNamedAsIdCannotReachAnotherSession(t *testing.T) {
	t.Setenv("SHELL", "/bin/sh")
	client := isolatedTmux(t)
	if err := client.NewOwnedSession("admin-agent", "", "admin"); err != nil {
		t.Fatal(err)
	}
	_, _ = client.Exec("set-option", "-g", "default-shell", "/bin/sh")
	_, _ = client.Exec("set-hook", "-gu", "session-created[42]")
	_, _ = client.Exec("respawn-pane", "-k", "-t", tmux.ExactWindow("admin-agent", ""), "/bin/sh")
	adminPanes, err := client.ListPanes(tmux.ExactWindow("admin-agent", ""))
	if err != nil || len(adminPanes) == 0 {
		t.Fatalf("admin panes: %v %v", adminPanes, err)
	}
	adminPane := adminPanes[0].ID
	if err := client.SendLiteral(adminPane, "echo ADMIN_ONLY_MARKER"); err != nil {
		t.Fatal(err)
	}
	if err := client.SendEnter(adminPane); err != nil {
		t.Fatal(err)
	}
	waitForText(t, client, adminPane, "ADMIN_ONLY_MARKER")

	// Creating "$0" via Atlas/Client must be refused.
	if err := client.NewSession("$0"); err == nil {
		t.Fatal("NewSession($0) should be refused")
	}
	if err := client.NewOwnedSession("$0", "", "user1"); err == nil {
		t.Fatal("NewOwnedSession($0) should be refused")
	}
	_, err = runExec(t, client, "new", "$0", map[string]string{"owner": "user1"})
	if codeOf(err) != ErrorInvalidTarget {
		t.Fatalf("new $0 expected invalid-target, got %v", err)
	}

	// Before any session named "$0" exists, targeting "$0" must never hit admin-agent ($0).
	if client.HasSession("$0") {
		t.Fatal("HasSession($0) matched admin-agent by session_id")
	}
	if _, err := tmux.NewPTYSession(client.TmuxPath(), "$0", 80, 24); err == nil {
		t.Fatal("NewPTYSession($0) should fail when no session is named $0")
	}
	if _, err := client.ListWindows("$0"); err == nil {
		t.Fatal("ListWindows($0) should fail when no session is named $0")
	}
	if err := client.KillSession("$0"); err == nil {
		t.Fatal("KillSession($0) should fail when no session is named $0")
	}
	if !client.HasSession("admin-agent") {
		t.Fatal("admin-agent was killed by $0 target")
	}

	// Pre-existing session literally named "$0" created directly via tmux CLI.
	if _, err := client.Exec("new-session", "-d", "-s", "$0", "sh"); err != nil {
		t.Fatal(err)
	}
	dollarTarget, err := client.SessionTarget("$0")
	if err != nil || dollarTarget == "$0" || dollarTarget == "=$0" {
		t.Fatalf("expected resolved session ID for $0, got %q (%v)", dollarTarget, err)
	}
	if _, err := client.Exec("new-window", "-t", dollarTarget, "sh"); err != nil {
		t.Fatal(err)
	}

	if !client.HasSession("$0") {
		t.Fatal("HasSession($0) should find the pre-existing session named $0")
	}
	windows, err := client.ListWindows("$0")
	if err != nil || len(windows) != 2 {
		t.Fatalf("ListWindows($0): %v %v", windows, err)
	}
	for _, w := range windows {
		if w.SessionID == "$0" {
			t.Fatalf("ListWindows($0) returned window from admin-agent ($0): %+v", w)
		}
	}

	if err := client.SelectWindow("$0", "0"); err != nil {
		t.Fatalf("SelectWindow($0, 0): %v", err)
	}
	if err := client.ChangeOwner("$0", "", "bob", false); err != nil {
		t.Fatalf("ChangeOwner($0): %v", err)
	}
	if err := client.SendLiteral("$0", "echo DOLLAR_SESSION_MARKER"); err != nil {
		t.Fatalf("SendLiteral($0): %v", err)
	}
	if err := client.SendEnter("$0"); err != nil {
		t.Fatalf("SendEnter($0): %v", err)
	}
	dollarPanes, err := client.ListPanes("$0")
	if err != nil || len(dollarPanes) == 0 {
		t.Fatalf("ListPanes($0): %v %v", dollarPanes, err)
	}
	waitForText(t, client, dollarPanes[0].ID, "DOLLAR_SESSION_MARKER")

	// Attach via PTY to "$0"; it must attach to "$1" (named "$0"), never to admin-agent ($0).
	ptySess, err := tmux.NewPTYSession(client.TmuxPath(), "$0", 80, 24)
	if err != nil {
		t.Fatalf("NewPTYSession($0): %v", err)
	}
	ptyCh := make(chan string, 16)
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := ptySess.Read(buf)
			if n > 0 {
				ptyCh <- string(buf[:n])
			}
			if err != nil {
				return
			}
		}
	}()
	var ptyOut strings.Builder
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		select {
		case chunk := <-ptyCh:
			ptyOut.WriteString(chunk)
		case <-time.After(20 * time.Millisecond):
		}
		if strings.Contains(ptyOut.String(), "ADMIN_ONLY_MARKER") {
			ptySess.Close()
			t.Fatalf("NewPTYSession($0) attached to admin-agent:\n%s", ptyOut.String())
		}
		if strings.Contains(ptyOut.String(), "DOLLAR_SESSION_MARKER") {
			break
		}
	}
	if !strings.Contains(ptyOut.String(), "DOLLAR_SESSION_MARKER") {
		ptySess.Close()
		t.Fatalf("NewPTYSession($0) did not render session named $0:\n%s", ptyOut.String())
	}
	clientsOut, err := client.Exec("list-clients", "-F", "#{session_id}:#{session_name}")
	ptySess.Close()
	if err != nil || strings.TrimSpace(clientsOut) != dollarTarget+":$0" {
		t.Fatalf("attached client target = %q, want %q (%v)", strings.TrimSpace(clientsOut), dollarTarget+":$0", err)
	}

	adminText, err := client.CapturePaneText(adminPane)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(adminText, "DOLLAR_SESSION_MARKER") {
		t.Fatalf("PTY attached to $0 wrote into admin-agent pane:\n%s", adminText)
	}

	rawPreview, err := runExec(t, client, "preview", "$0", map[string]any{"lines": 20})
	if err != nil {
		t.Fatalf("preview($0): %v", err)
	}
	if strings.Contains(string(rawPreview), "ADMIN_ONLY_MARKER") || !strings.Contains(string(rawPreview), "DOLLAR_SESSION_MARKER") {
		t.Fatalf("preview($0) hit wrong session: %s", rawPreview)
	}

	// Rename "$0" to a valid name; admin-agent must stay intact.
	if err := client.RenameSession("$0", "dollar-renamed"); err != nil {
		t.Fatalf("RenameSession($0): %v", err)
	}
	if !client.HasSession("admin-agent") || !client.HasSession("dollar-renamed") || client.HasSession("$0") {
		t.Fatal("unexpected sessions after renaming $0")
	}

	// Recreate "$0" via direct tmux and kill it via client.KillSession("$0").
	if _, err := client.Exec("new-session", "-d", "-s", "$0"); err != nil {
		t.Fatal(err)
	}
	if err := client.KillSession("$0"); err != nil {
		t.Fatalf("KillSession($0): %v", err)
	}
	if client.HasSession("$0") {
		t.Fatal("$0 should have been killed")
	}
	sessions, err := client.ListSessions()
	if err != nil {
		t.Fatal(err)
	}
	foundAdmin := false
	for _, s := range sessions {
		if s.Name == "admin-agent" && s.Owner == "admin" {
			foundAdmin = true
		}
	}
	if !foundAdmin {
		t.Fatalf("admin-agent missing or owner altered: %+v", sessions)
	}
}

func TestTmuxTargetsNeverMatchByPrefix(t *testing.T) {
	client := isolatedTmux(t)
	if err := client.NewOwnedSession("abc", "", "alice"); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Exec("new-window", "-t", tmux.ExactSession("abc")); err != nil {
		t.Fatal(err)
	}

	// attach
	if ptySess, err := tmux.NewPTYSession(client.TmuxPath(), "ab", 80, 24); err == nil {
		ptySess.Close()
		t.Fatal("NewPTYSession(ab) matched abc by prefix")
	}
	// has-session
	if client.HasSession("ab") {
		t.Fatal("HasSession(ab) matched abc by prefix")
	}
	// rename
	if err := client.RenameSession("ab", "ab-renamed"); err == nil {
		t.Fatal("RenameSession(ab) matched abc by prefix")
	}
	if _, err := runExec(t, client, "rename", "ab", map[string]string{"new_name": "ab-renamed"}); err == nil {
		t.Fatal("executor rename(ab) matched abc by prefix")
	}
	// list-windows
	if _, err := client.ListWindows("ab"); err == nil {
		t.Fatal("ListWindows(ab) matched abc by prefix")
	}
	// select-window
	if err := client.SelectWindow("ab", "0"); err == nil {
		t.Fatal("SelectWindow(ab, 0) matched abc by prefix")
	}
	if _, err := runExec(t, client, "select-window", "ab", map[string]any{"window": 0}); err == nil {
		t.Fatal("executor select-window(ab) matched abc by prefix")
	}
	// kill
	if err := client.KillSession("ab"); err == nil {
		t.Fatal("KillSession(ab) matched abc by prefix")
	}
	if _, err := runExec(t, client, "kill", "ab", map[string]any{}); err == nil {
		t.Fatal("executor kill(ab) matched abc by prefix")
	}

	if !client.HasSession("abc") {
		t.Fatal("abc was modified or killed by prefix operation on ab")
	}
}

func TestSessionNamesRejectTmuxTargetSyntax(t *testing.T) {
	client := isolatedTmux(t)
	if err := client.NewOwnedSession("existing", "", "alice"); err != nil {
		t.Fatal(err)
	}
	if err := client.NewOwnedSession("other-owned", "", "bob"); err != nil {
		t.Fatal(err)
	}

	node, err := identity.Generate("local")
	if err != nil {
		t.Fatal(err)
	}
	stateMgr := state.NewManager(client)
	stateMgr.GetSessions()
	manager := NewManager(node, nil, stateMgr)
	router := NewActionRouter(manager, NewTmuxRuntimeExecutor(client), time.Second)
	cache, err := NewOutcomeCache(DefaultOutcomeCacheConfig(), nil)
	if err != nil {
		t.Fatal(err)
	}
	dispatcher := &RequestDispatcher{
		Generation: 1,
		HostID:     manager.LocalID(),
		Executor:   NewTmuxRuntimeExecutor(client),
		Cache:      cache,
		Capabilities: map[string]struct{}{
			CapabilitySessionActions:   {},
			CapabilitySessionExtras:    {},
			CapabilitySessionOwnership: {},
		},
	}

	invalidNames := []string{
		"",
		"$0",
		"$12",
		"@0",
		"@9",
		"%0",
		"%42",
		"=existing",
		"=",
		"~",
		"~sess",
		"+",
		"+1",
		"-",
		"-t",
		"-sess",
		"{next}",
		"{last}",
		"{",
		"*",
		"exist*",
		"*exist",
		"?",
		"exist?",
		"?exist",
		"[a]",
		"[exist",
		"exist[0]",
		"exist]",
		"exist:0",
		"exist:",
		":0",
		"exist.0",
		"exist.",
		".0",
		`exist\0`,
		`\exist`,
		`exist"quote`,
		`exist'quote`,
		" leading",
		"trailing ",
		" ",
		"tab\tname",
		"line\nname",
		"ctrl\x00name",
		"ctrl\x1bname",
		"ctrl\x7fname",
		strings.Repeat("a", 65),
		"tmuxatlas-ctrl",
	}

	for i, bad := range invalidNames {
		if err := tmux.ValidateSessionName(bad); err == nil {
			t.Fatalf("ValidateSessionName(%q) succeeded", bad)
		}
		if err := client.NewSession(bad); err == nil {
			t.Fatalf("NewSession(%q) succeeded", bad)
		}
		if err := client.NewOwnedSession(bad, "", "admin"); err == nil {
			t.Fatalf("NewOwnedSession(%q) succeeded", bad)
		}
		if err := client.RenameSession("existing", bad); err == nil {
			t.Fatalf("RenameSession(existing, %q) succeeded", bad)
		}

		// Local router: new and rename
		_, err := router.Execute(context.Background(), "new",
			SessionTarget{HostID: manager.LocalID(), Session: bad}, json.RawMessage(`{"owner":"admin"}`))
		var runtimeErr RuntimeError
		if !errors.As(err, &runtimeErr) || runtimeErr.Code != ErrorInvalidTarget || runtimeErr.Message == "" {
			t.Fatalf("router new(%q): got %#v (%v), want invalid-target with message", bad, runtimeErr, err)
		}

		renamePayload, _ := json.Marshal(map[string]string{"new_name": bad})
		_, err = router.Execute(context.Background(), "rename",
			SessionTarget{HostID: manager.LocalID(), Session: "existing"}, renamePayload)
		runtimeErr = RuntimeError{}
		if !errors.As(err, &runtimeErr) || runtimeErr.Code != ErrorInvalidTarget || runtimeErr.Message == "" {
			t.Fatalf("router rename(%q): got %#v (%v), want invalid-target with message", bad, runtimeErr, err)
		}

		// Peer dispatcher + executor: new and rename
		_, outcome := dispatcher.Dispatch(context.Background(), RuntimeRequest{
			RequestID:  "req-new-" + string(rune('a'+i%26)) + string(rune('a'+i/26)),
			Generation: 1,
			Deadline:   time.Now().Add(time.Minute),
			Operation:  "new",
			Target:     SessionTarget{HostID: manager.LocalID(), Session: bad},
			Payload:    json.RawMessage(`{}`),
		})
		if outcome.Error == nil || outcome.Error.Code != ErrorInvalidTarget || outcome.Error.Message == "" {
			t.Fatalf("dispatcher new(%q): got %+v", bad, outcome.Error)
		}

		_, outcome = dispatcher.Dispatch(context.Background(), RuntimeRequest{
			RequestID:  "req-ren-" + string(rune('a'+i%26)) + string(rune('a'+i/26)),
			Generation: 1,
			Deadline:   time.Now().Add(time.Minute),
			Operation:  "rename",
			Target:     SessionTarget{HostID: manager.LocalID(), Session: "existing"},
			Payload:    renamePayload,
		})
		if outcome.Error == nil || outcome.Error.Code != ErrorInvalidTarget || outcome.Error.Message == "" {
			t.Fatalf("dispatcher rename(%q): got %+v", bad, outcome.Error)
		}
	}

	// Renaming a session to another existing session's name must be rejected.
	dupPayload := json.RawMessage(`{"new_name":"other-owned"}`)
	_, err = router.Execute(context.Background(), "rename",
		SessionTarget{HostID: manager.LocalID(), Session: "existing"}, dupPayload)
	var runtimeErr RuntimeError
	if !errors.As(err, &runtimeErr) || runtimeErr.Code != ErrorInvalidTarget {
		t.Fatalf("rename to existing session: got %v, want invalid-target", err)
	}
}
