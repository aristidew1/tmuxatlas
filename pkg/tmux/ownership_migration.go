package tmux

import (
	"errors"
	"os"
	"path/filepath"

	"golang.org/x/sys/unix"
)

// MigrateOwners assigns existing local sessions to the administrator once.
// The marker is written only after every assignment succeeds.
func MigrateOwners(client *Client, marker, admin string, names ...string) error {
	if client == nil || !ownerPattern.MatchString(admin) {
		return errors.New("administrateur ou client invalide")
	}
	if err := os.MkdirAll(filepath.Dir(marker), 0700); err != nil {
		return err
	}
	lock, err := os.OpenFile(marker+".lock", os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	defer lock.Close()
	if err := unix.Flock(int(lock.Fd()), unix.LOCK_EX); err != nil {
		return err
	}
	defer unix.Flock(int(lock.Fd()), unix.LOCK_UN)
	if _, err := os.Stat(marker); err == nil {
		return nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	sessions, err := client.ListSessions()
	if err != nil {
		return err
	}
	for _, session := range sessions {
		if err := client.ChangeOwner(session.Name, "", admin, true, names...); err != nil {
			return err
		}
	}
	f, err := os.CreateTemp(filepath.Dir(marker), ".migration-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if err := f.Chmod(0600); err != nil {
		f.Close()
		return err
	}
	if _, err := f.WriteString("1\n"); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if err := os.Rename(f.Name(), marker); err != nil {
		return err
	}
	dir, err := os.Open(filepath.Dir(marker))
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}
