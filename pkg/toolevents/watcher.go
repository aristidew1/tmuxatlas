package toolevents

import (
	"context"
	"sync"
	"time"

	"github.com/sirupsen/logrus"
)

const (
	// DefaultWatchInterval is how often agent panes are read. A pane capture is
	// cheap and the state shown to the user must follow the terminal closely.
	DefaultWatchInterval = 2 * time.Second
	// hookGrace lets a hook settle: a hook fires a moment before the screen
	// redraws, so a capture taken right after it may still show the old state.
	hookGrace = 3 * time.Second
	// readyConfirmations is how many captures in a row must show the input
	// prompt before a turn counts as finished; the spinner can blink off
	// between two steps of the same turn.
	readyConfirmations = 2
)

// shells is the set of foreground commands that mean no agent is running.
var shells = map[string]bool{
	"zsh": true, "bash": true, "fish": true, "sh": true, "dash": true,
	"tcsh": true, "csh": true, "ksh": true, "pwsh": true,
}

// WatchedPane describes a tmux pane as it is now.
type WatchedPane struct {
	ID             string
	Session        string
	Window         int
	PID            int
	CurrentCommand string
}

// PaneLister returns all current panes.
type PaneLister func() ([]WatchedPane, error)

// PaneCapturer returns the visible text of a pane.
type PaneCapturer func(paneID string) (string, error)

type watchedAgent struct {
	tool       Tool
	seen       bool
	screen     ScreenState
	readyCount int
	lastOutput time.Time
	hookDriven bool
}

// Watcher keeps every agent's status aligned with its terminal. It reads each
// agent pane on a short interval and records a status when the screen disagrees
// with the Tracker. Hooks stay the fastest signal, and the only one for tools
// whose screen layout is unknown; the screen corrects what hooks cannot report,
// such as an approval given or an interrupted turn.
type Watcher struct {
	tracker  *Tracker
	list     PaneLister
	capture  PaneCapturer
	interval time.Duration
	hostID   string
	hostName string
	log      *logrus.Entry
	now      func() time.Time
	detect   func(pid int) (Tool, bool)

	mu          sync.Mutex
	agents      map[string]*watchedAgent
	outputKnown bool
}

// NewWatcher creates a Watcher.
func NewWatcher(tracker *Tracker, list PaneLister, capture PaneCapturer, interval time.Duration) *Watcher {
	w := &Watcher{
		tracker:  tracker,
		list:     list,
		capture:  capture,
		interval: interval,
		log:      logrus.WithField("component", "agent-watcher"),
		now:      time.Now,
		detect:   DetectAgentInProcessTree,
		agents:   make(map[string]*watchedAgent),
	}
	tracker.review = w.reviewHook
	return w
}

// reviewHook reads the screen behind a hook's "completed". Claude fires Stop at
// the end of each turn of its main loop, also while shells or agents it started
// keep running; announcing that as finished would notify on every turn.
func (w *Watcher) reviewHook(evt *Event) {
	if evt.Status != StatusCompleted || evt.Tool != ToolClaude || evt.Pane == "" {
		return
	}
	if evt.Host != "" && w.hostID != "" && evt.Host != w.hostID {
		return // another host's pane: this host cannot read it
	}
	content, err := w.capture(evt.Pane)
	if err != nil {
		return
	}
	if ClassifyScreen(evt.Tool, content, 0).Background {
		evt.Status = StatusActive
		evt.Message = "Travail en arrière-plan"
	}
}

// SetHost sets the local host identity. Call it before Run.
func (w *Watcher) SetHost(id, name string) {
	w.hostID = id
	w.hostName = name
}

// RecordOutput notes that a pane produced output.
func (w *Watcher) RecordOutput(paneID string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.outputKnown = true
	if agent, ok := w.agents[paneID]; ok {
		agent.lastOutput = w.now()
	}
}

// DetectedPanes returns the panes currently running an agent.
func (w *Watcher) DetectedPanes() map[string]Tool {
	w.mu.Lock()
	defer w.mu.Unlock()
	result := make(map[string]Tool, len(w.agents))
	for paneID, agent := range w.agents {
		result[paneID] = agent.tool
	}
	return result
}

// Run blocks until ctx is cancelled.
func (w *Watcher) Run(ctx context.Context) {
	w.log.WithField("interval", w.interval).Info("starting agent watcher")
	ticker := time.NewTicker(w.interval)
	defer ticker.Stop()
	w.tick()
	for {
		select {
		case <-ctx.Done():
			w.log.Info("stopping agent watcher")
			return
		case <-ticker.C:
			w.tick()
		}
	}
}

