package peer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/LosFurina/tmuxatlas/pkg/tmux"
)

type tmuxRuntimeExecutor struct {
	client *tmux.Client
}

func (executor tmuxRuntimeExecutor) Execute(_ context.Context, operation string, target SessionTarget, payload json.RawMessage) (json.RawMessage, error) {
	if executor.client == nil {
		return nil, fmt.Errorf("tmux client unavailable")
	}
	if operation == "new" {
		return newSession(executor.client, target, payload)
	}
	if target.Session == "tmuxatlas-ctrl" {
		return nil, RuntimeError{Code: ErrorNotFound}
	}
	switch operation {
	case "owner":
		sessions, err := executor.client.ListSessions()
		if err != nil {
			return nil, err
		}
		for _, session := range sessions {
			if session.Name == target.Session {
				return json.Marshal(map[string]any{"owner": session.Owner})
			}
		}
		return nil, RuntimeError{Code: ErrorNotFound}
	case "claim", "release":
		var params struct {
			Owner     string  `json:"owner"`
			OwnerName *string `json:"owner_name"`
			Force     bool    `json:"force"`
		}
		if json.Unmarshal(payload, &params) != nil || params.Owner == "" {
			return nil, invalid("owner is required")
		}
		expected, owner := "", params.Owner
		if operation == "release" {
			expected, owner = params.Owner, ""
		}
		names := []string{}
		if params.OwnerName != nil {
			names = append(names, *params.OwnerName)
		}
		err := executor.client.ChangeOwner(target.Session, expected, owner, params.Force, names...)
		if errors.Is(err, tmux.ErrAlreadyOwned) {
			return nil, RuntimeError{Code: ErrorAlreadyOwned}
		}
		if errors.Is(err, tmux.ErrNotOwner) {
			return nil, RuntimeError{Code: ErrorNotOwner}
		}
		if err != nil {
			return nil, err
		}
		return json.RawMessage(`{"ok":true}`), nil
	case "preview":
		return previewSession(executor.client, target, payload)
	case "reply":
		return replySession(executor.client, target, payload)
	case "directories":
		return listDirectories()
	case "rename":
		var params struct {
			NewName string `json:"new_name"`
		}
		if json.Unmarshal(payload, &params) != nil {
			return nil, invalid("new_name is required")
		}
		if err := tmux.ValidateSessionName(params.NewName); err != nil {
			return nil, invalid(err.Error())
		}
		if executor.client.HasSession(params.NewName) {
			return nil, invalid("une session porte déjà ce nom")
		}
		if err := executor.client.RenameSession(target.Session, params.NewName); err != nil {
			return nil, err
		}
		return json.Marshal(map[string]any{
			"target": SessionTarget{HostID: target.HostID, Session: params.NewName},
		})
	case "kill":
		if target.Session == "" {
			return nil, fmt.Errorf("session is required")
		}
		if err := executor.client.KillSession(target.Session); err != nil {
			return nil, err
		}
		return json.RawMessage(`{"ok":true}`), nil
	case "select-window":
		var params struct {
			Window int    `json:"window"`
			Pane   string `json:"pane,omitempty"`
		}
		if json.Unmarshal(payload, &params) != nil {
			return nil, fmt.Errorf("invalid select-window payload")
		}
		if params.Pane != "" {
			pane, err := resolvePane(executor.client, target.Session, params.Pane)
			if err != nil {
				return nil, err
			}
			if pane.Window != params.Window {
				return nil, invalid("pane does not belong to window")
			}
		}
		if err := executor.client.SelectWindow(target.Session, fmt.Sprintf("%d", params.Window)); err != nil {
			return nil, err
		}
		if params.Pane != "" {
			if err := executor.client.SelectPane(params.Pane); err != nil {
				return nil, err
			}
		}
		return json.RawMessage(`{"ok":true}`), nil
	case "select-pane":
		var params struct {
			Pane string `json:"pane"`
		}
		if json.Unmarshal(payload, &params) != nil || params.Pane == "" {
			return nil, fmt.Errorf("pane is required")
		}
		if _, err := resolvePane(executor.client, target.Session, params.Pane); err != nil {
			return nil, err
		}
		if err := executor.client.SelectPane(params.Pane); err != nil {
			return nil, err
		}
		return json.RawMessage(`{"ok":true}`), nil
	default:
		return nil, RuntimeError{Code: ErrorUnsupported, Message: "unsupported operation"}
	}
}
