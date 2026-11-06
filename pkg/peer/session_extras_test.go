package peer

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/LosFurina/tmuxatlas/pkg/tmux"
	"github.com/LosFurina/tmuxatlas/pkg/toolevents"
)

// isolatedTmux points tmux at a private socket directory so tests can never
// reach the user's real server.
func isolatedTmux(t *testing.T) *tmux.Client {
	t.Helper()
	dir, err := os.MkdirTemp("", "tmx")
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("TMUX_TMPDIR", dir)
	t.Setenv("TMUX", "")
	t.Setenv("TMUX_PANE", "")
	os.Unsetenv("TMUX")
	os.Unsetenv("TMUX_PANE")
	client, err := tmux.NewClient()
	if err != nil {
		t.Skip("tmux not available")
	}
	t.Cleanup(func() {
		_, _ = client.Exec("kill-server")
		os.RemoveAll(dir)
	})
	return client
}

func runExec(t *testing.T, client *tmux.Client, op, session string, payload any) (json.RawMessage, error) {
	t.Helper()
	raw, _ := json.Marshal(payload)
	return tmuxRuntimeExecutor{client: client}.Execute(context.Background(), op,
		SessionTarget{HostID: "local", Session: session}, raw)
}

func startPromptSession(t *testing.T, client *tmux.Client, name, script string) string {
	t.Helper()
	if _, err := client.Exec("new-session", "-d", "-s", name, "-x", "100", "-y", "30", "bash", "-c", script); err != nil {
		t.Fatal(err)
	}
	out, err := client.Exec("list-panes", "-t", "="+name+":", "-F", "#{pane_id}")
	if err != nil {
		t.Fatal(err)
	}
	return strings.TrimSpace(out)
}

