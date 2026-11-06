package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/LosFurina/tmuxatlas/pkg/peer"
)

type fakeActionRouter struct {
	operation string
	target    peer.SessionTarget
	payload   json.RawMessage
	response  peer.ActionResponse
	err       error
}

func (router *fakeActionRouter) Execute(_ context.Context, operation string, target peer.SessionTarget, payload json.RawMessage) (peer.ActionResponse, error) {
	router.operation, router.target, router.payload = operation, target, append([]byte(nil), payload...)
	return router.response, router.err
}

func TestRuntimeAPIRequiresExplicitHostAndReturnsRemoteRenameTarget(t *testing.T) {
	invalid := httptest.NewRecorder()
	handleSessionRename(invalid, httptest.NewRequest(http.MethodPost, "/",
		bytes.NewBufferString(`{"session":"same","new_name":"renamed"}`)),
		&fakeActionRouter{err: peer.RuntimeError{Code: peer.ErrorInvalidTarget}}, nil)
	if invalid.Code != http.StatusBadRequest {
		t.Fatalf("missing host status=%d body=%s", invalid.Code, invalid.Body.String())
	}

	result, _ := json.Marshal(map[string]any{
		"target": peer.SessionTarget{HostID: "remote", Session: "renamed"},
	})
	router := &fakeActionRouter{response: peer.ActionResponse{
		RequestID: "request", Result: result,
	}}
	response := httptest.NewRecorder()
	handleSessionRename(response, httptest.NewRequest(http.MethodPost, "/",
		bytes.NewBufferString(`{"host_id":"remote","session":"same","new_name":"renamed"}`)),
		router, nil)
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if router.operation != "rename" ||
		router.target != (peer.SessionTarget{HostID: "remote", Session: "same"}) ||
		string(router.payload) != `{"new_name":"renamed"}` {
		t.Fatalf("route operation=%q target=%#v payload=%s", router.operation, router.target, router.payload)
	}
}

func TestRuntimeAPIKillRoutesSessionTarget(t *testing.T) {
	missing := httptest.NewRecorder()
	handleSessionKill(missing, httptest.NewRequest(http.MethodPost, "/",
		bytes.NewBufferString(`{"host_id":"local"}`)), &fakeActionRouter{}, nil)
	if missing.Code != http.StatusBadRequest {
		t.Fatalf("missing session status=%d body=%s", missing.Code, missing.Body.String())
	}

	router := &fakeActionRouter{response: peer.ActionResponse{
		RequestID: "request", Result: json.RawMessage(`{"ok":true}`),
	}}
	response := httptest.NewRecorder()
	handleSessionKill(response, httptest.NewRequest(http.MethodPost, "/",
		bytes.NewBufferString(`{"host_id":"local","session":"work"}`)), router, nil)
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if router.operation != "kill" ||
		router.target != (peer.SessionTarget{HostID: "local", Session: "work"}) {
		t.Fatalf("route operation=%q target=%#v", router.operation, router.target)
	}
}

func TestRuntimeAPIMapsStructuredTerminalErrors(t *testing.T) {
	for _, test := range []struct {
		code   peer.ErrorCode
		status int
	}{
		{peer.ErrorNotFound, http.StatusNotFound},
		{peer.ErrorPeerOffline, http.StatusServiceUnavailable},
		{peer.ErrorCapabilityUnsupported, http.StatusConflict},
		{peer.ErrorQueueFull, http.StatusTooManyRequests},
		{peer.ErrorTimeout, http.StatusGatewayTimeout},
	} {
		router := &fakeActionRouter{err: peer.RuntimeError{
			RequestID: "request", Generation: 2, Code: test.code,
		}}
		response := httptest.NewRecorder()
		handleSessionSelectPane(response, httptest.NewRequest(http.MethodPost, "/",
			bytes.NewBufferString(`{"host_id":"remote","session":"same","pane":"%1"}`)), router)
		if response.Code != test.status {
			t.Fatalf("%s status=%d body=%s", test.code, response.Code, response.Body.String())
		}
		var runtimeError peer.RuntimeError
		if err := json.Unmarshal(response.Body.Bytes(), &runtimeError); err != nil ||
			runtimeError.Code != test.code || runtimeError.RequestID != "request" {
			t.Fatalf("%s response=%#v err=%v", test.code, runtimeError, err)
		}
		var targetError peer.RuntimeError
		if !errors.As(router.err, &targetError) {
			t.Fatalf("%s lost structured error", test.code)
		}
	}
}

