package ws

import (
	"bytes"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

type lockedBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *lockedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *lockedBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

type failingWriter struct{}

func (failingWriter) Write([]byte) (int, error) { return 0, errors.New("closed") }

func waitForSpaces(t *testing.T, output *lockedBuffer, count int) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for strings.Count(output.String(), " ") < count {
		if time.Now().After(deadline) {
			t.Fatalf("got %q, want %d spaces", output.String(), count)
		}
		time.Sleep(time.Millisecond)
	}
}

func TestVoiceHold(t *testing.T) {
	t.Run("repeats until stopped and writes nothing afterwards", func(t *testing.T) {
		output := &lockedBuffer{}
		hold := newVoiceHold(output)
		hold.interval = time.Millisecond
		hold.Start()
		hold.Start()
		waitForSpaces(t, output, 3)
		hold.Stop()
		stopped := output.String()
		if strings.Trim(stopped, " ") != "" {
			t.Fatalf("unexpected output %q", stopped)
		}
		time.Sleep(10 * time.Millisecond)
		if output.String() != stopped {
			t.Fatal("space written after Stop returned")
		}
	})

	t.Run("stops at the limit and can restart", func(t *testing.T) {
		output := &lockedBuffer{}
		hold := newVoiceHold(output)
		hold.interval = time.Hour
		hold.limit = time.Millisecond
		hold.Start()
		waitForSpaces(t, output, 1)
		hold.Stop()
		hold.limit = time.Hour
		hold.Start()
		waitForSpaces(t, output, 2)
		hold.Stop()
	})

	t.Run("stops when the output fails", func(t *testing.T) {
		hold := newVoiceHold(failingWriter{})
		hold.Start()
		hold.Stop()
	})

	t.Run("stop without start is harmless", func(t *testing.T) {
		newVoiceHold(&lockedBuffer{}).Stop()
	})
}

func TestPTYVoiceHoldMessages(t *testing.T) {
	// This executable stands in for tmux and reflects the PTY input to its output.
	script := filepath.Join(t.TempDir(), "tmux")
	if err := os.WriteFile(script, []byte("#!/bin/sh\nstty raw -echo\nprintf READY\nexec cat\n"), 0700); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(NewPTYTerminalHandler(script, nil).HandleSession))
	defer server.Close()
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"?name=test", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	if _, _, err := conn.ReadMessage(); err != nil {
		t.Fatal(err)
	}
	if err := conn.WriteJSON(map[string]any{"type": "voice-hold", "on": true}); err != nil {
		t.Fatal(err)
	}
	received := ""
	for strings.Count(received, " ") < 3 {
		_, data, err := conn.ReadMessage()
		if err != nil {
			t.Fatal(err)
		}
		received += string(data)
	}
	if err := conn.WriteJSON(map[string]any{"type": "voice-hold", "on": false}); err != nil {
		t.Fatal(err)
	}
	if err := conn.WriteMessage(websocket.BinaryMessage, []byte("x")); err != nil {
		t.Fatal(err)
	}
	for !strings.Contains(received, "x") {
		_, data, err := conn.ReadMessage()
		if err != nil {
			t.Fatal(err)
		}
		received += string(data)
	}
	if !strings.HasSuffix(received, "x") {
		t.Fatalf("space followed the release: %q", received)
	}
	_ = conn.SetReadDeadline(time.Now().Add(200 * time.Millisecond))
	if _, data, err := conn.ReadMessage(); err == nil {
		t.Fatalf("output after release: %q", data)
	}
}
