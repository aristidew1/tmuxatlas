package toolevents

import (
	"regexp"
	"strings"
	"time"
)

// ScreenState is what an agent's terminal shows right now.
type ScreenState int

const (
	// ScreenUnknown means the screen offers no positive evidence; the last
	// known state must be kept rather than guessed.
	ScreenUnknown ScreenState = iota
	// ScreenWorking means the agent is producing its answer.
	ScreenWorking
	// ScreenWaiting means the agent is blocked on a question or an approval.
	ScreenWaiting
	// ScreenReady means the agent sits at its input prompt, ready for a message.
	ScreenReady
)

// Observation is the result of reading one capture of a pane.
type Observation struct {
	State ScreenState
	// Finished is true when the screen shows at least one answer, which tells
	// an agent that has finished a turn from one that was just started.
	Finished bool
	// Message is the question being asked, when State is ScreenWaiting.
	Message string
}

const (
	screenTailLines = 30
	// spinnerSearchLines covers a task list printed between the spinner and the input box.
	spinnerSearchLines = 15
	codexSearchLines   = 15
	// Tools without a known screen layout are judged from their output.
	genericWorkingWindow = 5 * time.Second
	genericSilentWindow  = 10 * time.Second
)

var (
	screenRule = regexp.MustCompile(`[─━═-]{10,}`)
	// "✽ Metamorphosing… (11s · ↓ 744 tokens)". A finished turn prints
	// "✻ Crunched for 4s" instead, without the ellipsis.
	claudeSpinner = regexp.MustCompile(`^\s*[✻✽✶✳✢·*∗✦✧⋆]\s+\S.*…\s*(\(.*\))?\s*$`)
	claudeAnswer  = regexp.MustCompile(`^\s*[●⏺]\s|^\s*✻\s+\S+\s+for\s+\d`)
	// Footers of Claude Code's permission and question dialogs.
	claudeDialog = regexp.MustCompile(`(?i)\besc to cancel\b|\benter to (select|confirm|submit)\b|\bdo you want to\b|\bwould you like to\b`)

	interruptHint = regexp.MustCompile(`(?i)\besc to interrupt\b`)
	codexAnswer   = regexp.MustCompile(`^\s*•\s|\bWorked for\b`)
	codexDialog   = regexp.MustCompile(`(?i)\bpress enter to (confirm|submit|continue)\b|\benter to (confirm|submit|select)\b|\bwould you like to (run|make|allow|grant|apply)\b`)
)

// ClassifyScreen reads a capture of an agent's pane. silent is how long the
// pane has been producing no output; only tools without a known screen layout
// rely on it.
func ClassifyScreen(tool Tool, content string, silent time.Duration) Observation {
	lines := screenTail(content)
	if len(lines) == 0 {
		return Observation{}
	}
	switch tool {
	case ToolClaude:
		return classifyClaude(content, lines)
	case ToolCodex:
		return classifyCodex(content, lines)
	default:
		return classifyGeneric(content, silent)
	}
}

// classifyClaude only trusts what surrounds the input box: the conversation
// above may quote any of these strings.
func classifyClaude(content string, lines []string) Observation {
	box := claudeInputBox(lines)
	if box < 0 {
		if message, ok := dialogQuestion(content, lines, claudeDialog); ok {
			return Observation{State: ScreenWaiting, Message: message}
		}
		return Observation{}
	}
	start := box - spinnerSearchLines
	if start < 0 {
		start = 0
	}
	for _, line := range lines[start:box] {
		if claudeSpinner.MatchString(line) || interruptHint.MatchString(line) {
			return Observation{State: ScreenWorking}
		}
	}
	for _, line := range lines[box:] {
		if interruptHint.MatchString(line) {
			return Observation{State: ScreenWorking}
		}
	}
	return Observation{State: ScreenReady, Finished: anyLine(content, claudeAnswer)}
}

// claudeInputBox returns the index of the input line, which sits right under a
// horizontal rule, or -1 when the screen shows something else such as a dialog.
func claudeInputBox(lines []string) int {
	for i := len(lines) - 1; i > 0; i-- {
		line := strings.TrimLeft(lines[i], " │┃|")
		if !strings.HasPrefix(line, "❯") && !strings.HasPrefix(line, ">") {
			continue
		}
		if menuLine.MatchString(lines[i]) {
			continue
		}
		if screenRule.MatchString(lines[i-1]) {
			return i
		}
	}
	return -1
}

func classifyCodex(content string, lines []string) Observation {
	recent := lines
	if len(recent) > codexSearchLines {
		recent = recent[len(recent)-codexSearchLines:]
	}
	hasComposer := false
	for _, line := range recent {
		trimmed := strings.TrimLeft(line, " ")
		if strings.HasPrefix(trimmed, "›") && !menuLine.MatchString(line) {
			hasComposer = true
		}
	}
	if !hasComposer {
		if message, ok := dialogQuestion(content, recent, codexDialog); ok {
			return Observation{State: ScreenWaiting, Message: message}
		}
	}
	for _, line := range recent {
		if interruptHint.MatchString(line) {
			return Observation{State: ScreenWorking}
		}
	}
	if hasComposer {
		return Observation{State: ScreenReady, Finished: anyLine(content, codexAnswer)}
	}
	return Observation{}
}

func classifyGeneric(content string, silent time.Duration) Observation {
	switch {
	case silent < genericWorkingWindow:
		return Observation{State: ScreenWorking}
	case silent < genericSilentWindow:
		return Observation{}
	}
	if info := ExtractPromptOptions(content); info.IsPrompt {
		return Observation{State: ScreenWaiting, Message: info.Message}
	}
	if result := DetectPrompt(content); result.IsPrompt {
		return Observation{State: ScreenWaiting, Message: result.Message}
	}
	return Observation{State: ScreenReady, Finished: true}
}

func dialogQuestion(content string, lines []string, dialog *regexp.Regexp) (string, bool) {
	info := ExtractPromptOptions(content)
	if info.IsPrompt {
		return info.Message, true
	}
	for _, line := range lines {
		if dialog.MatchString(line) {
			return "", true
		}
	}
	return "", false
}

func screenTail(content string) []string {
	var lines []string
	for _, line := range strings.Split(content, "\n") {
		if strings.TrimSpace(line) != "" {
			lines = append(lines, strings.TrimRight(line, " \t\r"))
		}
	}
	if len(lines) > screenTailLines {
		lines = lines[len(lines)-screenTailLines:]
	}
	return lines
}

func anyLine(content string, pattern *regexp.Regexp) bool {
	for _, line := range strings.Split(content, "\n") {
		if pattern.MatchString(line) {
			return true
		}
	}
	return false
}
