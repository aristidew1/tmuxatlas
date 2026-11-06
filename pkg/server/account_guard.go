package server

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/LosFurina/tmuxatlas/pkg/auth"
	"github.com/LosFurina/tmuxatlas/pkg/peer"
	"github.com/LosFurina/tmuxatlas/pkg/state"
	"github.com/LosFurina/tmuxatlas/pkg/tmux"
)

var accountUserRoutes = map[string]bool{
	"GET /api/voice": true, "GET /api/monitor": true, "GET /api/stats": true, "GET /ws/mic": true,
	"GET /api/preferences": true, "POST /api/auth/change-password": true, "GET /api/accounts/directory": true,
	"GET /api/sessions": true, "GET /api/hosts": true, "GET /api/tool-events": true,
	"GET /api/activity": true, "GET /api/session/directories": true,
	"POST /api/session/new": true, "POST /api/session/claim": true, "POST /api/session/release": true,
	"GET /api/session/preview": true, "POST /api/session/reply": true,
	"POST /api/session/rename": true, "POST /api/session/kill": true,
	"POST /api/session/select-window": true, "POST /api/session/select-pane": true,
	"DELETE /api/tool-event": true, "GET /ws/session": true, "GET /ws/events": true,
}

// Routes outside the user allow-list are recorded explicitly so a router walk
// can detect newly introduced routes that have not received a security review.
var accountOtherRoutes = map[string]string{
	"GET /api/auth/status": "public", "POST /api/auth/login": "public",
	"POST /api/auth/logout": "authenticated", "GET /api/version": "public",
	"GET /api/admin/users": "admin", "POST /api/admin/users": "admin",
	"PATCH /api/admin/users/{id}": "admin", "DELETE /api/admin/users/{id}": "admin",
	"GET /api/admin/sessions": "admin", "GET /api/peers": "admin",
	"GET /api/agent-status": "admin", "DELETE /api/tool-events": "admin",
	"GET /api/push/vapid-key": "admin", "POST /api/push/subscribe": "admin",
	"POST /api/push/unsubscribe": "admin", "PUT /api/preferences": "admin", "POST /api/pair": "admin",
	"GET /ws/peer": "peer", "GET /ws/peer-pty": "peer",
	"POST /api/pair/complete": "peer", "GET /*": "public",
	"CONNECT /api/*": "denied", "DELETE /api/*": "denied", "GET /api/*": "denied",
	"HEAD /api/*": "denied", "OPTIONS /api/*": "denied", "PATCH /api/*": "denied",
	"POST /api/*": "denied", "PUT /api/*": "denied", "TRACE /api/*": "denied",
}

// accountPolicy serializes ownership changes with target checks and websocket
// registration. Connections are cancelled before ownership can change.
type accountPolicy struct {
	opts        *Options
	router      runtimeActionExecutor
	mu          sync.Mutex
	connections map[uint64]accountConnection
	nextID      uint64
}

type accountConnection struct {
	accountID string
	host      string
	session   string
	cancel    context.CancelFunc
	done      chan struct{}
}

func newAccountPolicy(opts *Options) *accountPolicy {
	return &accountPolicy{opts: opts, connections: make(map[uint64]accountConnection)}
}

