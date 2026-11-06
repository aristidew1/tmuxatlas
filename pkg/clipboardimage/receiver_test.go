package clipboardimage

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	"image/png"
	"os"
	"testing"
)

func TestReceiveImage(t *testing.T) {
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	var original bytes.Buffer
	img := image.NewRGBA(image.Rect(0, 0, 2, 2))
	img.Set(0, 0, color.RGBA{R: 255, A: 255})
	if err := png.Encode(&original, img); err != nil {
		t.Fatal(err)
	}
	data := original.Bytes()
	var r Receiver
	path, err := r.Add(base64.StdEncoding.EncodeToString(data[:10]), false)
	if err != nil || path != "" {
		t.Fatalf("first chunk: %q %v", path, err)
	}
	path, err = r.Add(base64.StdEncoding.EncodeToString(data[10:]), true)
	if err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(got, data) {
		t.Fatalf("saved image mismatch: %v", err)
	}
	info, err := os.Stat(path)
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatalf("file permissions: %v %v", info, err)
	}
}

func TestRejectInvalidImageAndReset(t *testing.T) {
	var r Receiver
	if _, err := r.Add("not base64", false); err == nil {
		t.Fatal("expected bad chunk to fail")
	}
	if path, err := r.Add("", true); err != nil || path != "" {
		t.Fatalf("discard remaining chunk: %q %v", path, err)
	}
	if _, err := r.Add(base64.StdEncoding.EncodeToString([]byte("not an image")), true); err == nil {
		t.Fatal("expected invalid image to fail")
	}
}
