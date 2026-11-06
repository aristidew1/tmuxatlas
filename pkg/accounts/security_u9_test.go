package accounts

import (
	"golang.org/x/crypto/bcrypt"
	"strings"
	"testing"
)

func TestLegacyBcryptRejectsLongPassword(t *testing.T) {
	prefix := strings.Repeat("A", 72)
	raw, err := bcrypt.GenerateFromPassword([]byte(prefix), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	if !VerifyPassword(string(raw), prefix) || VerifyPassword(string(raw), prefix+"suffix") {
		t.Fatal("legacy password verification")
	}
	long := prefix + "suffix"
	hash, err := HashPassword(long)
	if err != nil || !VerifyPassword(hash, long) || VerifyPassword(hash, prefix+"different") {
		t.Fatal("long password verification", err)
	}
}