func waitForText(t *testing.T, client *tmux.Client, pane, text string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if out, _ := client.CapturePaneText(pane); strings.Contains(out, text) {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	out, _ := client.CapturePaneText(pane)
	t.Fatalf("timeout waiting for %q in:\n%s", text, out)
}

const menuScript = `printf 'Proceed with the edit?\n> 1. Yes\n  2. No\n'; read -n1 x; echo "GOT:$x"; sleep 30`

func previewPrompt(t *testing.T, client *tmux.Client, session, pane string) toolevents.PromptInfo {
	t.Helper()
	raw, err := runExec(t, client, "preview", session, map[string]any{"pane": pane})
	if err != nil {
		t.Fatal(err)
	}
	var result struct {
		Prompt *toolevents.PromptInfo `json:"prompt"`
	}
	if err := json.Unmarshal(raw, &result); err != nil || result.Prompt == nil {
		t.Fatalf("no prompt: %s %v", raw, err)
	}
	return *result.Prompt
}

func TestPreviewReturnsLinesAndPrompt(t *testing.T) {
	client := isolatedTmux(t)
	pane := startPromptSession(t, client, "prev", menuScript)
	waitForText(t, client, pane, "2. No")
	raw, err := runExec(t, client, "preview", "prev", map[string]any{"lines": 100})
	if err != nil {
		t.Fatal(err)
	}
	var result struct {
		Pane   string                 `json:"pane"`
		Window int                    `json:"window"`
		Lines  []string               `json:"lines"`
		Prompt *toolevents.PromptInfo `json:"prompt"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		t.Fatal(err)
	}
	if result.Pane != pane || len(result.Lines) != 3 || result.Lines[2] != "  2. No" {
		t.Fatalf("unexpected preview: %s", raw)
	}
	if result.Prompt == nil || !result.Prompt.IsPrompt || len(result.Prompt.Options) != 2 || result.Prompt.Fingerprint == "" {
		t.Fatalf("prompt: %s", raw)
	}
	raw, _ = runExec(t, client, "preview", "prev", map[string]any{"lines": 1})
	if !strings.Contains(string(raw), `"lines":["  2. No"]`) {
		t.Fatalf("lines not limited: %s", raw)
	}
}

func TestReplySuccessSendsDigitWithoutEnter(t *testing.T) {
	client := isolatedTmux(t)
	pane := startPromptSession(t, client, "ok", menuScript)
	waitForText(t, client, pane, "2. No")
	prompt := previewPrompt(t, client, "ok", pane)
	if _, err := runExec(t, client, "reply", "ok", map[string]string{"pane": pane, "key": "1", "fingerprint": prompt.Fingerprint}); err != nil {
		t.Fatal(err)
	}
	waitForText(t, client, pane, "GOT:1") // read -n1 returned without Enter
}

func TestReplyYesNoSendsLetterAndEnter(t *testing.T) {
	client := isolatedTmux(t)
	pane := startPromptSession(t, client, "yn", `printf 'Overwrite file? (y/n) '; read x; echo "GOT:$x"; sleep 30`)
	waitForText(t, client, pane, "(y/n)")
	prompt := previewPrompt(t, client, "yn", pane)
	if _, err := runExec(t, client, "reply", "yn", map[string]string{"pane": pane, "key": "n", "fingerprint": prompt.Fingerprint}); err != nil {
		t.Fatal(err)
	}
	waitForText(t, client, pane, "GOT:n")
}

func codeOf(err error) ErrorCode {
	var runtimeError RuntimeError
	if errors.As(err, &runtimeError) {
		return runtimeError.Code
	}
	return ""
}

func TestReplyRejectsStaleFingerprintUnlistedKeyAndForeignPane(t *testing.T) {
	client := isolatedTmux(t)
	pane := startPromptSession(t, client, "one", menuScript)
	other := startPromptSession(t, client, "two", menuScript)
	waitForText(t, client, pane, "2. No")
	waitForText(t, client, other, "2. No")
	prompt := previewPrompt(t, client, "one", pane)

	_, err := runExec(t, client, "reply", "one", map[string]string{"pane": pane, "key": "1", "fingerprint": "deadbeef"})
	if codeOf(err) != ErrorPromptChanged {
		t.Fatalf("stale fingerprint: %v", err)
	}
	_, err = runExec(t, client, "reply", "one", map[string]string{"pane": pane, "key": "9", "fingerprint": prompt.Fingerprint})
	if codeOf(err) != ErrorInvalidTarget {
		t.Fatalf("unlisted key: %v", err)
	}
	_, err = runExec(t, client, "reply", "one", map[string]string{"pane": other, "key": "1", "fingerprint": prompt.Fingerprint})
	if codeOf(err) != ErrorInvalidTarget {
		t.Fatalf("foreign pane: %v", err)
	}
	_, err = runExec(t, client, "reply", "one", map[string]string{"pane": "%1;rm", "key": "1", "fingerprint": prompt.Fingerprint})
	if codeOf(err) != ErrorInvalidTarget {
		t.Fatalf("malformed pane: %v", err)
	}
	// Nothing must have been typed in either pane.
	time.Sleep(200 * time.Millisecond)
	for _, p := range []string{pane, other} {
		if out, _ := client.CapturePaneText(p); strings.Contains(out, "GOT:") {
			t.Fatalf("a rejected reply typed into %s:\n%s", p, out)
		}
	}
	// Prompt gone: after answering, a repeat with the old fingerprint conflicts.
	if _, err := runExec(t, client, "reply", "one", map[string]string{"pane": pane, "key": "2", "fingerprint": prompt.Fingerprint}); err != nil {
		t.Fatal(err)
	}
	waitForText(t, client, pane, "GOT:2")
	_, err = runExec(t, client, "reply", "one", map[string]string{"pane": pane, "key": "2", "fingerprint": prompt.Fingerprint})
	if codeOf(err) != ErrorPromptChanged {
		t.Fatalf("gone prompt: %v", err)
	}
}

func TestNewSessionCwdAndAgent(t *testing.T) {
	client := isolatedTmux(t)
	dir := t.TempDir()
	// A fake "claude" on PATH proves the allow-listed command is typed into a shell.
	bin := t.TempDir()
	if err := os.WriteFile(filepath.Join(bin, "claude"), []byte("#!/bin/sh\necho AGENT-RAN\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("SHELL", "/bin/sh") // avoid user rc files reordering PATH
	t.Setenv("ENV", "")
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))

	mustExec(t, client, "new-session", "-d", "-s", "boot", ";", "set-option", "-g", "default-shell", "/bin/sh", ";", "set-option", "-g", "default-command", "/bin/sh")
	if _, err := runExec(t, client, "new", "proj", map[string]string{"cwd": dir, "agent": "claude"}); err != nil {
		t.Fatal(err)
	}
	pane := strings.TrimSpace(mustExec(t, client, "list-panes", "-t", "=proj:", "-F", "#{pane_id}"))
	waitForText(t, client, pane, "AGENT-RAN")
	if got := strings.TrimSpace(mustExec(t, client, "display-message", "-p", "-t", pane, "#{pane_current_path}")); got != dir {
		t.Fatalf("cwd = %q, want %q", got, dir)
	}

	// Unchanged behavior without fields.
	if _, err := runExec(t, client, "new", "plain", map[string]string{}); err != nil {
		t.Fatal(err)
	}
	for name, payload := range map[string]map[string]string{
		"bad1": {"agent": "rm -rf /"},
		"bad2": {"agent": "bash"},
		"bad3": {"cwd": "relative/dir"},
		"bad4": {"cwd": filepath.Join(dir, "missing")},
		"bad5": {"cwd": filepath.Join(bin, "claude")},
	} {
		if _, err := runExec(t, client, "new", name, payload); codeOf(err) != ErrorInvalidTarget {
			t.Fatalf("%s: %v", name, err)
		}
		if _, err := client.Exec("has-session", "-t", "="+name); err == nil {
			t.Fatalf("%s: session was created", name)
		}
	}
}

func mustExec(t *testing.T, client *tmux.Client, args ...string) string {
	t.Helper()
	out, err := client.Exec(args...)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func TestNewSessionExpandsHome(t *testing.T) {
	client := isolatedTmux(t)
	home := t.TempDir()
	t.Setenv("HOME", home)
	if err := os.Mkdir(filepath.Join(home, "work"), 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := runExec(t, client, "new", "tilde", map[string]string{"cwd": "~/work"}); err != nil {
		t.Fatal(err)
	}
}

func TestListDirectories(t *testing.T) {
	root := t.TempDir()
	other := t.TempDir()
	for _, d := range []string{"Zeta", "alpha", ".hidden", "Beta"} {
		os.Mkdir(filepath.Join(root, d), 0o755)
	}
	os.WriteFile(filepath.Join(root, "file.txt"), nil, 0o644)
	os.Mkdir(filepath.Join(other, "other"), 0o755)
	t.Setenv("TMUXATLAS_PROJECT_DIRS", root+","+filepath.Join(root, "absent")+":"+other)
	raw, err := listDirectories()
	if err != nil {
		t.Fatal(err)
	}
	var result struct {
		Directories []struct{ Name, Path string } `json:"directories"`
	}
	json.Unmarshal(raw, &result)
	var names []string
	for _, d := range result.Directories {
		names = append(names, d.Name)
	}
	if strings.Join(names, ",") != "alpha,Beta,other,Zeta" {
		t.Fatalf("names=%v", names)
	}
	if result.Directories[0].Path != filepath.Join(root, "alpha") {
		t.Fatalf("path=%q", result.Directories[0].Path)
	}
}

func TestListDirectoriesCapsAt200(t *testing.T) {
	root := t.TempDir()
	for i := 0; i < 230; i++ {
		os.Mkdir(filepath.Join(root, "d"+string(rune('a'+i/26))+string(rune('a'+i%26))), 0o755)
	}
	t.Setenv("TMUXATLAS_PROJECT_DIRS", root)
	raw, _ := listDirectories()
	var result struct {
		Directories []json.RawMessage `json:"directories"`
	}
	json.Unmarshal(raw, &result)
	if len(result.Directories) != 200 {
		t.Fatalf("got %d", len(result.Directories))
	}
}

func TestSanitizeLineAndPreviewLines(t *testing.T) {
	long := strings.Repeat("é", 600)
	lines := previewLines("a\x1b[31m\x00b\n"+long+"\n\n  \n", 5)
	if len(lines) != 2 || lines[0] != "a[31mb" {
		t.Fatalf("lines=%q", lines)
	}
	if n := len([]rune(lines[1])); n != maxPreviewLineRunes {
		t.Fatalf("not truncated rune-safely: %d", n)
	}
}

func TestUnknownOperationIsUnsupported(t *testing.T) {
	_, err := runExec(t, isolatedTmux(t), "frobnicate", "x", map[string]string{})
	if codeOf(err) != ErrorUnsupported {
		t.Fatalf("err=%v", err)
	}
}

func TestDispatcherOldAgentWithoutExtrasIsUnsupported(t *testing.T) {
	executor := &recordingExecutor{}
	cache, _ := NewOutcomeCache(DefaultOutcomeCacheConfig(), nil)
	dispatcher := &RequestDispatcher{
		Generation: 1, HostID: "h", Executor: executor, Cache: cache,
		Capabilities: map[string]struct{}{CapabilitySessionActions: {}},
	}
	for _, op := range []string{"preview", "reply", "directories"} {
		request := RuntimeRequest{RequestID: "r" + op, Generation: 1, Deadline: time.Now().Add(time.Minute),
			Operation: op, Target: SessionTarget{HostID: "h", Session: "s"}, Payload: json.RawMessage(`{}`)}
		_, outcome := dispatcher.Dispatch(context.Background(), request)
		if outcome.Error == nil || outcome.Error.Code != ErrorUnsupported {
			t.Fatalf("%s: %+v", op, outcome)
		}
	}
	if executor.calls.Load() != 0 {
		t.Fatal("executor must not run")
	}
	request := RuntimeRequest{RequestID: "rnew", Generation: 1, Deadline: time.Now().Add(time.Minute),
		Operation: "new", Target: SessionTarget{HostID: "h", Session: "s"}, Payload: json.RawMessage(`{"cwd":"/tmp"}`)}
	if _, outcome := dispatcher.Dispatch(context.Background(), request); outcome.Error == nil || outcome.Error.Code != ErrorUnsupported {
		t.Fatalf("new with cwd: %+v", outcome)
	}
	request.RequestID, request.Payload = "rplain", json.RawMessage(`{}`)
	if _, outcome := dispatcher.Dispatch(context.Background(), request); outcome.Error != nil {
		t.Fatalf("plain new must still work: %+v", outcome.Error)
	}
}

type failingExecutor struct{ err error }

func (e failingExecutor) Execute(context.Context, string, SessionTarget, json.RawMessage) (json.RawMessage, error) {
	return nil, e.err
}

func TestDispatcherAndLocalRouterPreserveTypedErrors(t *testing.T) {
	cache, _ := NewOutcomeCache(DefaultOutcomeCacheConfig(), nil)
	dispatcher := &RequestDispatcher{
		Generation: 1, HostID: "h", Cache: cache,
		Executor:     failingExecutor{RuntimeError{Code: ErrorPromptChanged, Message: "gone"}},
		Capabilities: map[string]struct{}{CapabilitySessionActions: {}, CapabilitySessionExtras: {}},
	}
	request := RuntimeRequest{RequestID: "r1", Generation: 1, Deadline: time.Now().Add(time.Minute),
		Operation: "reply", Target: SessionTarget{HostID: "h", Session: "s"}, Payload: json.RawMessage(`{}`)}
	_, outcome := dispatcher.Dispatch(context.Background(), request)
	if outcome.Error == nil || outcome.Error.Code != ErrorPromptChanged || outcome.Error.RequestID != "r1" {
		t.Fatalf("%+v", outcome)
	}
	if err := outcome.Error.ValidateCorrelated(); err != nil {
		t.Fatalf("new code must validate: %v", err)
	}

	manager := newRouterManager(t)
	router := NewActionRouter(manager, failingExecutor{RuntimeError{Code: ErrorPromptChanged}}, time.Second)
	manager.UpdatePeerSessions(manager.LocalID(), []*tmux.Session{{Name: "s"}})
	_, err := router.Execute(context.Background(), "reply", SessionTarget{HostID: manager.LocalID(), Session: "s"}, json.RawMessage(`{}`))
	if codeOf(err) != ErrorPromptChanged {
		t.Fatalf("local router err=%v", err)
	}
}
