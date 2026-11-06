// Package clipboardimage receives bounded image uploads from a terminal connection.
package clipboardimage

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"os"
	"path/filepath"
)

const MaxBytes = 10 << 20

type Receiver struct {
	data   []byte
	failed bool
}

// Add accepts independently encoded chunks; a final chunk commits the image.
func (r *Receiver) Add(encoded string, final bool) (string, error) {
	if r.failed {
		if final {
			r.failed = false
		}
		return "", nil
	}
	chunk, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || len(chunk) > 24<<10 || len(r.data)+len(chunk) > MaxBytes {
		r.data = nil
		r.failed = !final
		return "", fmt.Errorf("invalid image data or image exceeds 10 MB")
	}
	r.data = append(r.data, chunk...)
	if !final {
		return "", nil
	}
	data := r.data
	r.data = nil
	_, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return "", fmt.Errorf("unsupported or invalid image (use PNG, JPEG or GIF)")
	}
	ext := map[string]string{"png": ".png", "jpeg": ".jpg", "gif": ".gif"}[format]
	if ext == "" {
		return "", fmt.Errorf("unsupported image format")
	}
	dir, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	dir = filepath.Join(dir, "tmuxatlas", "clipboard-images")
	if err = os.MkdirAll(dir, 0700); err != nil {
		return "", err
	}
	f, err := os.CreateTemp(dir, "image-*"+ext)
	if err != nil {
		return "", err
	}
	path := f.Name()
	if _, err = f.Write(data); err != nil {
		f.Close()
		os.Remove(path)
		return "", err
	}
	if err = f.Close(); err != nil {
		os.Remove(path)
		return "", err
	}
	return path, nil
}
