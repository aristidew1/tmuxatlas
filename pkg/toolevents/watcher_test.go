package toolevents

import (
	"testing"
	"time"
)

const (
	workingScreen = "✽ Thinking… (3s)\n" + rule + "\n❯ \n" + rule + "\n"
	readyScreen   = "● Done.\n" + rule + "\n❯ \n" + rule + "\n"
	dialogScreen  = " Do you want to proceed?\n ❯ 1. Yes\n   2. No\n Esc to cancel\n"
	freshScreen   = rule + "\n❯ \n" + rule + "\n"
)

type watcherFixture struct {
	watcher *Watcher
	tracker *Tracker
	panes   []WatchedPane
	screen  string
	now     time.Time
}

func newWatcherFixture() *watcherFixture {
	f := &watcherFixture{
		tracker: NewTracker(),
		panes:   []WatchedPane{{ID: "%1", Session: "work", Window: 0, PID: 42, CurrentCommand: "claude"}},
		now:     time.Now().Add(time.Hour),
	}
	f.watcher = NewWatcher(f.tracker,
		func() ([]WatchedPane, error) { return f.panes, nil },
		func(string) (string, error) { return f.screen, nil },
		time.Second)
	f.watcher.SetHost("host", "Host")
	f.watcher.now = func() time.Time { return f.now }
	f.watcher.detect = func(int) (Tool, bool) { return "", false }
	return f
}

func (f *watcherFixture) tick(t *testing.T) {
	t.Helper()
	f.watcher.tick()
	f.now = f.now.Add(2 * time.Second)
}

func (f *watcherFixture) status(t *testing.T) Status {
	t.Helper()
	events := f.tracker.GetAll()
	if len(events) == 0 {
		return ""
	}
	if len(events) > 1 {
		t.Fatalf("expected one event per pane: %+v", events)
	}
	return events[0].Status
}

func TestWatcherFollowsATurn(t *testing.T) {
	f := newWatcherFixture()
	f.screen = freshScreen
	f.tick(t)
	if got := f.status(t); got != StatusIdle {
		t.Fatalf("fresh agent: %q", got)
	}
	f.screen = workingScreen
	f.tick(t)
	if got := f.status(t); got != StatusActive {
		t.Fatalf("working: %q", got)
	}
	f.screen = dialogScreen
	f.tick(t)
	if got := f.status(t); got != StatusWaiting {
		t.Fatalf("dialog: %q", got)
	}
	f.screen = workingScreen
	f.tick(t)
	if got := f.status(t); got != StatusActive {
		t.Fatalf("approval given: %q", got)
	}
	f.screen = readyScreen
	f.tick(t)
	if got := f.status(t); got != StatusActive {
		t.Fatalf("one ready capture must not finish a turn: %q", got)
	}
	f.tick(t)
	if got := f.status(t); got != StatusCompleted {
		t.Fatalf("finished: %q", got)
	}
}

func TestWatcherStartupDialogIsNotAFinishedTurn(t *testing.T) {
	f := newWatcherFixture()
	f.screen = dialogScreen
	f.tick(t)
	f.screen = freshScreen
	f.tick(t)
	f.tick(t)
	if got := f.status(t); got != StatusIdle {
		t.Fatalf("no work was done: %q", got)
	}
}

func TestWatcherBaselineDescribesAnExistingSituation(t *testing.T) {
	f := newWatcherFixture()
	f.screen = readyScreen
	f.tick(t)
	events := f.tracker.GetAll()
	if len(events) != 1 || events[0].Status != StatusCompleted || !events[0].Baseline {
		t.Fatalf("restart on a finished agent: %+v", events)
	}
	f.screen = workingScreen
	f.tick(t)
	if events := f.tracker.GetAll(); events[0].Baseline {
		t.Fatal("a later change is not a baseline")
	}
}

func TestWatcherLetsHooksSettle(t *testing.T) {
	f := newWatcherFixture()
	f.screen = workingScreen
	f.tick(t)
	f.tracker.Record(&Event{Tool: ToolClaude, Status: StatusCompleted, Host: "host", Session: "work", Pane: "%1"})
	f.now = time.Now()
	f.tick(t) // the screen has not redrawn yet
	if got := f.status(t); got != StatusCompleted {
		t.Fatalf("hook overridden within its grace: %q", got)
	}
}

func TestWatcherReactsToDialogDuringHookGrace(t *testing.T) {
	f := newWatcherFixture()
	f.screen = workingScreen
	f.tick(t)
	f.tracker.Record(&Event{Tool: ToolClaude, Status: StatusCompleted, Host: "host", Session: "work", Pane: "%1"})
	f.now = time.Now()
	f.screen = dialogScreen
	f.tick(t)
	if got := f.status(t); got != StatusWaiting {
		t.Fatalf("dialog must win: %q", got)
	}
}