// remoteOwner asks the agent for current ownership instead of trusting a
// potentially delayed discovery snapshot. Older agents fail closed.
func (p *accountPolicy) remoteOwner(host, name string) (tmux.Owner, bool) {
	if p.router == nil {
		return "", false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	result, err := p.router.Execute(ctx, "owner", peer.SessionTarget{HostID: host, Session: name}, json.RawMessage(`{}`))
	if err != nil {
		return "", false
	}
	var response struct {
		Owner tmux.Owner `json:"owner"`
	}
	if json.Unmarshal(result.Result, &response) != nil {
		return "", false
	}
	return response.Owner, true
}

func (p *accountPolicy) closeConnections() bool {
	connections := make([]accountConnection, 0, len(p.connections))
	for id, connection := range p.connections {
		connection.cancel()
		connections = append(connections, connection)
		delete(p.connections, id)
	}
	timer := time.NewTimer(5 * time.Second)
	defer timer.Stop()
	for _, connection := range connections {
		select {
		case <-connection.done:
		case <-timer.C:
			return false
		}
	}
	return true
}

// closeForChange runs only after the route's Origin and CSRF checks pass.
// The policy mutex is held by Middleware for the duration of the handler.
func (p *accountPolicy) closeForChange(w http.ResponseWriter) bool {
	if p.closeConnections() {
		return true
	}
	http.Error(w, "fermeture des connexions expirée", http.StatusServiceUnavailable)
	return false
}

// owns reports whether an account may use a session. Ownership is a label, so
// any account may use any existing session except Atlas's internal one; the
// pane must still belong to that session.
func (p *accountPolicy) owns(host, name, pane, _ string) bool {
	if p.opts.PeerMgr == nil || host == "" || name == "" || name == "tmuxatlas-ctrl" {
		return false
	}
	var sessions []*tmux.Session
	if p.opts.PeerMgr.IsLocal(host) {
		if p.opts.Client == nil || p.opts.StateMgr == nil {
			return false
		}
		// Read ownership directly from tmux, without using stale cached state.
		current, err := p.opts.Client.ListSessions()
		if err != nil {
			return false
		}
		for _, session := range current {
			if session.Name == name {
				if pane == "" {
					return true
				}
				sessions = p.opts.StateMgr.GetSessions()
				break
			}
		}
	} else {
		if _, ok := p.remoteOwner(host, name); !ok {
			return false
		}
		for _, h := range p.opts.PeerMgr.StateHostSnapshots() {
			if h.ID == host && h.Online {
				sessions = h.Sessions
				break
			}
		}
	}
	for _, session := range sessions {
		if session == nil || session.Name != name {
			continue
		}
		if pane == "" {
			return true
		}
		for _, window := range session.Windows {
			for _, candidate := range window.Panes {
				if candidate.ID == pane {
					return true
				}
			}
		}
	}
	return false
}

// verifiedProjection replaces cached ownership with current host state before
// filtering. An unavailable host fails closed rather than exposing its cache.
func (p *accountPolicy) verifiedProjection(projection state.Projection) state.Projection {
	owners := make(map[state.SessionKey]tmux.Owner)
	type remoteTarget struct {
		host string
		name string
	}
	type remoteResult struct {
		key   state.SessionKey
		owner tmux.Owner
		ok    bool
	}
	var remote []remoteTarget
	if p.opts.PeerMgr != nil {
		for _, host := range p.opts.PeerMgr.StateHostSnapshots() {
			if !host.Online {
				continue
			}
			sessions := host.Sessions
			if host.Local {
				if p.opts.Client == nil {
					continue
				}
				var err error
				sessions, err = p.opts.Client.ListSessions()
				if err != nil {
					continue
				}
			}
			for _, session := range sessions {
				if session == nil || session.Name == "tmuxatlas-ctrl" {
					continue
				}
				if !host.Local {
					remote = append(remote, remoteTarget{host: host.ID, name: session.Name})
					continue
				}
				owners[state.NewSessionKey(host.ID, session.Name)] = session.Owner
			}
		}
	}
	if len(remote) > 0 {
		jobs := make(chan remoteTarget)
		results := make(chan remoteResult, len(remote))
		var workers sync.WaitGroup
		for range min(8, len(remote)) {
			workers.Add(1)
			go func() {
				defer workers.Done()
				for target := range jobs {
					owner, ok := p.remoteOwner(target.host, target.name)
					results <- remoteResult{key: state.NewSessionKey(target.host, target.name), owner: owner, ok: ok}
				}
			}()
		}
		for _, target := range remote {
			jobs <- target
		}
		close(jobs)
		workers.Wait()
		close(results)
		for result := range results {
			if result.ok {
				owners[result.key] = result.owner
			}
		}
	}
	for key, session := range projection.Sessions {
		owner, ok := owners[key]
		if !ok {
			delete(projection.Sessions, key)
			continue
		}
		session.Owner = owner
		projection.Sessions[key] = session
	}
	return projection
}

// watchOwnership closes active terminals when discovery reports an owner
// change outside an Atlas request, including changes reported by an agent.
func (p *accountPolicy) watchOwnership(ctx context.Context) {
	if p.opts.PeerMgr == nil {
		return
	}
	read := func() map[state.SessionKey]tmux.Owner {
		result := make(map[state.SessionKey]tmux.Owner)
		for _, host := range p.opts.PeerMgr.StateHostSnapshots() {
			if !host.Online {
				continue
			}
			sessions := host.Sessions
			if host.Local && p.opts.Client != nil {
				var err error
				sessions, err = p.opts.Client.ListSessions()
				if err != nil {
					continue
				}
			}
			for _, session := range sessions {
				if session != nil && session.Name != "tmuxatlas-ctrl" {
					result[state.NewSessionKey(host.ID, session.Name)] = session.Owner
				}
			}
		}
		return result
	}
	changes := p.opts.PeerMgr.Subscribe()
	defer p.opts.PeerMgr.Unsubscribe(changes)
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case _, ok := <-changes:
			if !ok {
				return
			}
		case <-ticker.C:
		}
		p.mu.Lock()
		current := read()
		for _, connection := range p.connections {
			if connection.session == "" {
				continue
			}
			_, exists := current[state.NewSessionKey(connection.host, connection.session)]
			if !p.opts.PeerMgr.IsLocal(connection.host) {
				_, exists = p.remoteOwner(connection.host, connection.session)
			}
			if !exists {
				connection.cancel()
			}
		}
		p.mu.Unlock()
	}
}

