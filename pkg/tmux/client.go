package tmux

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

var windowIDPattern = regexp.MustCompile(`^@[0-9]+$`)

// ExactSession returns a tmux session target that matches the session name
// exactly rather than by prefix, fnmatch, or window/pane token.
func ExactSession(name string) string {
	return "=" + name
}

// ExactWindow returns a tmux window target for the exact session name.
// When window is empty, it targets the active window of that session ("=name:").
func ExactWindow(session, window string) string {
	return ExactSession(session) + ":" + window
}

// ValidateSessionName checks that a new or renamed session name cannot be
// interpreted by tmux as a target ID, glob, token, or separator.
func ValidateSessionName(name string) error {
	if name == "" {
		return errors.New("le nom de session est requis")
	}
	if len(name) > 64 {
		return errors.New("le nom de session ne doit pas dépasser 64 caractères")
	}
	if name == controlSessionName {
		return errors.New("ce nom de session est réservé")
	}
	if !utf8.ValidString(name) {
		return errors.New("le nom de session contient des caractères UTF-8 invalides")
	}
	if strings.TrimSpace(name) != name {
		return errors.New("le nom de session ne doit pas commencer ou finir par un espace")
	}
	for i, r := range name {
		if unicode.IsControl(r) || (unicode.IsSpace(r) && r != ' ') {
			return errors.New("le nom de session ne doit pas contenir de caractère de contrôle")
		}
		if i == 0 && strings.ContainsRune("$@%=~+{*?[-", r) {
			return fmt.Errorf("le nom de session ne peut pas commencer par %q", r)
		}
		if strings.ContainsRune(":.*?[]\\\"'{}", r) {
			return fmt.Errorf("le nom de session ne peut pas contenir %q", r)
		}
	}
	return nil
}

func lookupSessionID(tmuxPath, name string) (string, error) {
	if name == "" || name == controlSessionName || strings.ContainsAny(name, ":.") || strings.IndexByte(name, 0) >= 0 {
		return "", fmt.Errorf("session invalide: %s", name)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, tmuxPath, "list-sessions", "-F", "#{session_id}\t#{session_name}").Output()
	if err != nil {
		return "", fmt.Errorf("can't find session: %s", name)
	}
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "\t", 2)
		if len(parts) == 2 && parts[1] != controlSessionName && parts[1] == name {
			return parts[0], nil
		}
	}
	return "", fmt.Errorf("can't find session: %s", name)
}

func resolveSessionTarget(tmuxPath, name string) (string, error) {
	if name == "" || name == controlSessionName || strings.ContainsAny(name, ":.") || strings.IndexByte(name, 0) >= 0 {
		return "", fmt.Errorf("session invalide: %s", name)
	}
	if strings.HasPrefix(name, "$") {
		return lookupSessionID(tmuxPath, name)
	}
	return ExactSession(name), nil
}

func resolveWindowTarget(tmuxPath, session, window string) (string, error) {
	if strings.ContainsAny(window, ":.") || strings.IndexByte(window, 0) >= 0 {
		return "", fmt.Errorf("fenêtre invalide: %s", window)
	}
	target, err := resolveSessionTarget(tmuxPath, session)
	if err != nil {
		return "", err
	}
	if strings.HasPrefix(session, "$") {
		return target + ":" + window, nil
	}
	return ExactWindow(session, window), nil
}

// SessionTarget returns the exact tmux target for a session name, resolving
// pre-existing "$..." session names to their internal session ID so tmux does
// not confuse them with another session's ID.
func (c *Client) SessionTarget(name string) (string, error) {
	return resolveSessionTarget(c.tmuxPath, name)
}

// WindowTarget returns the exact tmux window target for a session name and
// optional window index.
func (c *Client) WindowTarget(session, window string) (string, error) {
	return resolveWindowTarget(c.tmuxPath, session, window)
}

// Client wraps tmux CLI commands
type Client struct {
	tmuxPath string
}

// NewClient creates a new tmux client
func NewClient() (*Client, error) {
	path, err := exec.LookPath("tmux")
	if err != nil {
		return nil, fmt.Errorf("tmux not found in PATH: %w", err)
	}
	return &Client{tmuxPath: path}, nil
}

// TmuxPath returns the path to the tmux binary
func (c *Client) TmuxPath() string {
	return c.tmuxPath
}

