package voice

import (
	"context"
	"encoding/binary"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

const twoRecorders = `Source Output #7
	Driver: protocol-native.c
	Source: 1
	Properties:
		application.name = "ALSA plug-in [sox]"
		application.process.id = "100"

Source Output #8
	Source: 1
	Properties:
		application.process.id = "200"
`

func TestParseSourceOutputs(t *testing.T) {
	got := parseSourceOutputs(twoRecorders)
	if len(got) != 2 || got[0] != (sourceOutput{"7", 100}) || got[1] != (sourceOutput{"8", 200}) {
		t.Fatalf("got %+v", got)
	}
}

func TestHasNamedSink(t *testing.T) {
	tab := "12\tmodule-null-sink\tsink_name=atlas_mic_abc rate=16000"
	if hasNamedSink(tab, sinkName) {
		t.Error("a tab sink must not count as the default sink")
	}
	if !hasNamedSink("3\tmodule-null-sink\tsink_name=atlas_mic rate=16000", sinkName) {
		t.Error("default sink not found")
	}
}

func TestRoute(t *testing.T) {
	setup := func(t *testing.T) (*Mic, *fakePulse) {
		pulse := &fakePulse{running: true, outputs: twoRecorders}
		mic := newTestMic(t, pulse)
		mic.paneSession = func(_ context.Context, pid int) string {
			return map[int]string{100: "alice-session", 200: "bob-session"}[pid]
		}
		for id, sink := range map[string]string{"alice-tab": "sink_a", "bob-tab": "sink_b"} {
			if _, err := mic.register(id, sink, func() {}); err != nil {
				t.Fatal(err)
			}
		}
		return mic, pulse
	}

	t.Run("each recorder hears the tab using its session", func(t *testing.T) {
		mic, pulse := setup(t)
		mic.UseSession("alice-session", "alice-tab")
		mic.UseSession("bob-session", "bob-tab")
		mic.route(context.Background())
		for _, want := range []string{"move-source-output 7 sink_a.monitor", "move-source-output 8 sink_b.monitor"} {
			if !pulse.called(want) {
				t.Errorf("missing %q in %v", want, pulse.calls)
			}
		}
	})

	t.Run("the tab last using a session wins", func(t *testing.T) {
		mic, pulse := setup(t)
		mic.UseSession("alice-session", "alice-tab")
		mic.UseSession("alice-session", "bob-tab")
		mic.route(context.Background())
		if !pulse.called("move-source-output 7 sink_b.monitor") {
			t.Errorf("calls = %v", pulse.calls)
		}
	})

	t.Run("an unclaimed recorder hears the newest tab", func(t *testing.T) {
		mic, pulse := setup(t)
		if _, err := mic.register("carol-tab", "sink_c", func() {}); err != nil {
			t.Fatal(err)
		}
		mic.route(context.Background())
		if !pulse.called("move-source-output 7 sink_c.monitor") {
			t.Errorf("calls = %v", pulse.calls)
		}
	})

	t.Run("a tab without a microphone claims nothing", func(t *testing.T) {
		mic, _ := setup(t)
		mic.UseSession("alice-session", "no-such-tab")
		if len(mic.sessions) != 0 {
			t.Errorf("sessions = %v", mic.sessions)
		}
	})

	t.Run("a closed tab no longer receives recorders", func(t *testing.T) {
		pulse := &fakePulse{running: true, outputs: twoRecorders}
		mic := newTestMic(t, pulse)
		mic.paneSession = func(context.Context, int) string { return "s" }
		release, err := mic.register("tab-one", "sink_a", func() {})
		if err != nil {
			t.Fatal(err)
		}
		mic.UseSession("s", "tab-one")
		release()
		if len(mic.sessions) != 0 || mic.targetFor("s") != "" {
			t.Errorf("sessions = %v target = %q", mic.sessions, mic.targetFor("s"))
		}
	})

	t.Run("does not move a recorder twice", func(t *testing.T) {
		mic, pulse := setup(t)
		mic.route(context.Background())
		mic.route(context.Background())
		count := 0
		for _, call := range pulse.calls {
			if strings.Contains(call, "move-source-output 7") {
				count++
			}
		}
		if count != 1 {
			t.Errorf("moved %d times: %v", count, pulse.calls)
		}
	})

	t.Run("limits the number of microphones", func(t *testing.T) {
		mic := newTestMic(t, &fakePulse{running: true})
		for i := range maxStreams {
			if _, err := mic.register(string(rune('a'+i)), "sink", func() {}); err != nil {
				t.Fatal(err)
			}
		}
		if _, err := mic.register("one-too-many", "sink", func() {}); err == nil {
			t.Error("expected a refusal")
		}
	})
}

func TestSetupRemovesOrphanSinksOnly(t *testing.T) {
	pulse := &fakePulse{running: true, modules: "3\tmodule-null-sink\tsink_name=atlas_mic rate=16000\n" +
		"20\tmodule-null-sink\tsink_name=atlas_mic_orphan rate=16000\n" +
		"21\tmodule-null-sink\tsink_name=atlas_mic_live rate=16000\n" +
		"22\tmodule-stream-restore\t"}
	mic := newTestMic(t, pulse)
	mic.sinks["atlas_mic_live"] = "21"
	if err := mic.Setup(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !pulse.called("unload-module 20") {
		t.Errorf("orphan kept: %v", pulse.calls)
	}
	if pulse.called("unload-module 21") || pulse.called("unload-module 3") || pulse.called("pactl load-module") {
		t.Errorf("live sinks must be kept: %v", pulse.calls)
	}
	if !pulse.called("unload-module module-stream-restore") {
		t.Errorf("stream restore kept: %v", pulse.calls)
	}
}

// TestTwoTabsRealPulse needs PulseAudio, SoX and tmux, and uses the host's
// PulseAudio server. Run it with TMUXATLAS_VOICE_E2E=1.
func TestTwoTabsRealPulse(t *testing.T) {
	if os.Getenv("TMUXATLAS_VOICE_E2E") == "" {
		t.Skip("TMUXATLAS_VOICE_E2E is not set")
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	mic := New("tmux")
	mic.asoundrc = filepath.Join(os.Getenv("HOME"), ".asoundrc")
	go mic.Run(ctx)
	time.Sleep(300 * time.Millisecond)
	server := httptest.NewServer(http.HandlerFunc(mic.HandleStream))
	defer server.Close()

	tabs := []struct {
		id, session string
		hertz       float64
	}{{"e2e-tab-alice", "e2e-alice", 440}, {"e2e-tab-bob", "e2e-bob", 1500}}
	socket := "atlas-voice-e2e-" + newStreamID()[:8]
	defer exec.Command("tmux", "-L", socket, "kill-server").Run()
	if out, err := exec.Command("tmux", "-L", socket, "-f", "/dev/null", "new-session", "-d", "-s", "keep").CombinedOutput(); err != nil {
		t.Fatalf("tmux: %v %s", err, out)
	}

	var conns []*websocket.Conn
	for _, tab := range tabs {
		conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"?id="+tab.id, nil)
		if err != nil {
			t.Fatal(err)
		}
		conns = append(conns, conn)
		go sendTone(ctx, conn, tab.hertz)
	}
	waitFor(t, func() bool { mic.mu.Lock(); defer mic.mu.Unlock(); return len(mic.streams) == 2 })
	for _, tab := range tabs {
		mic.UseSession(tab.session, tab.id)
	}

	dir := t.TempDir()
	for _, tab := range tabs {
		command := "rec -q -c1 -r16000 " + filepath.Join(dir, tab.session+".wav") + " trim 0 3"
		if out, err := exec.Command("tmux", "-L", socket, "new-session", "-d", "-s", tab.session, command).CombinedOutput(); err != nil {
			t.Fatalf("tmux: %v %s", err, out)
		}
	}
	time.Sleep(4500 * time.Millisecond)

	for _, tab := range tabs {
		data, err := os.ReadFile(filepath.Join(dir, tab.session+".wav"))
		if err != nil {
			t.Fatal(err)
		}
		got := dominantHertz(t, data)
		t.Logf("%s heard %.0f Hz, expected %.0f Hz", tab.session, got, tab.hertz)
		if math.Abs(got-tab.hertz) > tab.hertz*0.05 {
			t.Errorf("%s heard %.0f Hz, want %.0f Hz", tab.session, got, tab.hertz)
		}
	}

	for _, conn := range conns {
		conn.Close()
	}
	waitFor(t, func() bool { mic.sinkMu.Lock(); defer mic.sinkMu.Unlock(); return len(mic.sinks) == 0 })
	if modules, _ := mic.run(ctx, "pactl", "list", "short", "modules"); strings.Contains(modules, "sink_name="+sinkName+"_") {
		t.Errorf("tab microphones left behind:\n%s", modules)
	}
}

func waitFor(t *testing.T, ready func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !ready() {
		if time.Now().After(deadline) {
			t.Fatal("timed out")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func sendTone(ctx context.Context, conn *websocket.Conn, hertz float64) {
	const samples = SampleRate / 50
	sample := 0
	ticker := time.NewTicker(20 * time.Millisecond)
	defer ticker.Stop()
	for {
		frame := make([]byte, samples*2)
		for i := range samples {
			value := int16(12000 * math.Sin(2*math.Pi*hertz*float64(sample)/SampleRate))
			binary.LittleEndian.PutUint16(frame[i*2:], uint16(value))
			sample++
		}
		if conn.WriteMessage(websocket.BinaryMessage, frame) != nil {
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// dominantHertz counts zero crossings in the last second of a 16 kHz mono WAV.
func dominantHertz(t *testing.T, wav []byte) float64 {
	t.Helper()
	start := strings.Index(string(wav), "data")
	if start < 0 || len(wav) < start+8+2*SampleRate {
		t.Fatalf("recording too short: %d bytes", len(wav))
	}
	pcm := wav[len(wav)-2*SampleRate:]
	crossings := 0
	previous := int16(0)
	for i := 0; i+1 < len(pcm); i += 2 {
		value := int16(binary.LittleEndian.Uint16(pcm[i:]))
		if (previous < 0) != (value < 0) {
			crossings++
		}
		previous = value
	}
	return float64(crossings) / 2
}
