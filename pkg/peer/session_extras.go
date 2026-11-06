package peer

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode"

	"github.com/LosFurina/tmuxatlas/pkg/tmux"
	"github.com/LosFurina/tmuxatlas/pkg/toolevents"
)

const (
	defaultPreviewLines = 8
	maxPreviewLines     = 40
	maxPreviewLineRunes = 400
	maxDirectories      = 200
	defaultProjectDirs  = "~/Project,~/projects,~/code,~/src,~/dev"
)

var (
	paneIDPattern = regexp.MustCompile(`^%\d{1,9}$`)
	// Strict allow-list of agent commands that may be launched in a new session.
	allowedAgents = map[string]struct{}{"claude": {}, "codex": {}, "opencode": {}, "copilot": {}}
)

// requiresSessionExtras reports whether an operation needs CapabilitySessionExtras.
func requiresSessionExtras(operation string, payload json.RawMessage) bool {
	switch operation {
	case "preview", "reply", "directories":
		return true
	case "new":
		var params struct {
			Cwd   string `json:"cwd"`
			Agent string `json:"agent"`
		}
		_ = json.Unmarshal(payload, &params)
		return params.Cwd != "" || params.Agent != ""
	}
	return false
}

func invalid(message string) error {
	return RuntimeError{Code: ErrorInvalidTarget, Message: message}
}

// ValidateAgent checks the agent allow-list.
func ValidateAgent(agent string) error {
	if _, ok := allowedAgents[agent]; !ok {
		return invalid("agent must be one of claude, codex, opencode, copilot")
	}
	return nil
}

func expandHome(path string) (string, error) {
	if path == "~" || strings.HasPrefix(path, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", RuntimeError{Code: ErrorExecutionFailed, Message: "home directory unavailable"}
		}
		return filepath.Join(home, strings.TrimPrefix(path, "~")), nil
	}
	return path, nil
}

func resolveCwd(cwd string) (string, error) {
	if strings.ContainsRune(cwd, 0) || len(cwd) > 4096 {
		return "", invalid("invalid cwd")
	}
	expanded, err := expandHome(cwd)
	if err != nil {
		return "", err
	}
	if !filepath.IsAbs(expanded) {
		return "", invalid("cwd must be an absolute path")
	}
	expanded = filepath.Clean(expanded)
	info, err := os.Stat(expanded)
	if err != nil {
		return "", invalid("cwd does not exist")
	}
	if !info.IsDir() {
		return "", invalid("cwd is not a directory")
	}
	return expanded, nil
}

func newSession(client *tmux.Client, target SessionTarget, payload json.RawMessage) (json.RawMessage, error) {
	if err := tmux.ValidateSessionName(target.Session); err != nil {
		return nil, invalid(err.Error())
	}
	var params struct {
		Cwd       string  `json:"cwd"`
		Agent     string  `json:"agent"`
		Owner     string  `json:"owner"`
		OwnerName *string `json:"owner_name"`
	}
	if len(payload) > 0 && json.Unmarshal(payload, &params) != nil {
		return nil, invalid("invalid new payload")
	}
	cwd := ""
	if params.Cwd != "" {
		var err error
		if cwd, err = resolveCwd(params.Cwd); err != nil {
			return nil, err
		}
	}
	if params.Agent != "" {
		if err := ValidateAgent(params.Agent); err != nil {
			return nil, err
		}
	}
	if params.Owner != "" {
		names := []string{}
		if params.OwnerName != nil {
			names = append(names, *params.OwnerName)
		}
		if err := client.NewOwnedSession(target.Session, cwd, params.Owner, names...); err != nil {
			return nil, err
		}
	} else if cwd == "" {
		if err := client.NewSession(target.Session); err != nil {
			return nil, err
		}
	} else if err := client.NewSessionIn(target.Session, cwd); err != nil {
		return nil, err
	}
	if params.Agent != "" {
		exact := tmux.ExactWindow(target.Session, "")
		if err := client.SendLiteral(exact, params.Agent); err != nil {
			return nil, err
		}
		if err := client.SendEnter(exact); err != nil {
			return nil, err
		}
	}
	return json.Marshal(map[string]any{"target": target})
}

