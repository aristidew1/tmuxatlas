package toolevents

import (
	"crypto/sha256"
	"encoding/hex"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

// PromptOption is one selectable answer of a detected prompt.
type PromptOption struct {
	Key   string `json:"key"`
	Label string `json:"label"`
}

// PromptInfo is a detected question with its answers. Submit tells the server
// whether Enter must follow the key; it is never exposed to clients.
type PromptInfo struct {
	IsPrompt bool   `json:"is_prompt"`
	Message  string `json:"message"`
	// Context holds the lines printed just above the question, such as the
	// command being approved. It is displayed with the answers and part of the
	// fingerprint: agents reuse the same question for different commands.
	Context     []string       `json:"context,omitempty"`
	Options     []PromptOption `json:"options"`
	Fingerprint string         `json:"fingerprint"`
	Submit      bool           `json:"-"`
}

const (
	promptWindowLines = 12
	maxMessageRunes   = 300
	maxLabelRunes     = 120
	maxContextLines   = 6
	maxContextRunes   = 200
)

var (
	// "❯ 1. Yes", "  2) No", "│ > 3. Other │"
	menuLine = regexp.MustCompile(`^[\s│┃|]*([❯›>])?\s*(\d)[.)]\s+(\S.*?)[\s│┃|]*$`)
	// Leading/trailing box and cursor decoration of non-option lines.
	decoration = regexp.MustCompile(`^[\s│┃|╭╰┌└]+|[\s│┃|╮╯┐┘]+$`)
	// Footer hints printed under selection menus.
	menuFooter = regexp.MustCompile(`(?i)\b(esc(ape)?|enter|tab|ctrl[-+]\w)\b.*\b(cancel|select|confirm|amend|choose|navigate|submit)\b|\b(cancel|select|confirm|navigate)\b.*\b(esc(ape)?|enter)\b`)
	ynLine     = regexp.MustCompile(`(?i)\(y/n\)|\[y/n\]`)
	keyChoice  = regexp.MustCompile(`\(([a-zA-Z])\)\s*([^()]*)`)
)

// ExtractPromptOptions looks at the last non-empty lines of captured pane text
// and extracts a question with answer options. It requires the structure
// question + options; ordinary numbered lists, code and logs yield no result.
func ExtractPromptOptions(content string) PromptInfo {
	tail := tailLines(content, promptWindowLines)
	if len(tail) == 0 {
		return PromptInfo{}
	}
	if info, ok := numberedMenu(tail); ok {
		return finalize(info)
	}
	if info, ok := yesNo(tail); ok {
		return finalize(info)
	}
	if info, ok := keyOptions(tail); ok {
		return finalize(info)
	}
	return PromptInfo{}
}

func tailLines(content string, n int) []string {
	lines := strings.Split(content, "\n")
	var tail []string
	for i := len(lines) - 1; i >= 0 && len(tail) < n; i-- {
		line := strings.TrimRight(stripControl(lines[i]), " \t\r")
		if !strings.ContainsFunc(line, func(r rune) bool { return unicode.IsLetter(r) || unicode.IsDigit(r) }) {
			continue // blank or pure box-drawing/border line
		}
		tail = append([]string{line}, tail...)
	}
	return tail
}

func stripControl(s string) string {
	return strings.Map(func(r rune) rune {
		if r == '\t' {
			return ' '
		}
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, s)
}

func truncateRunes(s string, limit int) string {
	if utf8.RuneCountInString(s) <= limit {
		return s
	}
	runes := []rune(s)
	return string(runes[:limit])
}

func cleanText(s string) string {
	return strings.TrimSpace(decoration.ReplaceAllString(s, ""))
}

func isQuestionLine(s string) bool {
	s = cleanText(s)
	if utf8.RuneCountInString(s) < 4 || !wordPattern.MatchString(s) {
		return false
	}
	return strings.HasSuffix(s, "?") || strings.HasSuffix(s, ":") || strings.HasSuffix(s, "？")
}

func numberedMenu(tail []string) (PromptInfo, bool) {
	// Find the last contiguous run of menu lines; only a short footer may follow.
	end := -1
	for i := len(tail) - 1; i >= 0; i-- {
		if menuLine.MatchString(tail[i]) {
			end = i
			break
		}
	}
	if end < 0 || len(tail)-1-end > 3 {
		return PromptInfo{}, false
	}
	// Only key-hint footers may follow the menu: any other output after it
	// means the menu was already answered and scrolled.
	footer := false
	for _, line := range tail[end+1:] {
		if !menuFooter.MatchString(line) || utf8.RuneCountInString(cleanText(line)) > 120 {
			return PromptInfo{}, false
		}
		footer = true
	}
	start := end
	for start-1 >= 0 && menuLine.MatchString(tail[start-1]) {
		start--
	}
	var options []PromptOption
	cursor := false
	for i := start; i <= end; i++ {
		m := menuLine.FindStringSubmatch(tail[i])
		if m[1] != "" {
			cursor = true
		}
		if m[2] != string(rune('0'+len(options)+1)) {
			return PromptInfo{}, false // must be consecutive from 1
		}
		options = append(options, PromptOption{Key: m[2], Label: truncateRunes(strings.TrimSpace(m[3]), maxLabelRunes)})
	}
	if len(options) < 2 {
		return PromptInfo{}, false
	}
	// A selection UI always shows a cursor or a key-hint footer.
	if !cursor && !footer {
		return PromptInfo{}, false
	}
	for i := start - 1; i >= 0; i-- {
		if isQuestionLine(tail[i]) {
			return PromptInfo{IsPrompt: true, Message: cleanText(tail[i]), Context: contextLines(tail[:i]), Options: options}, true
		}
	}
	return PromptInfo{}, false
}

func yesNo(tail []string) (PromptInfo, bool) {
	last := tail[len(tail)-1]
	if !ynLine.MatchString(last) {
		return PromptInfo{}, false
	}
	msg := cleanText(last)
	if !wordPattern.MatchString(ynLine.ReplaceAllString(msg, "")) {
		return PromptInfo{}, false
	}
	return PromptInfo{
		IsPrompt: true, Message: msg, Submit: true, Context: contextLines(tail[:len(tail)-1]),
		Options: []PromptOption{{Key: "y", Label: "Yes"}, {Key: "n", Label: "No"}},
	}, true
}

func keyOptions(tail []string) (PromptInfo, bool) {
	last := tail[len(tail)-1]
	loc := keyChoice.FindAllStringSubmatchIndex(last, -1)
	if len(loc) < 2 {
		return PromptInfo{}, false
	}
	var options []PromptOption
	seen := map[string]bool{}
	for _, m := range loc {
		key := strings.ToLower(last[m[2]:m[3]])
		label := strings.TrimSpace(last[m[4]:m[5]])
		if label == "" || seen[key] {
			return PromptInfo{}, false
		}
		seen[key] = true
		options = append(options, PromptOption{Key: key, Label: truncateRunes(label, maxLabelRunes)})
	}
	question := cleanText(last[:loc[0][0]])
	context := tail[:len(tail)-1]
	if question == "" || !strings.HasSuffix(question, "?") || !isQuestionLine(question) {
		if len(tail) < 2 || !strings.HasSuffix(cleanText(tail[len(tail)-2]), "?") || !isQuestionLine(tail[len(tail)-2]) {
			return PromptInfo{}, false
		}
		question = cleanText(tail[len(tail)-2])
		context = tail[:len(tail)-2]
	}
	return PromptInfo{IsPrompt: true, Message: question, Context: contextLines(context), Options: options}, true
}

// contextLines keeps the last lines above the question, closest to it.
func contextLines(lines []string) []string {
	if len(lines) > maxContextLines {
		lines = lines[len(lines)-maxContextLines:]
	}
	context := make([]string, 0, len(lines))
	for _, line := range lines {
		context = append(context, truncateRunes(cleanText(line), maxContextRunes))
	}
	return context
}

func finalize(info PromptInfo) PromptInfo {
	info.Message = truncateRunes(info.Message, maxMessageRunes)
	info.Fingerprint = Fingerprint(info.Context, info.Message, info.Options)
	return info
}

// Fingerprint identifies what the user is answering: the question, its options
// and the context above it. A new command under an identical question therefore
// invalidates an answer given to the previous one.
func Fingerprint(context []string, message string, options []PromptOption) string {
	h := sha256.New()
	for _, line := range context {
		h.Write([]byte(line))
		h.Write([]byte{2})
	}
	h.Write([]byte(message))
	for _, o := range options {
		h.Write([]byte{0})
		h.Write([]byte(o.Key))
		h.Write([]byte{1})
		h.Write([]byte(o.Label))
	}
	return hex.EncodeToString(h.Sum(nil))
}