// Exec runs a tmux command and returns stdout
func (c *Client) Exec(args ...string) (string, error) {
	cmd := exec.Command(c.tmuxPath, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	if err != nil {
		return "", fmt.Errorf("tmux %s: %w: %s", strings.Join(args, " "), err, stderr.String())
	}
	return stdout.String(), nil
}

// ListSessions returns all tmux sessions
func (c *Client) ListSessions() ([]*Session, error) {
	out, err := c.Exec("list-sessions", "-F", "#{session_id}:#{session_name}:#{session_created}:#{session_attached}:#{session_activity}:#{@atlas-owner}")
	if err != nil {
		message := err.Error()
		if strings.Contains(message, "no server running") || strings.Contains(message, "no sessions") ||
			(strings.Contains(message, "error connecting to ") && strings.Contains(message, "No such file or directory")) {
			return nil, nil
		}
		return nil, err
	}

	var sessions []*Session
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, ":", 6)
		if len(parts) < 6 {
			continue
		}

		if parts[1] == "tmuxatlas-ctrl" {
			continue
		}

		created, _ := strconv.ParseInt(parts[2], 10, 64)
		attached := parts[3] != "0"
		activity, _ := strconv.ParseInt(parts[4], 10, 64)

		sessions = append(sessions, &Session{
			ID:           parts[0],
			Name:         parts[1],
			Owner:        Owner(parts[5]),
			Created:      time.Unix(created, 0),
			Attached:     attached,
			LastActivity: time.Unix(activity, 0),
		})
	}
	return sessions, nil
}

// ListWindows returns windows for a session
func (c *Client) ListWindows(sessionName string) ([]*Window, error) {
	target, err := c.SessionTarget(sessionName)
	if err != nil {
		return nil, err
	}
	out, err := c.Exec("list-windows", "-t", target, "-F",
		"#{window_id}:#{session_id}:#{window_name}:#{window_index}:#{window_active}:#{window_layout}")
	if err != nil {
		return nil, err
	}

	var windows []*Window
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, ":", 6)
		if len(parts) < 6 {
			continue
		}
		idx, _ := strconv.Atoi(parts[3])
		windows = append(windows, &Window{
			ID:        parts[0],
			SessionID: parts[1],
			Name:      parts[2],
			Index:     idx,
			Active:    parts[4] == "1",
			Layout:    parts[5],
		})
	}
	return windows, nil
}

// ListPanes returns panes for a window
func (c *Client) ListPanes(target string) ([]*Pane, error) {
	resolved := target
	if !windowIDPattern.MatchString(target) && !paneIDPattern.MatchString(target) {
		session := strings.TrimSuffix(strings.TrimPrefix(target, "="), ":")
		var err error
		resolved, err = c.WindowTarget(session, "")
		if err != nil {
			return nil, err
		}
	}
	out, err := c.Exec("list-panes", "-t", resolved, "-F",
		"#{pane_id}:#{window_id}:#{session_id}:#{pane_index}:#{pane_active}:#{pane_width}:#{pane_height}:#{pane_current_command}:#{pane_pid}")
	if err != nil {
		return nil, err
	}

	var panes []*Pane
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, ":", 9)
		if len(parts) < 9 {
			continue
		}
		idx, _ := strconv.Atoi(parts[3])
		w, _ := strconv.Atoi(parts[5])
		h, _ := strconv.Atoi(parts[6])
		pid, _ := strconv.Atoi(parts[8])
		panes = append(panes, &Pane{
			ID:             parts[0],
			WindowID:       parts[1],
			SessionID:      parts[2],
			Index:          idx,
			Active:         parts[4] == "1",
			Width:          w,
			Height:         h,
			CurrentCommand: parts[7],
			PID:            pid,
		})
	}
	return panes, nil
}

// ListAllPanesDetailed returns all panes with session name and window index
// resolved by tmux (avoids extra ListSessions/ListWindows calls).
func (c *Client) ListAllPanesDetailed() ([]*PaneDetailed, error) {
	out, err := c.Exec("list-panes", "-a", "-F",
		"#{pane_id}:#{session_name}:#{window_index}:#{pane_pid}:#{pane_current_command}")
	if err != nil {
		if strings.Contains(err.Error(), "no server running") || strings.Contains(err.Error(), "no sessions") {
			return nil, nil
		}
		return nil, err
	}

	var panes []*PaneDetailed
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, ":", 5)
		if len(parts) < 5 {
			continue
		}
		winIdx, _ := strconv.Atoi(parts[2])
		pid, _ := strconv.Atoi(parts[3])
		panes = append(panes, &PaneDetailed{
			ID:             parts[0],
			Session:        parts[1],
			Window:         winIdx,
			PID:            pid,
			CurrentCommand: parts[4],
		})
	}
	return panes, nil
}

