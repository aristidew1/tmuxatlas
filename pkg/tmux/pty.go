package tmux

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/creack/pty/v2"
	"github.com/sirupsen/logrus"
)

var (
	ptyCloseGrace     = 2 * time.Second
	ptyTerminateGrace = time.Second
	paneIDPattern     = regexp.MustCompile(`^%[0-9]+$`)
)

// PTYSession wraps a PTY running `tmux attach-session`
type PTYSession struct {
	cmd   *exec.Cmd
	ptyFd *os.File
	close sync.Once
}

// NewPTYSession spawns `tmux attach-session -t <session>` in a PTY
func NewPTYSession(tmuxPath, sessionName string, cols, rows uint16) (*PTYSession, error) {
	sessionTarget, err := resolveSessionTarget(tmuxPath, sessionName)
	if err != nil {
		return nil, err
	}
	windowTarget, err := resolveWindowTarget(tmuxPath, sessionName, "")
	if err != nil {
		return nil, err
	}
	// A mouse selection or scroll can leave the active pane in tmux copy mode
	// after the browser disconnects. Resume the live view when it reattaches;
	// never send a keystroke to the program running in the pane.
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	if err := exec.CommandContext(ctx, tmuxPath, "has-session", "-t", sessionTarget).Run(); err != nil {
		cancel()
		return nil, fmt.Errorf("tmux has-session -t %s: %w", sessionTarget, err)
	}
	pane, err := exec.CommandContext(ctx, tmuxPath, "display-message", "-p", "-t", windowTarget, "#{pane_id}").Output()
	paneID := strings.TrimSpace(string(pane))
	if err == nil && paneIDPattern.MatchString(paneID) {
		err = exec.CommandContext(ctx, tmuxPath, "if-shell", "-F", "-t", paneID, "#{||:#{==:#{pane_mode},copy-mode},#{==:#{pane_mode},view-mode}}", "send-keys -t "+paneID+" -X cancel").Run()
	}
	if err != nil {
		logrus.WithError(err).WithField("session", sessionName).Debug("could not leave tmux copy mode")
	}
	cancel()
	cmd := exec.Command(tmuxPath, "attach-session", "-t", sessionTarget)
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")

	f, err := pty.StartWithSize(cmd, &pty.Winsize{
		Cols: cols,
		Rows: rows,
	})
	if err != nil {
		return nil, err
	}

	logrus.WithFields(logrus.Fields{
		"session": sessionName,
		"cols":    cols,
		"rows":    rows,
	}).Info("started PTY session")

	return &PTYSession{
		cmd:   cmd,
		ptyFd: f,
	}, nil
}

// Read reads from the PTY master fd
func (p *PTYSession) Read(buf []byte) (int, error) {
	return p.ptyFd.Read(buf)
}

// Write writes to the PTY master fd
func (p *PTYSession) Write(data []byte) (int, error) {
	return p.ptyFd.Write(data)
}

// Resize changes the PTY window size
func (p *PTYSession) Resize(cols, rows uint16) error {
	return pty.Setsize(p.ptyFd, &pty.Winsize{
		Cols: cols,
		Rows: rows,
	})
}

// Close closes the PTY and waits for the subprocess to exit
func (p *PTYSession) Close() {
	p.close.Do(func() {
		_ = p.ptyFd.Close()
		done := make(chan struct{})
		go func() {
			_ = p.cmd.Wait()
			close(done)
		}()
		select {
		case <-done:
		case <-time.After(ptyCloseGrace):
			if p.cmd.Process != nil {
				_ = p.cmd.Process.Signal(os.Interrupt)
			}
			select {
			case <-done:
			case <-time.After(ptyTerminateGrace):
				if p.cmd.Process != nil {
					_ = p.cmd.Process.Kill()
				}
				<-done
			}
		}
		logrus.Debug("PTY session closed")
	})
}
