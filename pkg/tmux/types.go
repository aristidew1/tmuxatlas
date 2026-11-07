package tmux

import (
	"encoding/json"
	"time"
)

// Owner is a stable account ID; the empty value is encoded as JSON null.
type Owner string

func (o Owner) MarshalJSON() ([]byte, error) {
	if o == "" {
		return []byte("null"), nil
	}
	return json.Marshal(string(o))
}

// Session represents a tmux session
type Session struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	Owner        Owner     `json:"owner"`
	Host         string    `json:"host,omitempty"`        // peer fingerprint (empty = local)
	HostName     string    `json:"host_name,omitempty"`   // peer display name
	HostOnline   bool      `json:"host_online,omitempty"` // whether the host peer is connected
	Windows      []*Window `json:"windows"`
	Created      time.Time `json:"created"`
	Attached     bool      `json:"attached"`
	LastActivity time.Time `json:"last_activity"`
}

// Window represents a tmux window
type Window struct {
	ID        string  `json:"id"`
	SessionID string  `json:"session_id"`
	Name      string  `json:"name"`
	Index     int     `json:"index"`
	Active    bool    `json:"active"`
	Layout    string  `json:"layout"`
	Panes     []*Pane `json:"panes"`
}

// PaneDetailed contains resolved session name and window index for a pane,
// avoiding extra tmux queries. Used by the agent detector.
type PaneDetailed struct {
	ID      string `json:"id"`
	Session string `json:"session"` // session name (not ID)
	Window  int    `json:"window"`  // window index
	PID     int    `json:"pid"`
	// CurrentCommand is the pane's foreground command.
	CurrentCommand string `json:"current_command"`
}

// Pane represents a tmux pane
type Pane struct {
	ID             string `json:"id"`
	WindowID       string `json:"window_id"`
	SessionID      string `json:"session_id"`
	Index          int    `json:"index"`
	Active         bool   `json:"active"`
	Width          int    `json:"width"`
	Height         int    `json:"height"`
	CurrentCommand string `json:"current_command"`
	PID            int    `json:"pid"`
}
