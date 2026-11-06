package state

import (
	"sort"

	"github.com/LosFurina/tmuxatlas/pkg/tmux"
)

// AccountProjection is a per-account view of the canonical state. Free
// sessions use a separate type so their JSON cannot expose session details.
type AccountProjection struct {
	Hosts      map[HostKey]Host           `json:"hosts"`
	Sessions   map[SessionKey]any         `json:"sessions"`
	Windows    map[WindowKey]Window       `json:"windows"`
	Panes      map[PaneKey]Pane           `json:"panes"`
	ToolEvents map[ToolEventKey]ToolEvent `json:"tool_events"`
	Activity   map[ActivityKey]Activity   `json:"activity"`
	Health     map[HostKey]Health         `json:"health"`
}

type freeSession struct {
	Host  string     `json:"host"`
	Name  string     `json:"name"`
	Owner tmux.Owner `json:"owner"`
}

func minimalHost(host Host) Host {
	return Host{Key: host.Key, ID: host.ID, DisplayName: host.DisplayName, Online: host.Online, Local: host.Local}
}

// ForAccount builds a fresh projection without retaining references to data
// belonging to other accounts. An empty account ID never owns a session.
func (p Projection) ForAccount(accountID string) AccountProjection {
	result := AccountProjection{
		Hosts: make(map[HostKey]Host), Sessions: make(map[SessionKey]any),
		Windows: make(map[WindowKey]Window), Panes: make(map[PaneKey]Pane),
		ToolEvents: make(map[ToolEventKey]ToolEvent), Activity: make(map[ActivityKey]Activity),
		Health: make(map[HostKey]Health),
	}
	// A new account owns nothing yet but must be able to pick a host for its
	// first session, so online hosts are visible with identity fields only.
	for key, host := range p.Hosts {
		if host.Online {
			result.Hosts[key] = minimalHost(host)
		}
	}
	owned := make(map[SessionKey]bool)
	for key, session := range p.Sessions {
		if session.Name == "tmuxatlas-ctrl" {
			continue
		}
		// The owner is a label, not an access right: every signed-in account sees
		// every session. Only an unauthenticated view (empty ID) stays minimal.
		if accountID != "" {
			result.Sessions[key] = session
			owned[key] = true
			if host, ok := p.Hosts[session.HostKey]; ok {
				result.Hosts[session.HostKey] = minimalHost(host)
			}
		} else {
			result.Sessions[key] = freeSession{Host: session.HostID, Name: session.Name, Owner: session.Owner}
		}
	}
	for key, window := range p.Windows {
		if owned[window.SessionKey] {
			result.Windows[key] = window
		}
	}
	for key, pane := range p.Panes {
		if _, ok := result.Windows[pane.WindowKey]; ok {
			result.Panes[key] = pane
		}
	}
	for key, event := range p.ToolEvents {
		if owned[NewSessionKey(event.HostID, event.Session)] {
			result.ToolEvents[key] = event
		}
	}
	for key, activity := range p.Activity {
		if owned[NewSessionKey(activity.HostID, activity.Session)] {
			activity.Data = cloneJSONValue(activity.Data)
			result.Activity[key] = activity
		}
	}
	return result
}

// AccountHostViews groups visible sessions by host without host statistics.
func (p Projection) AccountHostViews(accountID string) []map[string]any {
	grouped := make(map[string][]any)
	for _, value := range p.AccountSessionViews(accountID) {
		switch session := value.(type) {
		case *tmux.Session:
			grouped[session.Host] = append(grouped[session.Host], session)
		}
	}
	for _, host := range p.Hosts {
		if _, known := grouped[host.ID]; host.Online && !known {
			grouped[host.ID] = []any{}
		}
	}
	ids := make([]string, 0, len(grouped))
	for id := range grouped {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	result := make([]map[string]any, 0, len(ids))
	for _, id := range ids {
		host := p.Hosts[NewHostKey(id)]
		result = append(result, map[string]any{"id": id, "name": host.DisplayName, "local": host.Local, "online": host.Online, "sessions": grouped[id]})
	}
	return result
}

// OwnedBy creates a projection for legacy view builders, excluding free and
// foreign sessions and all global metadata.
func (p Projection) OwnedBy(accountID string) Projection {
	filtered := p.ForAccount(accountID)
	result := NewProjection()
	for key, host := range p.Hosts {
		result.Hosts[key] = host
	}
	for key, value := range filtered.Sessions {
		if session, ok := value.(Session); ok {
			result.Sessions[key] = session
		}
	}
	result.Windows = filtered.Windows
	result.Panes = filtered.Panes
	result.ToolEvents = filtered.ToolEvents
	result.Activity = filtered.Activity
	return result
}

// AccountSessionViews preserves the existing full session view for owned
// sessions and gives free sessions only the three public fields.
func (p Projection) AccountSessionViews(accountID string) []any {
	views := make([]any, 0)
	for _, session := range p.OwnedBy(accountID).SessionViews() {
		views = append(views, session)
	}
	return views
}
