package toolevents

import (
	"strings"
	"testing"
	"time"
)

// Captures below are copied from real Claude Code and Codex panes.
const rule = "────────────────────────────────────────"

func TestClassifyClaude(t *testing.T) {
	cases := []struct {
		name     string
		screen   []string
		state    ScreenState
		finished bool
	}{
		{"working", []string{
			"● Bash(grep -n tool-event pkg/server/*.go)",
			"  ⎿  Running…",
			"✽ Metamorphosing… (11s · ↓ 744 tokens)",
			"  ⎿  Tip: Connect Claude to your IDE · /ide",
			rule, "❯ Fais ca, com", rule,
			"  ⏵⏵ auto mode on (shift+tab to cycle)",
		}, ScreenWorking, false},
		{"finished with background shells", []string{
			"● La passe de reprise est lancée sur les 8 zones.",
			"✻ Crunched for 4s · done 2:22 AM · 4 shells still running",
			rule, "❯ ", rule,
			"  ⏵⏵ auto mode on · 4 shells · ↓ to manage",
		}, ScreenReady, true},
		{"answer ending with an ellipsis is not a spinner", []string{
			"● Je regarde ça…",
			rule, "❯ ", rule,
		}, ScreenReady, true},
		{"just started", []string{
			"╭─── Claude Code v2 ───╮", "│ Welcome back!        │", "╰──────────────────────╯",
			rule, "❯ Try \"fix lint errors\"", rule, "  ? for shortcuts",
		}, ScreenReady, false},
		{"conversation quoting a dialog stays ready", []string{
			"● Le pied de page dit « Esc to cancel » et « Do you want to proceed? »",
			"  1. Yes", "  2. No",
			rule, "❯ ", rule,
		}, ScreenReady, true},
		{"permission dialog", []string{
			"● Bash(rm -rf build)", rule,
			" Bash command", "   rm -rf build", " Do you want to proceed?",
			" ❯ 1. Yes", "   2. Yes, and don't ask again", "   3. No",
			" Esc to cancel · Tab to amend",
		}, ScreenWaiting, false},
		{"question dialog", []string{
			"● AskUserQuestion", rule, " Which library should we use?",
			" ❯ 1. date-fns", "   2. dayjs", " Enter to select · ↑/↓ to navigate · Esc to cancel",
		}, ScreenWaiting, false},
		{"unrelated screen keeps the last state", []string{"Compiling…", "still going"}, ScreenUnknown, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := ClassifyScreen(ToolClaude, strings.Join(c.screen, "\n")+"\n\n", 0)
			if got.State != c.state || got.Finished != c.finished {
				t.Fatalf("got %+v, want state %d finished %v", got, c.state, c.finished)
			}
		})
	}
}

func TestClassifyCodex(t *testing.T) {
	cases := []struct {
		name     string
		screen   []string
		state    ScreenState
		finished bool
	}{
		{"working", []string{
			"• Ran npm test", "• Working (12s • esc to interrupt)",
			"› Ask Codex to do anything", "  ? for shortcuts",
		}, ScreenWorking, false},
		{"finished", []string{
			"  Vérifié sur petit écran.", "  Worked for 8m 37s • 15:26",
			"› Ask Codex to do anything",
			"  GPT-6.1-Sol xhigh · ~/Project/VieCore/Project/VieLift", "  ← for agents · ? for shortcuts",
		}, ScreenReady, true},
		{"just started", []string{
			"╭───────╮", "│ Codex │", "╰───────╯", "› Ask Codex to do anything", "  ? for shortcuts",
		}, ScreenReady, false},
		{"approval", []string{
			"  Would you like to run the following command?", "  $ rm -rf build",
			"› 1. Yes, proceed (y)", "  2. No, and tell Codex what to do differently (esc)",
			"  Press enter to confirm or esc to cancel",
		}, ScreenWaiting, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := ClassifyScreen(ToolCodex, strings.Join(c.screen, "\n"), 0)
			if got.State != c.state || got.Finished != c.finished {
				t.Fatalf("got %+v, want state %d finished %v", got, c.state, c.finished)
			}
		})
	}
}

func TestClassifyGenericUsesOutput(t *testing.T) {
	if got := ClassifyScreen(ToolCopilot, "working", time.Second); got.State != ScreenWorking {
		t.Fatalf("recent output: %+v", got)
	}
	if got := ClassifyScreen(ToolCopilot, "Proceed with this change? (y/n)", time.Minute); got.State != ScreenWaiting {
		t.Fatalf("question: %+v", got)
	}
	if got := ClassifyScreen(ToolCopilot, "all done", time.Minute); got.State != ScreenReady {
		t.Fatalf("silent: %+v", got)
	}
}
