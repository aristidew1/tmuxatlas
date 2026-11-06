package auth

import (
	"testing"
	"time"
)

func TestAccountSessionsStoreOnlyHashesAndRevoke(t *testing.T) {
	m := NewSessionManager(time.Hour)
	first, err := m.CreateForAccount("one")
	if err != nil {
		t.Fatal(err)
	}
	second, err := m.CreateForAccount("one")
	if err != nil {
		t.Fatal(err)
	}
	other, err := m.CreateForAccount("two")
	if err != nil {
		t.Fatal(err)
	}
	if _, exists := m.sessions[first]; exists {
		t.Fatal("bearer token stored in plaintext")
	}
	id, done, ok := m.AccountSession(first)
	if !ok || id != "one" {
		t.Fatal("session identity missing")
	}
	m.RevokeAccount("one", second)
	select {
	case <-done:
	default:
		t.Fatal("revocation signal not closed")
	}
	if m.Validate(first) || !m.Validate(second) || !m.Validate(other) {
		t.Fatal("unexpected sessions revoked")
	}
}
