// Package voice bridges a browser microphone to a PulseAudio virtual microphone
// so that terminal programs on this host that capture from the default audio
// device (for example Claude Code /voice through SoX) hear the browser user.
//
//	browser tab mic -> /ws/mic -> pacat -> the tab's null sink -> monitor source -> ALSA pulse plugin -> SoX
//
// Each tab has its own null sink, so people dictating at the same time never hear
// each other. Recorders start on the silent default source "atlas_mic" and are
// moved to the microphone of the tab using their tmux session (see route.go).
//
// A null sink is used rather than a pipe source because PulseAudio clocks it: an
// open recorder receives real-time silence when nobody is streaming, and audio
// never queues up to be replayed later.
package voice

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/sirupsen/logrus"

	"github.com/LosFurina/tmuxatlas/pkg/ws"
)

const (
	sinkName   = "atlas_mic"
	sourceName = sinkName + ".monitor"

	// SampleRate, 16-bit little-endian mono, is the format the browser must send.
	SampleRate = 16000

	// maxFrameBytes bounds one WebSocket message. Browsers send 20 ms (640 bytes).
	maxFrameBytes = 16 << 10
	// frameTimeout closes a stream whose browser stopped sending. A live
	// microphone sends 50 frames per second, even when the room is silent.
	frameTimeout = 15 * time.Second

	commandTimeout = 5 * time.Second

	// maxStreams bounds the PulseAudio modules that browsers can make this host load.
	maxStreams = 16
)

// asoundrc routes ALSA clients such as SoX to PulseAudio.
const asoundrc = `# Managed by TmuxAtlas (TMUXATLAS_VOICE): ALSA capture goes through PulseAudio.
pcm.!default { type pulse }
ctl.!default { type pulse }
`

// Status reports whether the browser microphone can be used on this host.
type Status struct {
	Enabled bool   `json:"enabled"`
	Ready   bool   `json:"ready"`
	Error   string `json:"error,omitempty"`
}

// Enabled reads TMUXATLAS_VOICE. Voice stays off unless explicitly enabled
// because setup changes the default audio source of the user running TmuxAtlas.
func Enabled(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "on", "true", "1", "yes":
		return true
	default:
		return false
	}
}

// runner executes a command and returns its combined output.
type runner func(ctx context.Context, name string, args ...string) (string, error)

func execRunner(ctx context.Context, name string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, commandTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	// pactl translates the output that route.go parses.
	cmd.Env = append(os.Environ(), "LC_ALL=C")
	out, err := cmd.CombinedOutput()
	return strings.TrimSpace(string(out)), err
}

// playback is the running audio sink for one browser stream.
type playback interface {
	io.Writer
	Close() error
}

type pacatPlayback struct {
	cmd   *exec.Cmd
	stdin io.WriteCloser
}

func startPacat(sink string) (playback, error) {
	cmd := exec.Command("pacat",
		"--playback", "--raw",
		"--format=s16le", fmt.Sprintf("--rate=%d", SampleRate), "--channels=1",
		"--latency-msec=30",
		"--device="+sink,
		"--stream-name=tmuxatlas-browser-mic",
	)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	return &pacatPlayback{cmd: cmd, stdin: stdin}, nil
}

func (p *pacatPlayback) Write(b []byte) (int, error) { return p.stdin.Write(b) }

func (p *pacatPlayback) Close() error {
	p.stdin.Close()
	if p.cmd.Process != nil {
		p.cmd.Process.Kill()
	}
	return p.cmd.Wait()
}

// stream is one browser tab's live microphone.
type stream struct {
	id     string
	sink   string
	order  uint64
	cancel func()
}

// Mic owns the virtual microphones and routes recorders to them.
type Mic struct {
	run         runner
	start       func(sink string) (playback, error)
	asoundrc    string
	upgrader    websocket.Upgrader
	subscribe   func(ctx context.Context, onEvent func(line string)) error
	paneSession func(ctx context.Context, pid int) string

	mu       sync.Mutex
	status   Status
	streams  map[string]*stream
	sessions map[string]string // tmux session -> id of the tab last using it
	order    uint64

	// sinkMu keeps Setup from removing a sink that is being created.
	sinkMu sync.Mutex
	sinks  map[string]string // sink name -> module index

	routeMu sync.Mutex
	routed  map[string]string // source output -> the source it was moved to
}

// New creates a Mic for the current user. Call Setup before serving streams, and
// Run to route recorders. tmuxPath is the tmux binary used to identify sessions.
func New(tmuxPath string) *Mic {
	home, _ := os.UserHomeDir()
	m := &Mic{
		run:       execRunner,
		start:     startPacat,
		subscribe: pactlSubscribe,
		asoundrc:  filepath.Join(home, ".asoundrc"),
		upgrader: websocket.Upgrader{
			CheckOrigin:     ws.CheckSameOrigin,
			ReadBufferSize:  4 << 10,
			WriteBufferSize: 1 << 10,
		},
		status:   Status{Enabled: true},
		streams:  make(map[string]*stream),
		sessions: make(map[string]string),
		sinks:    make(map[string]string),
		routed:   make(map[string]string),
	}
	m.paneSession = func(ctx context.Context, pid int) string {
		return tmuxSessionOfProcess(ctx, m.run, tmuxPath, pid)
	}
	return m
}

// Status returns the result of the latest Setup.
func (m *Mic) Status() Status {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.status
}

// Setup makes the virtual microphone the default capture device. It is
// idempotent and runs again for each stream, so a restarted PulseAudio recovers.
func (m *Mic) Setup(ctx context.Context) error {
	err := m.setup(ctx)
	m.mu.Lock()
	m.status = Status{Enabled: true, Ready: err == nil}
	if err != nil {
		m.status.Error = err.Error()
	}
	m.mu.Unlock()
	return err
}