// ListAllPanes returns all panes across all sessions
func (c *Client) ListAllPanes() ([]*Pane, error) {
	out, err := c.Exec("list-panes", "-a", "-F",
		"#{pane_id}:#{window_id}:#{session_id}:#{pane_index}:#{pane_active}:#{pane_width}:#{pane_height}:#{pane_current_command}:#{pane_pid}")
	if err != nil {
		if strings.Contains(err.Error(), "no server running") || strings.Contains(err.Error(), "no sessions") {
			return nil, nil
		}
		return nil, err
	}

	var panes []*Pane
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, ":", 9)
		if len(parts) < 9 {
			continue
		}
		idx, _ := strconv.Atoi(parts[3])
		w, _ := strconv.Atoi(parts[5])
		h, _ := strconv.Atoi(parts[6])
		pid, _ := strconv.Atoi(parts[8])
		panes = append(panes, &Pane{
			ID:             parts[0],
			WindowID:       parts[1],
			SessionID:      parts[2],
			Index:          idx,
			Active:         parts[4] == "1",
			Width:          w,
			Height:         h,
			CurrentCommand: parts[7],
			PID:            pid,
		})
	}
	return panes, nil
}

// HasSession checks if a session exists
func (c *Client) HasSession(name string) bool {
	target, err := c.SessionTarget(name)
	if err != nil {
		return false
	}
	_, err = c.Exec("has-session", "-t", target)
	return err == nil
}

// SelectWindow switches the active window in a session
func (c *Client) SelectWindow(session, index string) error {
	if index == "" {
		return errors.New("window index is required")
	}
	target, err := c.WindowTarget(session, index)
	if err != nil {
		return err
	}
	_, err = c.Exec("select-window", "-t", target)
	return err
}

// SelectPane switches the active pane in a session window
func (c *Client) SelectPane(target string) error {
	if !paneIDPattern.MatchString(target) {
		return fmt.Errorf("invalid pane target: %s", target)
	}
	_, err := c.Exec("select-pane", "-t", target)
	return err
}

// NewSession creates a new tmux session with the given name (detached)
func (c *Client) NewSession(name string) error {
	if err := ValidateSessionName(name); err != nil {
		return err
	}
	_, err := c.Exec("new-session", "-d", "-s", name)
	return err
}

// RenameSession renames a tmux session
func (c *Client) RenameSession(oldName, newName string) error {
	if err := ValidateSessionName(newName); err != nil {
		return err
	}
	target, err := c.SessionTarget(oldName)
	if err != nil {
		return err
	}
	if c.HasSession(newName) {
		return fmt.Errorf("une session nommée %q existe déjà", newName)
	}
	_, err = c.Exec("rename-session", "-t", target, newName)
	return err
}

// KillSession terminates a tmux session. The "=" prefix makes tmux match the
// session name exactly instead of the first session sharing that prefix.
func (c *Client) KillSession(name string) error {
	target, err := c.SessionTarget(name)
	if err != nil {
		return err
	}
	_, err = c.Exec("kill-session", "-t", target)
	return err
}

// CapturePaneContent returns the visible text content of a pane
func (c *Client) CapturePaneContent(paneID string) (string, error) {
	if !paneIDPattern.MatchString(paneID) {
		return "", fmt.Errorf("invalid pane ID: %s", paneID)
	}
	return c.Exec("capture-pane", "-t", paneID, "-p")
}

// CapturePaneText returns the visible text of a pane as plain text (no escape
// sequences), with wrapped lines joined.
func (c *Client) CapturePaneText(paneID string) (string, error) {
	if !paneIDPattern.MatchString(paneID) {
		return "", fmt.Errorf("invalid pane ID: %s", paneID)
	}
	return c.Exec("capture-pane", "-p", "-J", "-t", paneID)
}

// NewSessionIn creates a detached session whose first shell starts in dir.
func (c *Client) NewSessionIn(name, dir string) error {
	if err := ValidateSessionName(name); err != nil {
		return err
	}
	_, err := c.Exec("new-session", "-d", "-s", name, "-c", dir)
	return err
}

func (c *Client) resolveSendTarget(target string) (string, error) {
	if paneIDPattern.MatchString(target) {
		return target, nil
	}
	session := strings.TrimSuffix(strings.TrimPrefix(target, "="), ":")
	return c.WindowTarget(session, "")
}

// SendLiteral types text literally into the target pane (no key-name parsing).
func (c *Client) SendLiteral(target, text string) error {
	resolved, err := c.resolveSendTarget(target)
	if err != nil {
		return err
	}
	_, err = c.Exec("send-keys", "-t", resolved, "-l", "--", text)
	return err
}

// SendEnter presses Enter in the target pane.
func (c *Client) SendEnter(target string) error {
	resolved, err := c.resolveSendTarget(target)
	if err != nil {
		return err
	}
	_, err = c.Exec("send-keys", "-t", resolved, "Enter")
	return err
}