func (p *accountPolicy) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		identity, ok := auth.AccountFromContext(r.Context())
		if !ok {
			http.Error(w, "authentification requise", http.StatusUnauthorized)
			return
		}
		user := identity.User.Role == "user"
		if identity.User.Role != "admin" && (!user || !accountUserRoutes[r.Method+" "+r.URL.Path]) {
			http.Error(w, "accès interdit", http.StatusForbidden)
			return
		}
		p.mu.Lock()
		select {
		case <-identity.Done:
			p.mu.Unlock()
			http.Error(w, "authentification requise", http.StatusUnauthorized)
			return
		default:
		}
		path := r.URL.Path
		targeted := path == "/ws/session" || path == "/api/session/preview" || path == "/api/session/reply" || path == "/api/session/rename" || path == "/api/session/kill" || path == "/api/session/select-window" || path == "/api/session/select-pane" || path == "/api/session/release" || path == "/api/tool-event"
		if user && targeted {
			host, session, pane := r.URL.Query().Get("host_id"), r.URL.Query().Get("session"), r.URL.Query().Get("pane")
			if path == "/ws/session" {
				host, session = r.URL.Query().Get("host"), r.URL.Query().Get("name")
			} else if r.Method != http.MethodGet {
				controller := http.NewResponseController(w)
				if controller.SetReadDeadline(time.Now().Add(10*time.Second)) == nil {
					defer controller.SetReadDeadline(time.Time{})
				}
				body, err := io.ReadAll(io.LimitReader(r.Body, 4097))
				if err != nil || len(body) > 4096 {
					p.mu.Unlock()
					http.Error(w, "requête invalide", http.StatusBadRequest)
					return
				}
				r.Body = io.NopCloser(bytes.NewReader(body))
				var target struct {
					Host    string `json:"host"`
					HostID  string `json:"host_id"`
					Session string `json:"session"`
					Pane    string `json:"pane"`
				}
				if json.Unmarshal(body, &target) != nil {
					p.mu.Unlock()
					http.Error(w, "requête invalide", http.StatusBadRequest)
					return
				}
				if target.Host != "" && target.HostID != "" && target.Host != target.HostID {
					p.mu.Unlock()
					http.Error(w, "cibles contradictoires", http.StatusBadRequest)
					return
				}
				host, session, pane = target.HostID, target.Session, target.Pane
				if host == "" {
					host = target.Host
				}
			}
			if !p.owns(host, session, pane, identity.User.ID) {
				p.mu.Unlock()
				http.Error(w, "accès interdit", http.StatusForbidden)
				return
			}
		}
		if path == "/ws/session" || path == "/ws/events" || path == "/ws/mic" {
			if user {
				ctx, cancel := context.WithCancel(r.Context())
				p.nextID++
				id := p.nextID
				done := make(chan struct{})
				connection := accountConnection{accountID: identity.User.ID, cancel: cancel, done: done}
				if path == "/ws/session" {
					connection.host = r.URL.Query().Get("host")
					connection.session = r.URL.Query().Get("name")
				}
				p.connections[id] = connection
				p.mu.Unlock()
				defer func() {
					cancel()
					close(done)
					p.mu.Lock()
					delete(p.connections, id)
					p.mu.Unlock()
				}()
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}
			p.mu.Unlock()
			next.ServeHTTP(w, r)
			return
		}
		defer p.mu.Unlock()
		next.ServeHTTP(w, r)
	})
}
