package voice

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/sirupsen/logrus"
)

var streamIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{8,64}$`)

func validStreamID(id string) bool { return streamIDPattern.MatchString(id) }

func newStreamID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// hasNamedSink reports whether a module in `pactl list short modules` output
// declares exactly this sink, which atlas_mic_<id> must not satisfy for atlas_mic.
func hasNamedSink(modules, name string) bool {
	for _, field := range strings.Fields(modules) {
		if field == "sink_name="+name {
			return true
		}
	}
	return false
}

// createSink loads a null sink for one tab and returns its name and its removal.
func (m *Mic) createSink(ctx context.Context) (string, func(), error) {
	name := sinkName + "_" + newStreamID()
	m.sinkMu.Lock()
	defer m.sinkMu.Unlock()
	module, err := m.run(ctx, "pactl", "load-module", "module-null-sink",
		"sink_name="+name,
		fmt.Sprintf("rate=%d", SampleRate), "channels=1", "format=s16le",
		"sink_properties=device.description=TmuxAtlas_Tab_Mic",
	)
	if err != nil {
		return "", nil, commandError("create the tab microphone", module, err)
	}
	m.sinks[name] = module
	return name, func() {
		m.sinkMu.Lock()
		defer m.sinkMu.Unlock()
		delete(m.sinks, name)
		ctx, cancel := context.WithTimeout(context.Background(), commandTimeout)
		defer cancel()
		if out, err := m.run(ctx, "pactl", "unload-module", module); err != nil {
			logrus.WithError(commandError("remove the tab microphone", out, err)).Warn("voice cleanup failed")
		}
	}, nil
}

// removeOrphanSinks unloads tab sinks that no stream owns, left by a crash.
func (m *Mic) removeOrphanSinks(ctx context.Context, modules string) {
	m.sinkMu.Lock()
	defer m.sinkMu.Unlock()
	for _, line := range strings.Split(modules, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		for _, field := range fields[2:] {
			name, ok := strings.CutPrefix(field, "sink_name="+sinkName+"_")
			if !ok {
				continue
			}
			if _, live := m.sinks[sinkName+"_"+name]; live {
				continue
			}
			if out, err := m.run(ctx, "pactl", "unload-module", fields[0]); err != nil {
				logrus.WithError(commandError("remove an orphan microphone", out, err)).Warn("voice cleanup failed")
			}
		}
	}
}

// register makes a stream the tab's microphone, replacing the tab's previous
// one. Other tabs are unaffected.
func (m *Mic) register(id, sink string, cancel func()) (release func(), err error) {
	m.mu.Lock()
	previous := m.streams[id]
	if previous == nil && len(m.streams) >= maxStreams {
		m.mu.Unlock()
		return nil, errors.New("too many microphones are connected")
	}
	m.order++
	current := &stream{id: id, sink: sink, order: m.order, cancel: cancel}
	m.streams[id] = current
	m.mu.Unlock()
	if previous != nil {
		previous.cancel()
	}
	return func() {
		m.mu.Lock()
		defer m.mu.Unlock()
		if m.streams[id] != current {
			return
		}
		delete(m.streams, id)
		for session, owner := range m.sessions {
			if owner == id {
				delete(m.sessions, session)
			}
		}
	}, nil
}

// UseSession records that a tab is working in a tmux session, so a recorder
// started there hears that tab. Tabs without a live microphone are ignored.
func (m *Mic) UseSession(session, id string) {
	m.mu.Lock()
	_, live := m.streams[id]
	changed := live && m.sessions[session] != id
	if changed {
		m.sessions[session] = id
	}
	m.mu.Unlock()
	if changed {
		go m.route(context.Background())
	}
}

// targetFor returns the source a recorder in this session should capture: the
// microphone of the tab using the session, or else the newest one, for recorders
// outside tmux or in a session no tab has touched.
func (m *Mic) targetFor(session string) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	if current := m.streams[m.sessions[session]]; current != nil {
		return current.sink + ".monitor"
	}
	var newest *stream
	for _, current := range m.streams {
		if newest == nil || current.order > newest.order {
			newest = current
		}
	}
	if newest == nil {
		return ""
	}
	return newest.sink + ".monitor"
}

type sourceOutput struct {
	index string
	pid   int
}

// parseSourceOutputs reads `pactl list source-outputs` in the C locale.
func parseSourceOutputs(listing string) []sourceOutput {
	var outputs []sourceOutput
	for _, line := range strings.Split(listing, "\n") {
		line = strings.TrimSpace(line)
		if index, ok := strings.CutPrefix(line, "Source Output #"); ok {
			outputs = append(outputs, sourceOutput{index: index})
			continue
		}
		if value, ok := strings.CutPrefix(line, "application.process.id = "); ok && len(outputs) > 0 {
			outputs[len(outputs)-1].pid, _ = strconv.Atoi(strings.Trim(value, `"`))
		}
	}
	return outputs
}