func TestWatcherKeepsDismissedAlertDismissed(t *testing.T) {
	f := newWatcherFixture()
	f.screen = dialogScreen
	f.tick(t)
	f.tracker.Clear("host", "work", 0, "%1")
	f.tick(t)
	if got := f.status(t); got != "" {
		t.Fatalf("dismissed alert came back: %q", got)
	}
	f.screen = workingScreen
	f.tick(t)
	if got := f.status(t); got != StatusActive {
		t.Fatalf("status must resume: %q", got)
	}
}

func TestWatcherKeepsErrorUntilAgentWorksAgain(t *testing.T) {
	f := newWatcherFixture()
	f.screen = readyScreen
	f.tick(t)
	f.tracker.Record(&Event{Tool: ToolClaude, Status: StatusError, Host: "host", Session: "work", Pane: "%1"})
	f.now = f.now.Add(time.Minute)
	f.tick(t)
	f.tick(t)
	if got := f.status(t); got != StatusError {
		t.Fatalf("error lost: %q", got)
	}
}

func TestWatcherForgetsAgentThatLeft(t *testing.T) {
	cases := map[string]func(*watcherFixture){
		"exited to shell": func(f *watcherFixture) { f.panes[0].CurrentCommand = "zsh" },
		"pane closed":     func(f *watcherFixture) { f.panes = nil },
	}
	for name, leave := range cases {
		t.Run(name, func(t *testing.T) {
			f := newWatcherFixture()
			f.screen = readyScreen
			f.tick(t)
			leave(f)
			f.tick(t)
			if got := f.status(t); got != "" {
				t.Fatalf("status kept: %q", got)
			}
			if len(f.watcher.DetectedPanes()) != 0 {
				t.Fatal("pane still listed")
			}
		})
	}
}

func TestWatcherFollowsRenamedSession(t *testing.T) {
	f := newWatcherFixture()
	f.screen = readyScreen
	f.tick(t)
	f.panes[0].Session = "renamed"
	f.tick(t)
	events := f.tracker.GetAll()
	if len(events) != 1 || events[0].Session != "renamed" {
		t.Fatalf("events: %+v", events)
	}
}

func TestWatcherIgnoresOtherHostsEvents(t *testing.T) {
	f := newWatcherFixture()
	f.panes = nil
	f.tracker.Record(&Event{Tool: ToolCodex, Status: StatusActive, Host: "peer", Session: "s", Pane: "%9"})
	f.tick(t)
	if got := f.status(t); got != StatusActive {
		t.Fatalf("a peer's agent must be left alone: %q", got)
	}
}

func TestTrackerOnlyBroadcastsChanges(t *testing.T) {
	tracker := NewTracker()
	ch := tracker.Subscribe()
	defer tracker.Unsubscribe(ch)
	event := func() *Event { return &Event{Tool: ToolClaude, Status: StatusWaiting, Session: "s", Pane: "%1"} }
	tracker.Record(event())
	since := tracker.GetAll()[0].Timestamp
	time.Sleep(time.Millisecond)
	tracker.Record(event())
	if len(ch) != 1 {
		t.Fatalf("broadcasts = %d", len(ch))
	}
	if !tracker.GetAll()[0].Timestamp.Equal(since) {
		t.Fatal("waiting since was reset")
	}
}

// Stop fires at the end of each turn of Claude's main loop, even while shells or
// agents it started are still running. That is not a finished task.
func TestHookCompletionWithBackgroundWorkStaysActive(t *testing.T) {
	f := newWatcherFixture()
	f.screen = "✻ Brewed for 19s · done 12:22 PM · 2 shells still running\n" + rule + "\n❯ \n" + rule +
		"\n  ⏵⏵ auto mode on · 2 shells · ↓ to manage\n"
	f.tick(t)
	heard := f.tracker.Subscribe()
	defer f.tracker.Unsubscribe(heard)

	f.tracker.Record(&Event{Tool: ToolClaude, Status: StatusCompleted, Host: "host", Session: "work", Pane: "%1"})
	if got := f.status(t); got != StatusActive {
		t.Fatalf("Stop with background work: %q", got)
	}

	f.screen = readyScreen
	f.now = f.now.Add(hookGrace)
	f.tick(t)
	f.tick(t)
	if got := f.status(t); got != StatusCompleted {
		t.Fatalf("background work over: %q", got)
	}
	completed := 0
	for len(heard) > 0 {
		if (<-heard).Status == StatusCompleted {
			completed++
		}
	}
	if completed != 1 {
		t.Fatalf("completions announced: %d, want 1", completed)
	}
}

func TestHookCompletionWithoutBackgroundWorkIsKept(t *testing.T) {
	f := newWatcherFixture()
	f.screen = readyScreen
	f.tracker.Record(&Event{Tool: ToolClaude, Status: StatusCompleted, Host: "host", Session: "work", Pane: "%1"})
	if got := f.status(t); got != StatusCompleted {
		t.Fatalf("finished turn: %q", got)
	}
}
