package server

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/LosFurina/tmuxatlas/pkg/auth"
	"github.com/LosFurina/tmuxatlas/pkg/peer"
	"github.com/LosFurina/tmuxatlas/pkg/tmux"
)

type runtimeActionExecutor interface {
	Execute(context.Context, string, peer.SessionTarget, json.RawMessage) (peer.ActionResponse, error)
}

func handleSessionNew(w http.ResponseWriter, r *http.Request, router runtimeActionExecutor, opts *Options) {
	var request struct {
		HostID  string `json:"host_id"`
		Session string `json:"session"`
		Cwd     string `json:"cwd,omitempty"`
		Agent   string `json:"agent,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil || router == nil {
		writeRuntimeError(w, peer.RuntimeError{Code: peer.ErrorInvalidTarget, Message: "requête invalide"})
		return
	}
	if err := tmux.ValidateSessionName(request.Session); err != nil {
		writeRuntimeError(w, peer.RuntimeError{Code: peer.ErrorInvalidTarget, Message: err.Error()})
		return
	}
	if request.Agent != "" {
		if err := peer.ValidateAgent(request.Agent); err != nil {
			writeRuntimeError(w, err)
			return
		}
	}
	newParams := map[string]string{}
	if identity, ok := auth.AccountFromContext(r.Context()); ok {
		newParams["owner"] = identity.User.ID
		newParams["owner_name"] = identity.User.Username
	}
	if request.Cwd != "" {
		newParams["cwd"] = request.Cwd
	}
	if request.Agent != "" {
		newParams["agent"] = request.Agent
	}
	newPayload, _ := json.Marshal(newParams)
	result, err := router.Execute(r.Context(), "new",
		peer.SessionTarget{HostID: request.HostID, Session: request.Session}, newPayload)
	if err != nil {
		writeRuntimeError(w, err)
		return
	}
	refreshLocalSessionState(opts, request.HostID)
	writeActionResponse(w, result)
}

func handleSessionRename(w http.ResponseWriter, r *http.Request, router runtimeActionExecutor, opts *Options) {
	var request struct {
		HostID  string `json:"host_id"`
		Session string `json:"session"`
		NewName string `json:"new_name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil || router == nil {
		writeRuntimeError(w, peer.RuntimeError{Code: peer.ErrorInvalidTarget, Message: "requête invalide"})
		return
	}
	if err := tmux.ValidateSessionName(request.NewName); err != nil {
		writeRuntimeError(w, peer.RuntimeError{Code: peer.ErrorInvalidTarget, Message: err.Error()})
		return
	}
	payload, _ := json.Marshal(map[string]string{"new_name": request.NewName})
	result, err := router.Execute(r.Context(), "rename",
		peer.SessionTarget{HostID: request.HostID, Session: request.Session}, payload)
	if err != nil {
		writeRuntimeError(w, err)
		return
	}
	refreshLocalSessionState(opts, request.HostID)
	writeActionResponse(w, result)
}

func handleSessionKill(w http.ResponseWriter, r *http.Request, router runtimeActionExecutor, opts *Options) {
	var request struct {
		HostID  string `json:"host_id"`
		Session string `json:"session"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil || request.Session == "" || router == nil {
		writeRuntimeError(w, peer.RuntimeError{Code: peer.ErrorInvalidTarget})
		return
	}
	result, err := router.Execute(r.Context(), "kill",
		peer.SessionTarget{HostID: request.HostID, Session: request.Session}, json.RawMessage(`{}`))
	if err != nil {
		writeRuntimeError(w, err)
		return
	}
	refreshLocalSessionState(opts, request.HostID)
	writeActionResponse(w, result)
}

func handleSessionSelectWindow(w http.ResponseWriter, r *http.Request, router runtimeActionExecutor) {
	var request struct {
		HostID  string `json:"host_id"`
		Session string `json:"session"`
		Window  int    `json:"window"`
		Pane    string `json:"pane,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil || router == nil {
		writeRuntimeError(w, peer.RuntimeError{Code: peer.ErrorInvalidTarget})
		return
	}
	payload, _ := json.Marshal(map[string]any{"window": request.Window, "pane": request.Pane})
	result, err := router.Execute(r.Context(), "select-window",
		peer.SessionTarget{HostID: request.HostID, Session: request.Session}, payload)
	if err != nil {
		writeRuntimeError(w, err)
		return
	}
	writeActionResponse(w, result)
}

