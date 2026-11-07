package toolevents

import (
	"sync"
	"time"

	"github.com/sirupsen/logrus"
)

// Tool identifies which AI coding tool sent the event
type Tool string

const (
	ToolClaude   Tool = "claude"
	ToolCodex    Tool = "codex"
	ToolCopilot  Tool = "copilot"
	ToolOpenCode Tool = "opencode"
)

// Status represents the current state of an agent
type Status string

const (
	StatusActive    Status = "active"    // agent is running, doing work
	StatusWaiting   Status = "waiting"   // agent needs user attention/approval
	StatusCompleted Status = "completed" // agent finished its task
	StatusError     Status = "error"     // agent encountered an error
	StatusIdle      Status = "idle"      // agent is open but has not been given any work
)

// Event is a single notification from an agent hook
type Event struct {
	Tool         Tool      `json:"tool"`
	Status       Status    `json:"status"`
	Host         string    `json:"host,omitempty"`      // peer fingerprint (empty = local)
	HostName     string    `json:"host_name,omitempty"` // peer display name
	Session      string    `json:"session"`             // tmux session name
	Window       int       `json:"window"`              // tmux window index
	Pane         string    `json:"pane,omitempty"`      // tmux pane ID (optional)
	Message      string    `json:"message,omitempty"`   // human-readable detail
	Timestamp    time.Time `json:"timestamp"`
	AutoDetected bool      `json:"auto_detected,omitempty"` // true if read from the terminal (not hooks)
	// Baseline marks the first status observed for an agent, which describes a
	// situation that already existed rather than a change worth a notification.
	Baseline bool `json:"baseline,omitempty"`
	// Removed means the agent is gone: the pane's status must be forgotten.
	Removed bool `json:"removed,omitempty"`
}

// PaneKey uniquely identifies a tmux pane
type PaneKey struct {
	Host    string
	Session string
	Window  int
	Pane    string
}

// Tracker tracks the latest status of AI tools per tmux pane
type Tracker struct {
	mu     sync.RWMutex
	events map[PaneKey]*Event

	// Subscribers
	subMu       sync.RWMutex
	subscribers []chan *Event

	// review may correct a hook's event before it is stored and announced.
	review func(*Event)
}

// NewTracker creates a new tool event tracker
func NewTracker() *Tracker {
	return &Tracker{
		events: make(map[PaneKey]*Event),
	}
}

// Record stores a pane's status and broadcasts it when it changed. Repeating
// the current status is a no-op: "waiting since" keeps its original time and
// subscribers only hear about real transitions.
func (t *Tracker) Record(evt *Event) {
	evt.Timestamp = time.Now()
	if t.review != nil && !evt.AutoDetected && !evt.Removed {
		t.review(evt)
	}

	log := logrus.WithFields(logrus.Fields{
		"tool":          evt.Tool,
		"status":        evt.Status,
		"session":       evt.Session,
		"window":        evt.Window,
		"pane":          evt.Pane,
		"host":          evt.Host,
		"message":       evt.Message,
		"auto_detected": evt.AutoDetected,
		"removed":       evt.Removed,
	})
	log.Debug("recording tool event")

	key := PaneKey{
		Host:    evt.Host,
		Session: evt.Session,
		Window:  evt.Window,
		Pane:    evt.Pane,
	}

	t.mu.Lock()
	previous, existed := t.events[key]
	if evt.Removed {
		delete(t.events, key)
		if !existed {
			t.mu.Unlock()
			return
		}
	} else {
		if existed && previous.Status == evt.Status && previous.Tool == evt.Tool {
			t.mu.Unlock()
			return
		}
		t.events[key] = evt
	}
	t.mu.Unlock()

	// Broadcast to subscribers
	t.subMu.RLock()
	defer t.subMu.RUnlock()
	sent := 0
	for _, ch := range t.subscribers {
		select {
		case ch <- evt:
			sent++
		default:
			log.Debug("tool event subscriber channel full, dropping")
		}
	}
	log.WithField("subscribers", sent).Trace("tool event broadcast complete")
}

// StaleTimeout is how long an event that names no pane is kept. Events tied to
// a pane live as long as the agent in that pane.
const StaleTimeout = 24 * time.Hour

// GetAll returns the current status of every tracked pane.
func (t *Tracker) GetAll() []*Event {
	t.mu.RLock()
	defer t.mu.RUnlock()

	events := make([]*Event, 0, len(t.events))
	for _, evt := range t.events {
		events = append(events, evt)
	}
	return events
}

// IsDismissible reports whether a status is an alert a user can clear. Running,
// finished and idle describe the agent and stay until it changes.
func IsDismissible(status Status) bool {
	return status == StatusWaiting || status == StatusError
}

// Clear dismisses the alert of a specific pane.
func (t *Tracker) Clear(host, session string, window int, pane string) {
	t.mu.Lock()
	key := PaneKey{Host: host, Session: session, Window: window, Pane: pane}
	if evt, ok := t.events[key]; ok && IsDismissible(evt.Status) {
		delete(t.events, key)
	}
	t.mu.Unlock()
}

// ClearAll dismisses every alert.
func (t *Tracker) ClearAll() {
	t.mu.Lock()
	for key, evt := range t.events {
		if IsDismissible(evt.Status) {
			delete(t.events, key)
		}
	}
	t.mu.Unlock()
}

// GetForSession returns events for a specific session
func (t *Tracker) GetForSession(session string) []*Event {
	t.mu.RLock()
	defer t.mu.RUnlock()

	var events []*Event
	for key, evt := range t.events {
		if key.Session == session {
			events = append(events, evt)
		}
	}
	return events
}

// Subscribe returns a channel that receives tool events
func (t *Tracker) Subscribe() chan *Event {
	ch := make(chan *Event, 64)
	t.subMu.Lock()
	t.subscribers = append(t.subscribers, ch)
	t.subMu.Unlock()
	return ch
}

// Unsubscribe removes a subscriber
func (t *Tracker) Unsubscribe(ch chan *Event) {
	t.subMu.Lock()
	defer t.subMu.Unlock()
	for i, sub := range t.subscribers {
		if sub == ch {
			t.subscribers = append(t.subscribers[:i], t.subscribers[i+1:]...)
			close(ch)
			return
		}
	}
}
