package ws

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestPTYImagePaste(t *testing.T) {
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
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
	var imageData bytes.Buffer
	if err := png.Encode(&imageData, image.NewRGBA(image.Rect(0, 0, 1, 1))); err != nil {
		t.Fatal(err)
	}
	if err := conn.WriteJSON(map[string]any{"type": "image", "data": base64.StdEncoding.EncodeToString(imageData.Bytes()), "final": true}); err != nil {
		t.Fatal(err)
	}
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	gotResult, gotPaste := false, false
	for !gotResult || !gotPaste {
		typ, data, err := conn.ReadMessage()
		if err != nil {
			t.Fatal(err)
		}
		if typ == websocket.TextMessage {
			var result struct {
				Type  string `json:"type"`
				Error string `json:"error"`
			}
			if err := json.Unmarshal(data, &result); err != nil || result.Type != "image-result" || result.Error != "" {
				t.Fatalf("result %s: %v", data, err)
			}
			gotResult = true
		} else if bytes.Contains(data, []byte("\x1b[200~")) && bytes.Contains(data, []byte("\x1b[201~")) {
			gotPaste = true
		}
	}
}
