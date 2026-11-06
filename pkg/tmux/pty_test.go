package tmux

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPTYAttachReturnsCopyModeToLiveView(t *testing.T) {
	tmuxPath, err := exec.LookPath("tmux")
	if err != nil {
		t.Skip("tmux is not installed")
	}
	dir := t.TempDir()
	socket := filepath.Join(dir, "tmux.sock")
	run := func(args ...string) string {
		t.Helper()
		output, err := exec.Command(tmuxPath, append([]string{"-S", socket}, args...)...).CombinedOutput()
		if err != nil {
			t.Fatalf("tmux %v: %v: %s", args, err, output)
		}
		return strings.TrimSpace(string(output))
	}
	run("-f", "/dev/null", "new-session", "-d", "-s", "example")
	t.Cleanup(func() { _ = exec.Command(tmuxPath, "-S", socket, "kill-server").Run() })
	run("copy-mode", "-t", "example:0.0")
	run("new-session", "-d", "-s", "another")
	run("copy-mode", "-t", "another:0.0")
	if got := run("display-message", "-p", "-t", "example:0.0", "#{pane_mode}"); got != "copy-mode" {
		t.Fatalf("expected copy mode, got %q", got)
	}
	wrapper := filepath.Join(dir, "tmux-wrapper")
	if err := os.WriteFile(wrapper, []byte("#!/bin/sh\nexec \""+tmuxPath+"\" -S \""+socket+"\" \"$@\"\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	session, err := NewPTYSession(wrapper, "example", 80, 24)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	if got := run("display-message", "-p", "-t", "example:0.0", "#{pane_in_mode}"); got != "0" {
		t.Fatalf("expected live view, got pane_in_mode=%q", got)
	}
	if got := run("display-message", "-p", "-t", "another:0.0", "#{pane_in_mode}"); got != "1" {
		t.Fatalf("other session's copy mode was changed: pane_in_mode=%q", got)
	}
}

func TestPTYCloseForcesUnresponsiveAttachProcessAndIsIdempotent(t *testing.T) {
	script := filepath.Join(t.TempDir(), "fake-tmux")
	if err := os.WriteFile(script, []byte("#!/bin/sh\nif [ \"$1\" != attach-session ]; then exit 0; fi\ntrap '' HUP INT TERM\nwhile :; do sleep 1; done\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	previousClose, previousTerminate := ptyCloseGrace, ptyTerminateGrace
	ptyCloseGrace, ptyTerminateGrace = 20*time.Millisecond, 20*time.Millisecond
	t.Cleanup(func() {
		ptyCloseGrace, ptyTerminateGrace = previousClose, previousTerminate
	})
	session, err := NewPTYSession(script, "work", 80, 24)
	if err != nil {
		t.Fatal(err)
	}
	start := time.Now()
	session.Close()
	session.Close()
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Fatalf("PTY Close took %s", elapsed)
	}
	if session.cmd.ProcessState == nil {
		t.Fatal("PTY attach subprocess was not reaped")
	}
}
