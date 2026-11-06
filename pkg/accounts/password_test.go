package accounts

import (
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func TestPasswordHashLongUnicodeAndImportedBcrypt(t *testing.T) {
	for _, password := range []string{"a sufficiently long password", strings.Repeat("é", 200)} {
		hash, err := HashPassword(password)
		if err != nil {
			t.Fatal(err)
		}
		if cost, err := bcrypt.Cost([]byte(hash)); err != nil || cost != 12 {
			t.Fatalf("bcrypt cost = %d, error = %v", cost, err)
		}
		if !VerifyPassword(hash, password) || VerifyPassword(hash, password+"x") {
			t.Fatal("password verification failed")
		}
	}
	hash, err := bcrypt.GenerateFromPassword([]byte("imported password"), bcrypt.MinCost)
	if err != nil || !VerifyPassword(string(hash), "imported password") {
		t.Fatal("imported bcrypt hash was rejected")
	}
	for _, invalid := range []string{"short", strings.Repeat("x", 201), "0123456789\xff"} {
		if _, err := HashPassword(invalid); err == nil {
			t.Fatal("invalid password accepted")
		}
	}
}
