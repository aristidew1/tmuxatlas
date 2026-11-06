package server

import (
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/LosFurina/tmuxatlas/pkg/ingress"
)

func TestWebSocketCategoryAdmissionIsolationAndRecovery(t *testing.T) {
	config := ingress.DefaultConfig()
	config.GlobalMaxInFlight = 4
	terminal := config.Categories[ingress.CategoryWSTerminal]
	terminal.MaxInFlight = 1
	config.Categories[ingress.CategoryWSTerminal] = terminal
	policy, err := ingress.NewPolicy(config, time.Now)
	if err != nil {
		t.Fatal(err)
	}

	entered := make(chan struct{})
	release := make(chan struct{})
	var enteredOnce sync.Once
	terminalHandler := admissionMiddleware(policy, ingress.CategoryWSTerminal)(http.HandlerFunc(
		func(w http.ResponseWriter, _ *http.Request) {
			enteredOnce.Do(func() { close(entered) })
			<-release
			w.WriteHeader(http.StatusNoContent)
		},
	))
	done := make(chan struct{})
	go func() {
		req := httptest.NewRequest(http.MethodGet, "/ws/session", nil)
		req.RemoteAddr = "192.0.2.1:1234"
		terminalHandler.ServeHTTP(httptest.NewRecorder(), req)
		close(done)
	}()
	<-entered

	req := httptest.NewRequest(http.MethodGet, "/ws/session", nil)
	req.RemoteAddr = "192.0.2.2:1234"
	rec := httptest.NewRecorder()
	terminalHandler.ServeHTTP(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("second terminal status = %d, want 503", rec.Code)
	}

	peerHandler := admissionMiddleware(policy, ingress.CategoryWSPeer)(http.HandlerFunc(
		func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) },
	))
	rec = httptest.NewRecorder()
	peerHandler.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("peer category was blocked by terminal exhaustion: %d", rec.Code)
	}

	close(release)
	<-done
	rec = httptest.NewRecorder()
	terminalHandler.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("terminal slot did not recover: %d", rec.Code)
	}
}

func TestAdmissionUsesRealClientBehindLocalProxy(t *testing.T) {
	config := ingress.DefaultConfig()
	policy, err := ingress.NewPolicy(config, time.Now)
	if err != nil {
		t.Fatal(err)
	}
	h := admissionMiddleware(policy, ingress.CategoryWebAuthn)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) }))
	call := func(remote, forwarded string) int {
		r := httptest.NewRequest("POST", "/", nil)
		r.RemoteAddr = remote
		r.Header.Set("X-Forwarded-For", forwarded)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code
	}
	for i := 0; i < 8; i++ {
		if got := call("127.0.0.1:44", "203.0.113.1, 127.0.0.1"); got != 204 {
			t.Fatal(got)
		}
	}
	if got := call("127.0.0.1:44", "203.0.113.1"); got != 429 {
		t.Fatal(got)
	}
	if got := call("127.0.0.1:44", "203.0.113.2"); got != 204 {
		t.Fatal(got)
	}
	for i := 0; i < 8; i++ {
		if got := call("192.0.2.1:44", "203.0.113.3"); got != 204 {
			t.Fatal(got)
		}
	}
	if got := call("192.0.2.1:44", "203.0.113.4"); got != 429 {
		t.Fatal(got)
	}
}