type sessionPane struct {
	ID     string
	Window int
	Active bool // active pane of the active window
}

func sessionPanes(client *tmux.Client, session string) ([]sessionPane, error) {
	target, err := client.WindowTarget(session, "")
	if err != nil {
		return nil, RuntimeError{Code: ErrorNotFound}
	}
	out, err := client.Exec("list-panes", "-s", "-t", target, "-F",
		"#{pane_id} #{window_index} #{pane_active} #{window_active}")
	if err != nil {
		return nil, RuntimeError{Code: ErrorNotFound}
	}
	var panes []sessionPane
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		f := strings.Fields(line)
		if len(f) != 4 {
			continue
		}
		window, _ := strconv.Atoi(f[1])
		panes = append(panes, sessionPane{ID: f[0], Window: window, Active: f[2] == "1" && f[3] == "1"})
	}
	return panes, nil
}

// resolvePane picks the requested pane, which must belong to the session, or
// the active pane of the active window when none is requested.
func resolvePane(client *tmux.Client, session, pane string) (sessionPane, error) {
	if pane != "" && !paneIDPattern.MatchString(pane) {
		return sessionPane{}, invalid("invalid pane")
	}
	panes, err := sessionPanes(client, session)
	if err != nil {
		return sessionPane{}, err
	}
	for _, candidate := range panes {
		if (pane == "" && candidate.Active) || (pane != "" && candidate.ID == pane) {
			return candidate, nil
		}
	}
	if pane != "" {
		return sessionPane{}, invalid("pane does not belong to session")
	}
	return sessionPane{}, RuntimeError{Code: ErrorNotFound}
}