func (w *Watcher) tick() {
	panes, err := w.list()
	if err != nil {
		w.log.WithError(err).Debug("failed to list panes")
		return
	}
	byID := make(map[string]WatchedPane, len(panes))
	for _, pane := range panes {
		byID[pane.ID] = pane
	}

	events := make(map[string]*Event)
	for _, event := range w.tracker.GetAll() {
		if event.Host != w.hostID {
			continue // another host's agent; that host watches it
		}
		if w.dropIfStale(event, byID) {
			continue
		}
		events[event.Pane] = event
	}

	active := make(map[string]bool)
	for _, pane := range panes {
		event := events[pane.ID]
		tool, ok := w.identify(pane, event)
		if !ok {
			continue
		}
		active[pane.ID] = true
		w.observe(pane, tool, event)
	}

	w.mu.Lock()
	for paneID := range w.agents {
		if !active[paneID] {
			delete(w.agents, paneID)
		}
	}
	w.mu.Unlock()
}

// dropIfStale removes an event whose agent is gone or whose pane moved.
func (w *Watcher) dropIfStale(event *Event, panes map[string]WatchedPane) bool {
	if event.Pane == "" {
		if w.now().Sub(event.Timestamp) <= StaleTimeout {
			return true // cannot be matched to a pane, kept until it ages out
		}
	} else if pane, ok := panes[event.Pane]; ok &&
		pane.Session == event.Session && pane.Window == event.Window && !shells[pane.CurrentCommand] {
		return false
	}
	w.tracker.Record(&Event{
		Tool: event.Tool, Host: event.Host, HostName: event.HostName, Session: event.Session,
		Window: event.Window, Pane: event.Pane, Removed: true,
	})
	return true
}

func (w *Watcher) identify(pane WatchedPane, event *Event) (Tool, bool) {
	if pane.PID == 0 || pane.Session == "" || shells[pane.CurrentCommand] {
		return "", false
	}
	switch tool := Tool(pane.CurrentCommand); tool {
	case ToolClaude, ToolCodex, ToolCopilot, ToolOpenCode:
		return tool, true
	}
	if tool, ok := w.detect(pane.PID); ok {
		return tool, true
	}
	if event != nil {
		return event.Tool, true // reported by a hook, not visible in the process tree
	}
	return "", false
}

func (w *Watcher) observe(pane WatchedPane, tool Tool, event *Event) {
	now := w.now()
	w.mu.Lock()
	agent, known := w.agents[pane.ID]
	if !known || agent.tool != tool {
		agent = &watchedAgent{tool: tool, lastOutput: now}
		w.agents[pane.ID] = agent
	}
	silent := now.Sub(agent.lastOutput)
	outputKnown := w.outputKnown
	if event != nil && !event.AutoDetected {
		agent.hookDriven = true
	}
	w.mu.Unlock()

	knownLayout := tool == ToolClaude || tool == ToolCodex
	if !knownLayout && (agent.hookDriven || !outputKnown) {
		return // nothing on screen can contradict this tool's hooks
	}

	content, err := w.capture(pane.ID)
	if err != nil {
		w.log.WithError(err).WithField("pane", pane.ID).Debug("failed to capture pane")
		return
	}
	observation := ClassifyScreen(tool, content, silent)

	w.mu.Lock()
	defer w.mu.Unlock()
	baseline := !agent.seen
	previousScreen := agent.screen
	agent.seen = true
	agent.screen = observation.State
	if observation.State == ScreenReady {
		agent.readyCount++
	} else {
		agent.readyCount = 0
	}

	if observation.State != ScreenWaiting && event != nil && !event.AutoDetected &&
		now.Sub(event.Timestamp) < hookGrace {
		return
	}
	if observation.State == ScreenWaiting && event == nil && previousScreen == ScreenWaiting {
		return // the user dismissed this alert; the question has not changed
	}

	status, message, ok := nextStatus(observation, event, agent.readyCount)
	if !ok || (event != nil && event.Status == status) {
		return
	}
	w.log.WithFields(logrus.Fields{"pane": pane.ID, "tool": tool, "status": status}).Debug("agent status changed")
	w.tracker.Record(&Event{
		Tool: tool, Status: status, Host: w.hostID, HostName: w.hostName,
		Session: pane.Session, Window: pane.Window, Pane: pane.ID,
		Message: message, AutoDetected: true, Baseline: baseline,
	})
}

// nextStatus maps what the screen shows to a status, given the current one.
func nextStatus(observation Observation, event *Event, readyCount int) (Status, string, bool) {
	switch observation.State {
	case ScreenWorking:
		return StatusActive, "", true
	case ScreenWaiting:
		message := observation.Message
		if message == "" {
			message = "Réponse attendue"
		}
		return StatusWaiting, message, true
	case ScreenReady:
		if event == nil {
			if observation.Finished {
				return StatusCompleted, "", true
			}
			return StatusIdle, "", true
		}
		switch event.Status {
		case StatusActive, StatusWaiting:
			if readyCount < readyConfirmations {
				return "", "", false
			}
			if !observation.Finished {
				return StatusIdle, "", true // answered a startup dialog, no work done yet
			}
			return StatusCompleted, "", true
		}
	}
	return "", "", false // an error or a finished turn stays until the agent works again
}
