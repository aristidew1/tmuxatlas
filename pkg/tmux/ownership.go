package tmux

import (
	"errors"
	"regexp"
	"strings"

	"github.com/LosFurina/tmuxatlas/pkg/accounts"
)

var ErrAlreadyOwned = errors.New("session déjà attribuée")
var ErrNotOwner = errors.New("propriétaire différent")
var ownerPattern = regexp.MustCompile(`^[a-zA-Z0-9._-]{1,128}$`)

// ChangeOwner performs the check and change within one tmux command queue.
// expected is empty for a claim, or the current owner for a release. force
// bypasses the owner check for administrative assignments.
func (c *Client) ChangeOwner(session, expected, owner string, force bool, names ...string) error {
	if session == "" || session == "tmuxatlas-ctrl" || (owner != "" && !ownerPattern.MatchString(owner)) || (expected != "" && !ownerPattern.MatchString(expected)) {
		return errors.New("cible ou propriétaire invalide")
	}
	name := owner
	if len(names) > 0 {
		name = names[0]
	}
	if owner != "" && !accounts.ValidUsername(name) {
		return errors.New("nom de propriétaire invalide")
	}
	sessions, err := c.ListSessions()
	if err != nil {
		return err
	}
	id := ""
	for _, s := range sessions {
		if s.Name == session {
			id = s.ID
			break
		}
	}
	if id == "" {
		return errors.New("session introuvable")
	}
	// IDs and owner values are constrained to tmux-safe characters.
	command := "set-option -t " + id + " @atlas-owner " + owner + " ; set-option -t " + id + " @atlas-owner-name " + name
	if owner == "" {
		command = "set-option -u -t " + id + " @atlas-owner ; set-option -u -t " + id + " @atlas-owner-name"
	}
	condition := "#{==:#{@atlas-owner}," + expected + "}"
	if force {
		condition = "1"
	}
	out, err := c.Exec("if-shell", "-F", "-t", id, condition, command, "display-message -p ATLAS_OWNER_CONFLICT")
	if err != nil {
		return err
	}
	if strings.Contains(out, "ATLAS_OWNER_CONFLICT") {
		if expected == "" {
			return ErrAlreadyOwned
		}
		return ErrNotOwner
	}
	return nil
}

// NewOwnedSession creates and assigns the session in one tmux command queue.
func (c *Client) NewOwnedSession(name, dir, owner string, names ...string) error {
	ownerName := owner
	if len(names) > 0 {
		ownerName = names[0]
	}
	if err := ValidateSessionName(name); err != nil {
		return err
	}
	if !ownerPattern.MatchString(owner) || !accounts.ValidUsername(ownerName) {
		return errors.New("cible ou propriétaire invalide")
	}
	args := []string{"new-session", "-d", "-s", name}
	if dir != "" {
		args = append(args, "-c", dir)
	}
	args = append(args, ";", "set-option", "-t", ExactWindow(name, ""), "@atlas-owner", owner, ";", "set-option", "-t", ExactWindow(name, ""), "@atlas-owner-name", ownerName)
	_, err := c.Exec(args...)
	return err
}
