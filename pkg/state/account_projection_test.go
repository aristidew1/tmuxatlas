package state

import (
	"encoding/json"
	"github.com/LosFurina/tmuxatlas/pkg/tmux"
	"strings"
	"testing"
)

func TestAccountProjectionAfterReassignment(t *testing.T) {
	p := NewProjection()
	key := NewSessionKey("host", "work")
	p.Sessions[key] = Session{Key: key, HostID: "host", Name: "work", Owner: "alice", TmuxID: "secret-id"}
	window := NewWindowKey("host", "work", "@1")
	p.Windows[window] = Window{Key: window, SessionKey: key, Name: "secret-window"}
	pane := NewPaneKey("host", "work", "@1", "%1")
	p.Panes[pane] = Pane{Key: pane, WindowKey: window, CurrentCommand: "secret-command"}
	p.ToolEvents["event"] = ToolEvent{HostID: "host", Session: "work", Message: "secret-event"}
	p.Activity["activity"] = Activity{HostID: "host", Session: "work", Data: map[string]any{"secret": "activity"}}
	p.Hosts[NewHostKey("host")] = Host{ID: "host", DisplayName: "secret-host"}
	check := func(owner string, want bool) {
		t.Helper()
		s := p.Sessions[key]
		s.Owner = tmux.Owner(owner)
		p.Sessions[key] = s
		data, err := json.Marshal(p.ForAccount("alice"))
		if err != nil {
			t.Fatal(err)
		}
		got := strings.Contains(string(data), "secret-command")
		if got != want {
			t.Fatalf("owner %q: %s", owner, data)
		}
		if !want && (strings.Contains(string(data), "secret-") || strings.Contains(string(data), "activity\":\"")) {
			t.Fatalf("information leak: %s", data)
		}
	}
	check("alice", true)
	check("bob", false)
	check("", false)
}
