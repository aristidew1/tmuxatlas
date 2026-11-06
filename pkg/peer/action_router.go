package peer

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"

	"github.com/LosFurina/tmuxatlas/pkg/tmux"
)

type ActionResponse struct {
	RequestID string          `json:"request_id"`
	Result    json.RawMessage `json:"result"`
}

type ActionRouter struct {
	manager *Manager
	local   RuntimeExecutor
	timeout time.Duration
}

func NewActionRouter(manager *Manager, local RuntimeExecutor, timeout time.Duration) *ActionRouter {
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	return &ActionRouter{manager: manager, local: local, timeout: timeout}
}

func NewTmuxRuntimeExecutor(client *tmux.Client) RuntimeExecutor {
	return tmuxRuntimeExecutor{client: client}
}

func (router *ActionRouter) Execute(ctx context.Context, operation string, target SessionTarget, payload json.RawMessage) (ActionResponse, error) {
	requestID := newRuntimeRequestID()
	if operation == "new" {
		if err := tmux.ValidateSessionName(target.Session); err != nil {
			return ActionResponse{}, RuntimeError{RequestID: requestID, Code: ErrorInvalidTarget, Message: err.Error()}
		}
	}
	if err := target.Validate(); err != nil {
		return ActionResponse{}, RuntimeError{RequestID: requestID, Code: ErrorInvalidTarget, Message: err.Error()}
	}
	if router.manager == nil {
		return ActionResponse{}, RuntimeError{RequestID: requestID, Code: ErrorPeerOffline}
	}
	if target.Session == "tmuxatlas-ctrl" {
		return ActionResponse{}, RuntimeError{RequestID: requestID, Code: ErrorNotFound}
	}
	if operation == "rename" {
		var params struct {
			NewName string `json:"new_name"`
		}
		if json.Unmarshal(payload, &params) != nil {
			return ActionResponse{}, RuntimeError{RequestID: requestID, Code: ErrorInvalidTarget, Message: "new_name est requis"}
		}
		if err := tmux.ValidateSessionName(params.NewName); err != nil {
			return ActionResponse{}, RuntimeError{RequestID: requestID, Code: ErrorInvalidTarget, Message: err.Error()}
		}
		if router.manager.HasSession(target.HostID, params.NewName) {
			return ActionResponse{}, RuntimeError{RequestID: requestID, Code: ErrorInvalidTarget, Message: "une session porte déjà ce nom"}
		}
	}
	if operation != "new" && operation != "directories" && !router.manager.HasSession(target.HostID, target.Session) {
		return ActionResponse{}, RuntimeError{RequestID: requestID, Code: ErrorNotFound}
	}
	if router.manager.IsLocal(target.HostID) {
		if router.local == nil {
			return ActionResponse{}, RuntimeError{RequestID: requestID, Code: ErrorExecutionFailed}
		}
		result, err := router.local.Execute(ctx, operation, target, payload)
		if err != nil {
			var runtimeError RuntimeError
			if errors.As(err, &runtimeError) {
				runtimeError.RequestID = requestID
				return ActionResponse{}, runtimeError
			}
			return ActionResponse{}, RuntimeError{RequestID: requestID, Code: ErrorExecutionFailed}
		}
		return ActionResponse{RequestID: requestID, Result: result}, nil
	}

	connection := router.manager.GetPeerConnection(target.HostID)
	if connection == nil {
		return ActionResponse{}, RuntimeError{RequestID: requestID, Code: ErrorPeerOffline}
	}
	if !connection.Supports(CapabilitySessionActions) || !connection.Supports(CapabilityRequestResults) {
		return ActionResponse{}, RuntimeError{RequestID: requestID, Generation: connection.Generation, Code: ErrorCapabilityUnsupported}
	}
	if requiresOwnership(operation, payload) && !connection.Supports(CapabilitySessionOwnership) {
		return ActionResponse{}, RuntimeError{RequestID: requestID, Code: ErrorUnsupported}
	}
	if requiresOwnerName(operation, payload) && !connection.Supports(CapabilitySessionOwnerName) {
		return ActionResponse{}, RuntimeError{RequestID: requestID, Code: ErrorUnsupported}
	}
	if requiresSessionExtras(operation, payload) && !connection.Supports(CapabilitySessionExtras) {
		return ActionResponse{}, RuntimeError{RequestID: requestID, Generation: connection.Generation, Code: ErrorUnsupported,
			Message: "this host's Agent is too old for this operation; update it"}
	}
	requestCtx, cancel := context.WithTimeout(ctx, router.timeout)
	defer cancel()
	request := RuntimeRequest{
		RequestID: requestID, Generation: connection.Generation,
		Deadline: time.Now().Add(router.timeout), Operation: operation,
		Target: target, Payload: payload,
	}
	result, err := connection.Request(requestCtx, request)
	if err != nil {
		var runtimeError RuntimeError
		if errors.As(err, &runtimeError) {
			return ActionResponse{}, runtimeError
		}
		return ActionResponse{}, RuntimeError{RequestID: requestID, Generation: connection.Generation, Code: ErrorExecutionFailed}
	}
	return ActionResponse{RequestID: requestID, Result: result}, nil
}

func newRuntimeRequestID() string {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		panic("system random source unavailable: " + err.Error())
	}
	return hex.EncodeToString(value)
}