func (m *Mic) setup(ctx context.Context) error {
	if err := m.ensureAsoundrc(); err != nil {
		return err
	}
	if _, err := m.run(ctx, "pulseaudio", "--check"); err != nil {
		if out, startErr := m.run(ctx, "pulseaudio", "--start", "--exit-idle-time=-1"); startErr != nil {
			return commandError("start PulseAudio", out, startErr)
		}
	}
	modules, err := m.run(ctx, "pactl", "list", "short", "modules")
	if err != nil {
		return commandError("list PulseAudio modules", modules, err)
	}
	if !hasNamedSink(modules, sinkName) {
		out, err := m.run(ctx, "pactl", "load-module", "module-null-sink",
			"sink_name="+sinkName,
			fmt.Sprintf("rate=%d", SampleRate), "channels=1", "format=s16le",
			"sink_properties=device.description=TmuxAtlas_Mic",
		)
		if err != nil {
			return commandError("create the virtual microphone", out, err)
		}
	}
	// A suspended sink adds a resume delay that would clip the start of dictation.
	if strings.Contains(modules, "module-suspend-on-idle") {
		if out, err := m.run(ctx, "pactl", "unload-module", "module-suspend-on-idle"); err != nil {
			return commandError("disable PulseAudio idle suspend", out, err)
		}
	}
	// It would start a recorder on the source it last used, which can be another
	// tab's microphone, until route moves it.
	if strings.Contains(modules, "module-stream-restore") {
		if out, err := m.run(ctx, "pactl", "unload-module", "module-stream-restore"); err != nil {
			return commandError("disable PulseAudio stream restore", out, err)
		}
	}
	if out, err := m.run(ctx, "pactl", "set-default-source", sourceName); err != nil {
		return commandError("select the virtual microphone", out, err)
	}
	m.removeOrphanSinks(ctx, modules)
	return nil
}

// ensureAsoundrc writes the ALSA routing file, refusing to replace a file that
// does not already route the default device to PulseAudio.
func (m *Mic) ensureAsoundrc() error {
	existing, err := os.ReadFile(m.asoundrc)
	switch {
	case err == nil:
		if routesToPulse(string(existing)) {
			return nil
		}
		return fmt.Errorf("%s exists and does not route the default ALSA device to PulseAudio; add: pcm.!default { type pulse }", m.asoundrc)
	case errors.Is(err, os.ErrNotExist):
		if err := os.WriteFile(m.asoundrc, []byte(asoundrc), 0o644); err != nil {
			return fmt.Errorf("write %s: %w", m.asoundrc, err)
		}
		return nil
	default:
		return fmt.Errorf("read %s: %w", m.asoundrc, err)
	}
}

func routesToPulse(content string) bool {
	return strings.Contains(strings.Join(strings.Fields(content), " "), "pcm.!default { type pulse }")
}

func commandError(action, output string, err error) error {
	if output != "" {
		return fmt.Errorf("%s: %s", action, output)
	}
	return fmt.Errorf("%s: %w", action, err)
}

// HandleStream receives PCM frames from one browser tab and plays them into that
// tab's virtual microphone. Audio is forwarded only and never stored.
func (m *Mic) HandleStream(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	if id == "" {
		id = newStreamID()
	} else if !validStreamID(id) {
		http.Error(w, "invalid microphone id", http.StatusBadRequest)
		return
	}
	if err := m.Setup(r.Context()); err != nil {
		logrus.WithError(err).Warn("voice setup failed")
		http.Error(w, err.Error(), http.StatusServiceUnavailable)
		return
	}
	conn, err := m.upgrader.Upgrade(w, r, nil)
	if err != nil {
		logrus.WithError(err).Warn("mic ws upgrade failed")
		return
	}
	defer conn.Close()
	conn.SetReadLimit(maxFrameBytes)

	sink, removeSink, err := m.createSink(r.Context())
	if err != nil {
		logrus.WithError(err).Error("failed to create the tab's virtual microphone")
		closeWith(conn, websocket.CloseInternalServerErr, "microphone setup failed")
		return
	}
	defer removeSink()

	player, err := m.start(sink)
	if err != nil {
		logrus.WithError(err).Error("failed to start mic playback")
		closeWith(conn, websocket.CloseInternalServerErr, "microphone playback failed")
		return
	}
	var closePlayer sync.Once
	stopPlayer := func() { closePlayer.Do(func() { player.Close() }) }
	defer stopPlayer()

	var takenOver sync.Once
	release, err := m.register(id, sink, func() {
		takenOver.Do(func() {
			closeWith(conn, websocket.ClosePolicyViolation, "microphone restarted in this tab")
			stopPlayer()
			conn.Close()
		})
	})
	if err != nil {
		closeWith(conn, websocket.CloseTryAgainLater, err.Error())
		return
	}
	defer release()
	go m.route(context.Background())

	logrus.Info("browser microphone connected")
	defer logrus.Info("browser microphone disconnected")
	for {
		conn.SetReadDeadline(time.Now().Add(frameTimeout))
		messageType, frame, err := conn.ReadMessage()
		if err != nil {
			return
		}
		if messageType != websocket.BinaryMessage || len(frame)%2 != 0 {
			closeWith(conn, websocket.CloseUnsupportedData, "expected 16-bit PCM frames")
			return
		}
		if _, err := player.Write(frame); err != nil {
			logrus.WithError(err).Warn("mic playback stopped")
			closeWith(conn, websocket.CloseInternalServerErr, "microphone playback stopped")
			return
		}
	}
}

func closeWith(conn *websocket.Conn, code int, reason string) {
	conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(code, reason), time.Now().Add(time.Second))
}