// route moves each recorder to the microphone it should hear.
func (m *Mic) route(ctx context.Context) {
	m.routeMu.Lock()
	defer m.routeMu.Unlock()
	listing, err := m.run(ctx, "pactl", "list", "source-outputs")
	if err != nil {
		logrus.WithError(commandError("list recorders", listing, err)).Debug("voice routing skipped")
		return
	}
	seen := make(map[string]bool)
	for _, output := range parseSourceOutputs(listing) {
		seen[output.index] = true
		target := m.targetFor(m.paneSession(ctx, output.pid))
		if target == "" || m.routed[output.index] == target {
			continue
		}
		if out, err := m.run(ctx, "pactl", "move-source-output", output.index, target); err != nil {
			logrus.WithError(commandError("route a recorder", out, err)).Warn("voice routing failed")
			continue
		}
		m.routed[output.index] = target
	}
	for index := range m.routed {
		if !seen[index] {
			delete(m.routed, index)
		}
	}
}

// Run routes each new recorder until ctx ends, following PulseAudio restarts.
func (m *Mic) Run(ctx context.Context) {
	for ctx.Err() == nil {
		err := m.subscribe(ctx, func(line string) {
			if strings.Contains(line, "'new'") && strings.Contains(line, "source-output") {
				m.route(ctx)
			}
		})
		if err != nil && ctx.Err() == nil {
			logrus.WithError(err).Debug("voice event stream ended")
		}
		select {
		case <-ctx.Done():
		case <-time.After(2 * time.Second):
		}
	}
}

func pactlSubscribe(ctx context.Context, onEvent func(line string)) error {
	cmd := exec.CommandContext(ctx, "pactl", "subscribe")
	cmd.Env = append(os.Environ(), "LC_ALL=C")
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		onEvent(scanner.Text())
	}
	return cmd.Wait()
}

// tmuxSessionOfProcess names the tmux session a process runs in, from the
// environment tmux gives to the programs of a pane. It returns "" outside tmux.
func tmuxSessionOfProcess(ctx context.Context, run runner, tmuxPath string, pid int) string {
	if pid <= 0 {
		return ""
	}
	environ, err := os.ReadFile(fmt.Sprintf("/proc/%d/environ", pid))
	if err != nil {
		return ""
	}
	var socket, pane string
	for _, entry := range bytes.Split(environ, []byte{0}) {
		if value, ok := bytes.CutPrefix(entry, []byte("TMUX=")); ok {
			socket, _, _ = strings.Cut(string(value), ",")
		}
		if value, ok := bytes.CutPrefix(entry, []byte("TMUX_PANE=")); ok {
			pane = string(value)
		}
	}
	if socket == "" || pane == "" {
		return ""
	}
	session, err := run(ctx, tmuxPath, "-S", socket, "display-message", "-p", "-t", pane, "#{session_name}")
	if err != nil {
		return ""
	}
	return session
}
