//go:build linux

package monitor

import (
	"testing"
	"time"
)

func TestParseSocketAddr(t *testing.T) {
	for _, tc := range []struct {
		in, addr string
		port     int
	}{
		{"0100007F:1DE6", "127.0.0.1", 7654},
		{"00000000:01BB", "0.0.0.0", 443},
		{"00000000000000000000000000000000:0016", "::", 22},
		{"00000000000000000000000001000000:1F90", "::1", 8080},
		{"0000000000000000FFFF00000100007F:0050", "127.0.0.1", 80},
	} {
		t.Run(tc.in, func(t *testing.T) {
			addr, port := parseSocketAddr(tc.in)
			if addr != tc.addr || port != tc.port {
				t.Fatalf("got %s:%d want %s:%d", addr, port, tc.addr, tc.port)
			}
		})
	}
}

func TestUnitFromCgroup(t *testing.T) {
	for _, tc := range []struct{ in, want string }{
		{"0::/system.slice/caddy.service\n", "caddy.service"},
		{"0::/user.slice/user-0.slice/user@0.service/app.slice/tmuxatlas.service\n", "tmuxatlas.service"},
		{"0::/user.slice/user-0.slice/session-3.scope\n", "session-3.scope"},
		{"0::/\n", ""},
	} {
		t.Run(tc.want, func(t *testing.T) {
			if got := unitFromCgroup(tc.in); got != tc.want {
				t.Fatalf("unitFromCgroup = %q want %q", got, tc.want)
			}
		})
	}
}

func TestCollectorSamplesLiveHost(t *testing.T) {
	c := newCollector(nil)
	c.hostInfo()
	if first := c.sample(time.Now()); first.valid {
		t.Fatal("first sample must only prime counters")
	}
	time.Sleep(200 * time.Millisecond)
	snap := c.sample(time.Now())
	if !snap.valid || snap.current.Memory.Total == 0 || len(snap.current.Cores) == 0 {
		t.Fatalf("unexpected snapshot: %+v", snap.current)
	}
	if snap.sample.CPU < 0 || snap.sample.CPU > 100 {
		t.Fatalf("cpu out of range: %v", snap.sample.CPU)
	}
	if len(snap.processes) == 0 || len(snap.filesystems) == 0 {
		t.Fatal("expected processes and filesystems")
	}
}
