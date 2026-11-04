package monitor

import (
	"testing"
	"time"
)

func severities(alerts []Alert) []string {
	out := make([]string, 0, len(alerts))
	for _, alert := range alerts {
		out = append(out, alert.Severity)
	}
	return out
}

func assertSeverities(t *testing.T, alerts []Alert, want ...string) {
	t.Helper()
	got := severities(alerts)
	if len(got) != len(want) {
		t.Fatalf("severities = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("severities = %v, want %v", got, want)
		}
	}
}

func TestServiceRules(t *testing.T) {
	tests := []struct {
		name    string
		service Service
		want    []string
	}{
		{name: "healthy", service: Service{Unit: "a.service", Scope: "system", Active: "active", Custom: true}},
		{name: "failed", service: Service{Unit: "a.service", Scope: "system", Active: "failed", Result: "exit-code"}, want: []string{"critical"}},
		{name: "custom restart loop", service: Service{Unit: "a.service", Scope: "user", Active: "active", Custom: true, Restarts: 3}, want: []string{"warning"}},
		{name: "below restart threshold", service: Service{Unit: "a.service", Scope: "user", Active: "active", Custom: true, Restarts: 2}},
		{name: "restarts ignored on system units", service: Service{Unit: "a.service", Scope: "system", Active: "active", Restarts: 9}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			a := &alertCtx{resp: &Response{Services: []Service{tt.service}}}
			a.serviceRules()
			assertSeverities(t, a.alerts, tt.want...)
		})
	}
}

func TestEndpointRules(t *testing.T) {
	day := int64(86400)
	now := time.Now().Unix()
	base := Endpoint{URL: "https://a.example", Up: true, Status: 200, LatencyMS: 50, CheckedAt: now}
	with := func(change func(*Endpoint)) Endpoint {
		endpoint := base
		change(&endpoint)
		return endpoint
	}
	tests := []struct {
		name     string
		endpoint Endpoint
		want     []string
	}{
		{name: "healthy", endpoint: base},
		{name: "not checked yet", endpoint: with(func(e *Endpoint) { e.CheckedAt = 0; e.Up = false })},
		{name: "down", endpoint: with(func(e *Endpoint) { e.Up = false; e.Error = "timeout" }), want: []string{"critical"}},
		{name: "down skips certificate rules", endpoint: with(func(e *Endpoint) { e.Up = false; e.CertExpires = now + day }), want: []string{"critical"}},
		{name: "slow", endpoint: with(func(e *Endpoint) { e.LatencyMS = 2000 }), want: []string{"warning"}},
		{name: "certificate expires soon", endpoint: with(func(e *Endpoint) { e.CertExpires = now + 3*day }), want: []string{"critical"}},
		{name: "certificate renewal stuck", endpoint: with(func(e *Endpoint) { e.CertExpires = now + 10*day }), want: []string{"warning"}},
		{name: "certificate fine", endpoint: with(func(e *Endpoint) { e.CertExpires = now + 60*day })},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			a := &alertCtx{resp: &Response{Endpoints: []Endpoint{tt.endpoint}}}
			a.endpointRules()
			assertSeverities(t, a.alerts, tt.want...)
		})
	}
}

func TestLastUp(t *testing.T) {
	history := []ProbePoint{{T: 1, Up: true}, {T: 2, Up: true}, {T: 3, Up: false}}
	if got := lastUp(history); got != 2 {
		t.Fatalf("lastUp() = %d, want 2", got)
	}
	if got := lastUp([]ProbePoint{{T: 1, Up: false}}); got != 0 {
		t.Fatalf("lastUp() = %d, want 0", got)
	}
}

func TestAlertFormatters(t *testing.T) {
	tests := []struct{ name, got, want string }{
		{"bytes", humanBytes(512), "512 o"},
		{"kilobytes", humanBytes(1536), "1,5 Ko"},
		{"large gigabytes", humanBytes(200 * 1024 * 1024 * 1024), "200 Go"},
		{"seconds", humanDuration(42), "42 s"},
		{"minutes", humanDuration(120), "2 min"},
		{"hours and minutes", humanDuration(3660), "1 h 1 min"},
		{"whole days", humanDuration(172800), "2 j"},
		{"percent small", pct(5.5), "5,5 %"},
		{"percent large", pct(42.4), "42 %"},
		{"dash for zero", orDash("0"), "—"},
		{"dash keeps value", orDash("200"), "200"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.got != tt.want {
				t.Fatalf("got %q, want %q", tt.got, tt.want)
			}
		})
	}
}
