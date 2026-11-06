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
	// The owner is a label: changing it never hides a session from an account.
	check("alice", true)
	check("bob", true)
	check("", true)
}

func TestNewAccountSeesOnlyOnlineHostsWithIdentityFields(t *testing.T) {
	p := NewProjection()
	p.Hosts[NewHostKey("online")] = Host{ID: "online", DisplayName: "vps", Online: true, Version: "secret-version"}
	p.Hosts[NewHostKey("offline")] = Host{ID: "offline", DisplayName: "off"}
	view := p.ForAccount("neuf")
	host, visible := view.Hosts[NewHostKey("online")]
	if !visible || host.DisplayName != "vps" || len(view.Hosts) != 1 {
		t.Fatalf("hôtes visibles : %+v", view.Hosts)
	}
	if host.Version != "" {
		t.Fatalf("version d'hôte exposée : %s", host.Version)
	}
	views := p.AccountHostViews("neuf")
	if len(views) != 1 || views[0]["id"] != "online" {
		t.Fatalf("vues : %v", views)
	}
}