func TestSessionNewForwardsCwdAndAgentAndRejectsBadAgent(t *testing.T) {
	router := &fakeActionRouter{response: peer.ActionResponse{RequestID: "r", Result: json.RawMessage(`{}`)}}
	response := httptest.NewRecorder()
	handleSessionNew(response, httptest.NewRequest(http.MethodPost, "/",
		bytes.NewBufferString(`{"host_id":"local","session":"p","cwd":"~/x","agent":"codex"}`)), router, nil)
	if response.Code != http.StatusOK || router.operation != "new" ||
		string(router.payload) != `{"agent":"codex","cwd":"~/x"}` {
		t.Fatalf("status=%d op=%s payload=%s", response.Code, router.operation, router.payload)
	}
	router = &fakeActionRouter{response: peer.ActionResponse{Result: json.RawMessage(`{}`)}}
	response = httptest.NewRecorder()
	handleSessionNew(response, httptest.NewRequest(http.MethodPost, "/",
		bytes.NewBufferString(`{"host_id":"local","session":"p"}`)), router, nil)
	if string(router.payload) != `{}` {
		t.Fatalf("payload must stay empty, got %s", router.payload)
	}
	response = httptest.NewRecorder()
	router = &fakeActionRouter{}
	handleSessionNew(response, httptest.NewRequest(http.MethodPost, "/",
		bytes.NewBufferString(`{"host_id":"local","session":"p","agent":"rm -rf"}`)), router, nil)
	if response.Code != http.StatusBadRequest || router.operation != "" {
		t.Fatalf("status=%d routed=%q", response.Code, router.operation)
	}
}

func TestSessionPreviewAndDirectoriesRoute(t *testing.T) {
	router := &fakeActionRouter{response: peer.ActionResponse{Result: json.RawMessage(`{"pane":"%1","window":0,"lines":["a"],"prompt":null}`)}}
	response := httptest.NewRecorder()
	handleSessionPreview(response, httptest.NewRequest(http.MethodGet, "/?host_id=local&session=s&pane=%251&lines=12", nil), router)
	if response.Code != http.StatusOK || router.operation != "preview" ||
		string(router.payload) != `{"lines":12,"pane":"%1"}` ||
		response.Body.String() != `{"pane":"%1","window":0,"lines":["a"],"prompt":null}` {
		t.Fatalf("status=%d payload=%s body=%s", response.Code, router.payload, response.Body.String())
	}
	bad := httptest.NewRecorder()
	handleSessionPreview(bad, httptest.NewRequest(http.MethodGet, "/?host_id=local", nil), router)
	if bad.Code != http.StatusBadRequest {
		t.Fatalf("missing session status=%d", bad.Code)
	}

	router = &fakeActionRouter{response: peer.ActionResponse{Result: json.RawMessage(`{"directories":[]}`)}}
	response = httptest.NewRecorder()
	handleSessionDirectories(response, httptest.NewRequest(http.MethodGet, "/?host_id=remote", nil), router)
	if router.operation != "directories" || router.target.HostID != "remote" || response.Body.String() != `{"directories":[]}` {
		t.Fatalf("op=%s target=%+v body=%s", router.operation, router.target, response.Body.String())
	}
}

func TestSessionReplyValidationAndErrorMapping(t *testing.T) {
	for _, body := range []string{
		`{"host_id":"l","session":"s","pane":"%1","key":"1"}`,
		`{"host_id":"l","session":"s","pane":"%1","fingerprint":"f"}`,
		`{"host_id":"l","session":"s","key":"1","fingerprint":"f"}`,
	} {
		response := httptest.NewRecorder()
		router := &fakeActionRouter{}
		handleSessionReply(response, httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(body)), router)
		if response.Code != http.StatusBadRequest || router.operation != "" {
			t.Fatalf("%s: status=%d", body, response.Code)
		}
	}
	router := &fakeActionRouter{err: peer.RuntimeError{Code: peer.ErrorPromptChanged}}
	response := httptest.NewRecorder()
	handleSessionReply(response, httptest.NewRequest(http.MethodPost, "/",
		bytes.NewBufferString(`{"host_id":"l","session":"s","pane":"%1","key":"1","fingerprint":"f"}`)), router)
	if response.Code != http.StatusConflict || !bytes.Contains(response.Body.Bytes(), []byte(`"code":"prompt_changed"`)) {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if router.operation != "reply" || string(router.payload) != `{"fingerprint":"f","key":"1","pane":"%1"}` {
		t.Fatalf("op=%s payload=%s", router.operation, router.payload)
	}
	response = httptest.NewRecorder()
	writeRuntimeError(response, peer.RuntimeError{Code: peer.ErrorUnsupported})
	if response.Code != http.StatusNotImplemented || !bytes.Contains(response.Body.Bytes(), []byte(`"code":"unsupported"`)) {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}