func sanitizeLine(line string) string {
	line = strings.Map(func(r rune) rune {
		if r == '\t' {
			return ' '
		}
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, line)
	if runes := []rune(line); len(runes) > maxPreviewLineRunes {
		line = string(runes[:maxPreviewLineRunes])
	}
	return strings.TrimRight(line, " ")
}

func previewLines(content string, count int) []string {
	raw := strings.Split(content, "\n")
	for len(raw) > 0 && strings.TrimSpace(raw[len(raw)-1]) == "" {
		raw = raw[:len(raw)-1]
	}
	if len(raw) > count {
		raw = raw[len(raw)-count:]
	}
	lines := make([]string, 0, len(raw))
	for _, line := range raw {
		lines = append(lines, sanitizeLine(line))
	}
	return lines
}

func previewSession(client *tmux.Client, target SessionTarget, payload json.RawMessage) (json.RawMessage, error) {
	var params struct {
		Pane  string `json:"pane"`
		Lines int    `json:"lines"`
	}
	if len(payload) > 0 && json.Unmarshal(payload, &params) != nil {
		return nil, invalid("invalid preview payload")
	}
	if params.Lines <= 0 {
		params.Lines = defaultPreviewLines
	}
	if params.Lines > maxPreviewLines {
		params.Lines = maxPreviewLines
	}
	pane, err := resolvePane(client, target.Session, params.Pane)
	if err != nil {
		return nil, err
	}
	content, err := client.CapturePaneText(pane.ID)
	if err != nil {
		return nil, err
	}
	var prompt *toolevents.PromptInfo
	if info := toolevents.ExtractPromptOptions(content); info.IsPrompt {
		prompt = &info
	} else if detected := toolevents.DetectPrompt(content); detected.IsPrompt {
		lines := previewLines(content, 1)
		message := detected.Message
		if len(lines) == 1 && strings.TrimSpace(lines[0]) != "" {
			message = strings.TrimSpace(lines[0])
		}
		prompt = &toolevents.PromptInfo{IsPrompt: true, Message: message, Options: []toolevents.PromptOption{}}
	}
	return json.Marshal(map[string]any{
		"pane": pane.ID, "window": pane.Window,
		"lines": previewLines(content, params.Lines), "prompt": prompt,
	})
}

func replySession(client *tmux.Client, target SessionTarget, payload json.RawMessage) (json.RawMessage, error) {
	var params struct {
		Pane        string `json:"pane"`
		Key         string `json:"key"`
		Fingerprint string `json:"fingerprint"`
	}
	if json.Unmarshal(payload, &params) != nil || params.Pane == "" || params.Key == "" || params.Fingerprint == "" {
		return nil, invalid("pane, key and fingerprint are required")
	}
	pane, err := resolvePane(client, target.Session, params.Pane)
	if err != nil {
		return nil, err
	}
	content, err := client.CapturePaneText(pane.ID)
	if err != nil {
		return nil, err
	}
	info := toolevents.ExtractPromptOptions(content)
	if !info.IsPrompt || info.Fingerprint != params.Fingerprint {
		return nil, RuntimeError{Code: ErrorPromptChanged, Message: "the prompt changed or is gone"}
	}
	allowed := false
	for _, option := range info.Options {
		if option.Key == params.Key {
			allowed = true
			break
		}
	}
	if !allowed {
		return nil, invalid("key is not one of the detected options")
	}
	if err := client.SendLiteral(pane.ID, params.Key); err != nil {
		return nil, err
	}
	if info.Submit {
		if err := client.SendEnter(pane.ID); err != nil {
			return nil, err
		}
	}
	return json.RawMessage(`{"ok":true}`), nil
}

func listDirectories() (json.RawMessage, error) {
	spec := os.Getenv("TMUXATLAS_PROJECT_DIRS")
	if strings.TrimSpace(spec) == "" {
		spec = defaultProjectDirs
	}
	type entry struct {
		Name string `json:"name"`
		Path string `json:"path"`
	}
	entries := []entry{}
	seen := map[string]bool{}
	for _, root := range strings.FieldsFunc(spec, func(r rune) bool { return r == ':' || r == ',' }) {
		root = strings.TrimSpace(root)
		if root == "" {
			continue
		}
		expanded, err := expandHome(root)
		if err != nil || !filepath.IsAbs(expanded) {
			continue
		}
		children, err := os.ReadDir(expanded)
		if err != nil {
			continue
		}
		for _, child := range children {
			if strings.HasPrefix(child.Name(), ".") {
				continue
			}
			full := filepath.Join(expanded, child.Name())
			if info, err := os.Stat(full); err != nil || !info.IsDir() || seen[full] {
				continue
			}
			seen[full] = true
			entries = append(entries, entry{Name: child.Name(), Path: full})
		}
	}
	sort.SliceStable(entries, func(i, j int) bool {
		a, b := strings.ToLower(entries[i].Name), strings.ToLower(entries[j].Name)
		if a != b {
			return a < b
		}
		return entries[i].Path < entries[j].Path
	})
	if len(entries) > maxDirectories {
		entries = entries[:maxDirectories]
	}
	return json.Marshal(map[string]any{"directories": entries})
}

// requiresOwnership prevents older agents from silently ignoring ownership.
func requiresOwnership(operation string, payload json.RawMessage) bool {
	if operation == "claim" || operation == "release" || operation == "owner" {
		return true
	}
	if operation == "new" {
		var params struct {
			Owner string `json:"owner"`
		}
		_ = json.Unmarshal(payload, &params)
		return params.Owner != ""
	}
	return false
}

// requiresOwnerName prevents an older Agent from silently discarding the name.
func requiresOwnerName(operation string, payload json.RawMessage) bool {
	if operation != "new" && operation != "claim" && operation != "release" {
		return false
	}
	var params map[string]json.RawMessage
	if json.Unmarshal(payload, &params) != nil {
		return false
	}
	_, ok := params["owner_name"]
	return ok
}
