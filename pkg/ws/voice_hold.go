package ws

import (
	"io"
	"sync"
	"time"
)

const (
	voiceHoldInterval = 40 * time.Millisecond
	// voiceHoldLimit ends a hold that nothing stopped.
	voiceHoldLimit = 10 * time.Minute
)

// voiceHold simulates a held space bar for Claude Code dictation. It runs on the
// server because Claude treats a 200 ms gap as a release, which network jitter
// between the browser and the server would otherwise trigger.
type voiceHold struct {
	output   io.Writer
	interval time.Duration
	limit    time.Duration

	mu   sync.Mutex
	stop chan struct{}
	done chan struct{}
}

func newVoiceHold(output io.Writer) *voiceHold {
	return &voiceHold{output: output, interval: voiceHoldInterval, limit: voiceHoldLimit}
}

// Start begins repeating space, if it is not already repeating.
func (h *voiceHold) Start() {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.stop != nil {
		return
	}
	stop, done := make(chan struct{}), make(chan struct{})
	h.stop, h.done = stop, done
	go h.run(stop, done)
}

func (h *voiceHold) run(stop <-chan struct{}, done chan<- struct{}) {
	defer close(done)
	ticker := time.NewTicker(h.interval)
	defer ticker.Stop()
	limit := time.NewTimer(h.limit)
	defer limit.Stop()
	for {
		if _, err := h.output.Write([]byte{' '}); err != nil {
			return
		}
		select {
		case <-stop:
			return
		case <-limit.C:
			return
		case <-ticker.C:
		}
	}
}

// Stop ends the repeat and returns once no further space can be written, so
// input sent afterwards follows it.
func (h *voiceHold) Stop() {
	h.mu.Lock()
	stop, done := h.stop, h.done
	h.stop, h.done = nil, nil
	h.mu.Unlock()
	if stop == nil {
		return
	}
	close(stop)
	<-done
}
