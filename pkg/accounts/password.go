package accounts

import (
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"unicode/utf8"

	"golang.org/x/crypto/bcrypt"
)

var ErrInvalidPassword = errors.New("le mot de passe doit contenir entre 10 et 200 caractères")

// HashPassword accepts long Unicode passwords despite bcrypt's 72-byte limit.
// Long inputs are first reduced with SHA-256; short inputs remain compatible
// with standard bcrypt hashes imported during bootstrap.
func HashPassword(password string) (string, error) {
	if !utf8.ValidString(password) || utf8.RuneCountInString(password) < 10 || utf8.RuneCountInString(password) > 200 {
		return "", ErrInvalidPassword
	}
	hash, err := bcrypt.GenerateFromPassword(passwordInput(password), 12)
	return string(hash), err
}

func passwordInput(password string) []byte {
	if len(password) <= 72 {
		return []byte(password)
	}
	sum := sha256.Sum256([]byte(password))
	return []byte(base64.StdEncoding.EncodeToString(sum[:]))
}

func VerifyPassword(hash, password string) bool {
	if bcrypt.CompareHashAndPassword([]byte(hash), passwordInput(password)) == nil {
		return true
	}
	return false
}

// RehashPassword upgrades an already verified imported password.
func RehashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword(passwordInput(password), 12)
	return string(hash), err
}