func handleSessionSelectPane(w http.ResponseWriter, r *http.Request, router runtimeActionExecutor) {
	var request struct {
		HostID  string `json:"host_id"`
		Session string `json:"session"`
		Pane    string `json:"pane"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil || request.Pane == "" || router == nil {
		writeRuntimeError(w, peer.RuntimeError{Code: peer.ErrorInvalidTarget})
		return
	}
	payload, _ := json.Marshal(map[string]string{"pane": request.Pane})
	result, err := router.Execute(r.Context(), "select-pane",
		peer.SessionTarget{HostID: request.HostID, Session: request.Session}, payload)
	if err != nil {
		writeRuntimeError(w, err)
		return
	}
	writeActionResponse(w, result)
}

func handleSessionPreview(w http.ResponseWriter, r *http.Request, router runtimeActionExecutor) {
	query := r.URL.Query()
	if router == nil || query.Get("session") == "" {
		writeRuntimeError(w, peer.RuntimeError{Code: peer.ErrorInvalidTarget})
		return
	}
	lines := 0
	if raw := query.Get("lines"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 0 {
			writeRuntimeError(w, peer.RuntimeError{Code: peer.ErrorInvalidTarget, Message: "invalid lines"})
			return
		}
		lines = parsed
	}
	payload, _ := json.Marshal(map[string]any{"pane": query.Get("pane"), "lines": lines})
	result, err := router.Execute(r.Context(), "preview",
		peer.SessionTarget{HostID: query.Get("host_id"), Session: query.Get("session")}, payload)
	if err != nil {
		writeRuntimeError(w, err)
		return
	}
	// The response is the operation result itself (pane, window, lines, prompt).
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(result.Result)
}

func handleSessionReply(w http.ResponseWriter, r *http.Request, router runtimeActionExecutor) {
	var request struct {
		HostID      string `json:"host_id"`
		Session     string `json:"session"`
		Pane        string `json:"pane"`
		Key         string `json:"key"`
		Fingerprint string `json:"fingerprint"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil || router == nil ||
		request.Pane == "" || request.Key == "" || request.Fingerprint == "" {
		writeRuntimeError(w, peer.RuntimeError{Code: peer.ErrorInvalidTarget})
		return
	}
	payload, _ := json.Marshal(map[string]string{
		"pane": request.Pane, "key": request.Key, "fingerprint": request.Fingerprint})
	result, err := router.Execute(r.Context(), "reply",
		peer.SessionTarget{HostID: request.HostID, Session: request.Session}, payload)
	if err != nil {
		writeRuntimeError(w, err)
		return
	}
	writeActionResponse(w, result)
}

func handleSessionDirectories(w http.ResponseWriter, r *http.Request, router runtimeActionExecutor) {
	if router == nil {
		writeRuntimeError(w, peer.RuntimeError{Code: peer.ErrorInvalidTarget})
		return
	}
	// directories is host-scoped; "-" is a placeholder session for the router.
	result, err := router.Execute(r.Context(), "directories",
		peer.SessionTarget{HostID: r.URL.Query().Get("host_id"), Session: "-"}, json.RawMessage(`{}`))
	if err != nil {
		writeRuntimeError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(result.Result)
}

func refreshLocalSessionState(opts *Options, hostID string) {
	if opts == nil || opts.PeerMgr == nil || opts.Client == nil || hostID != opts.PeerMgr.LocalID() {
		return
	}
	if fresh, err := opts.Client.ListSessions(); err == nil {
		opts.StateMgr.UpdateSessions(fresh)
		opts.PeerMgr.UpdatePeerSessions(hostID, opts.StateMgr.GetSessions())
		if opts.StateCoordinator != nil {
			_, _ = opts.StateCoordinator.ReplaceHosts(context.Background(), opts.PeerMgr.StateHostSnapshots())
		}
	}
}

func writeActionResponse(w http.ResponseWriter, result peer.ActionResponse) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(result)
}
