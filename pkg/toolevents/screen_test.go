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
		// Claude ends its turn, and fires Stop, while the work it started goes on.
		{"turn over with background shells running", []string{
			"● La passe de reprise est lancée sur les 8 zones.",
			"✻ Crunched for 4s · done 2:22 AM · 4 shells still running",
			rule, "❯ ", rule,
			"  ⏵⏵ auto mode on · 4 shells · ↓ to manage",
		}, ScreenWorking, false},
		{"turn over with a background agent running", []string{
			"  confirmer qu'il a répondu « OK ». Je le signalerai dès qu'il aura rendu son résultat.",
			"✻ Churned for 2s · done 12:22 PM",
			rule, "❯", rule,
			"  ⏵⏵ auto mode on (shift+tab to cycle) · ↓ to manage",
			"  ● main",
			"  ◯ general-purpose  Attente de 45 secondes                                  53s",
		}, ScreenWorking, false},
		{"usage limit with automatic continue", []string{
			"  ⎿  You've hit your 5-hour limit · resets 12:20pm (Europe/Berlin)",
			"● Usage limit reached · continuing automatically at 12:20pm · esc to cancel",
			"✻ Baked for 30m 1s · done 11:57 AM",
			rule, "❯ ", rule,
			"  ⚠ Usage limit reached · limit resets 12:20pm",
			"    Continuing automatically at 12:20pm · Esc to cancel · /usage-credits to continue now",
			"  ⏵⏵ auto mode on (shift+tab to cycle)",
		}, ScreenWorking, false},
		{"background work over", []string{
			"  Les deux tâches sont donc terminées : le sous-agent et la commande sleep 40.",
			"✻ Waiting for 1 background agent to finish",
			"● Agent \"Attente de 45 secondes\" finished · 54s",
			rule, "❯", rule,
			"  ⏵⏵ auto mode on (shift+tab to cycle)",
		}, ScreenReady, true},
		{"a prompt quoting the footer is not background work", []string{
			"● Done.",
			rule, "❯ pourquoi le pied de page dit · 2 shells · ↓ to manage ?", rule,
			"  ⏵⏵ auto mode on (shift+tab to cycle)",
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
