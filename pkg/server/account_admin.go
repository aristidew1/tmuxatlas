package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/LosFurina/tmuxatlas/pkg/accounts"
	"github.com/LosFurina/tmuxatlas/pkg/auth"
	"github.com/LosFurina/tmuxatlas/pkg/peer"
	"github.com/LosFurina/tmuxatlas/pkg/tmux"
	"github.com/go-chi/chi/v5"
)

type accountView struct {
	ID                string    `json:"id"`
	Username          string    `json:"username"`
	Role              string    `json:"role"`
	Disabled          bool      `json:"disabled"`
	CreatedAt         time.Time `json:"created_at"`
	PasswordChangedAt time.Time `json:"password_changed_at"`
}

func viewAccount(user accounts.User) accountView {
	return accountView{user.ID, user.Username, user.Role, user.Disabled, user.CreatedAt, user.PasswordChangedAt}
}

func writeAccountError(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	switch {
	case errors.Is(err, accounts.ErrNotFound):
		status = http.StatusNotFound
	case errors.Is(err, accounts.ErrProtectedAdmin), errors.Is(err, accounts.ErrDuplicateUsername):
		status = http.StatusConflict
	case errors.Is(err, accounts.ErrInvalidUsername), errors.Is(err, accounts.ErrInvalidPassword):
		status = http.StatusBadRequest
	}
	message := "erreur interne"
	if status != http.StatusInternalServerError {
		message = err.Error()
	}
	http.Error(w, message, status)
}

func handleAdminUsers(w http.ResponseWriter, r *http.Request, opts *Options) {
	if r.Method == http.MethodGet {
		users, err := opts.AccountsAuth.Store.List()
		if err != nil {
			writeAccountError(w, err)
			return
		}
		views := make([]accountView, 0, len(users))
		for _, user := range users {
			views = append(views, viewAccount(user))
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"users": views})
		return
	}
	var request struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if json.NewDecoder(r.Body).Decode(&request) != nil {
		http.Error(w, "requête invalide", http.StatusBadRequest)
		return
	}
	hash, err := accounts.HashPassword(request.Password)
	if err != nil {
		writeAccountError(w, err)
		return
	}
	user, err := opts.AccountsAuth.Store.Create(request.Username, hash, "user")
	if err != nil {
		writeAccountError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(viewAccount(user))
}

func handleAdminUserUpdate(w http.ResponseWriter, r *http.Request, opts *Options) {
	identity, _ := auth.AccountFromContext(r.Context())
	var request struct {
		Password *string `json:"password"`
		Disabled *bool   `json:"disabled"`
	}
	if json.NewDecoder(r.Body).Decode(&request) != nil || (request.Password == nil && request.Disabled == nil) {
		http.Error(w, "requête invalide", http.StatusBadRequest)
		return
	}
	hash := ""
	if request.Password != nil {
		var err error
		hash, err = accounts.HashPassword(*request.Password)
		if err != nil {
			writeAccountError(w, err)
			return
		}
	}
	user, err := opts.AccountsAuth.UpdateAccount(chi.URLParam(r, "id"), identity.User.ID, hash, request.Disabled)
	if err != nil {
		writeAccountError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(viewAccount(user))
}

func handleAdminUserDelete(w http.ResponseWriter, r *http.Request, opts *Options, router runtimeActionExecutor) {
	identity, _ := auth.AccountFromContext(r.Context())
	id := chi.URLParam(r, "id")
	err := opts.AccountsAuth.DeleteAccountWith(id, identity.User.ID, func() error {
		if router == nil || opts.PeerMgr == nil {
			return errors.New("routeur de sessions indisponible")
		}
		for _, host := range opts.PeerMgr.StateHostSnapshots() {
			if !host.Online {
				return errors.New("un hôte est hors ligne")
			}
			sessions := host.Sessions
			if host.Local && opts.Client != nil {
				var err error
				sessions, err = opts.Client.ListSessions()
				if err != nil {
					return err
				}
			}
			for _, session := range sessions {
				if session == nil || string(session.Owner) != id {
					continue
				}
				payload, _ := json.Marshal(map[string]string{"owner": id, "owner_name": ""})
				if _, err := router.Execute(r.Context(), "release", peer.SessionTarget{HostID: host.ID, Session: session.Name}, payload); err != nil {
					return err
				}
				if !host.Local {
					opts.PeerMgr.UpdateKnownOwner(host.ID, session.Name, "")
				}
				refreshLocalSessionState(opts, host.ID)
			}
		}
		if opts.StateCoordinator != nil {
			if _, err := opts.StateCoordinator.ReplaceHosts(r.Context(), opts.PeerMgr.StateHostSnapshots()); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		writeAccountError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func accountAdminOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		identity, ok := auth.AccountFromContext(r.Context())
		if !ok || identity.User.Role != "admin" {
			http.Error(w, "accès interdit", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func handleAccountOwnership(w http.ResponseWriter, r *http.Request, opts *Options, router runtimeActionExecutor, policy *accountPolicy, operation string) {
	identity, ok := auth.AccountFromContext(r.Context())
	if !ok || router == nil {
		http.Error(w, "authentification requise", http.StatusUnauthorized)
		return
	}
	var request struct {
		HostID  string `json:"host_id"`
		Session string `json:"session"`
		Owner   string `json:"owner"`
	}
	if json.NewDecoder(r.Body).Decode(&request) != nil || request.HostID == "" || request.Session == "" {
		http.Error(w, "requête invalide", http.StatusBadRequest)
		return
	}
	owner := identity.User.ID
	ownerName := identity.User.Username
	// Any account may reassign or release any session. Only a plain claim, with
	// no explicit owner, is limited to a free session.
	force := identity.User.Role == "admin" || operation == "release" || request.Owner != ""
	if request.Owner != "" {
		owner = request.Owner
		if operation == "claim" {
			users, err := opts.AccountsAuth.Store.List()
			if err != nil {
				writeAccountError(w, err)
				return
			}
			found := false
			for _, user := range users {
				if user.ID == owner && !user.Disabled {
					found = true
					ownerName = user.Username
				}
			}
			if !found {
				writeAccountError(w, accounts.ErrNotFound)
				return
			}
		}
	}
	payload, _ := json.Marshal(map[string]any{"owner": owner, "owner_name": ownerName, "force": force})
	result, err := router.Execute(r.Context(), operation, peer.SessionTarget{HostID: request.HostID, Session: request.Session}, payload)
	if err != nil {
		writeRuntimeError(w, err)
		return
	}
	if opts.PeerMgr != nil && !opts.PeerMgr.IsLocal(request.HostID) {
		if operation == "release" {
			owner = ""
		}
		opts.PeerMgr.UpdateKnownOwner(request.HostID, request.Session, tmux.Owner(owner))
		if opts.StateCoordinator != nil {
			if _, err := opts.StateCoordinator.ReplaceHosts(r.Context(), opts.PeerMgr.StateHostSnapshots()); err != nil {
				http.Error(w, "état indisponible", http.StatusServiceUnavailable)
				return
			}
		}
	}
	refreshLocalSessionState(opts, request.HostID)
	writeActionResponse(w, result)
}

// handleAccountDirectory lists the active accounts a session can be given to.
// It exposes names only: no role, date, hash or disabled account.
func handleAccountDirectory(w http.ResponseWriter, opts *Options) {
	users, err := opts.AccountsAuth.Store.List()
	if err != nil {
		writeAccountError(w, err)
		return
	}
	type entry struct {
		ID       string `json:"id"`
		Username string `json:"username"`
	}
	directory := make([]entry, 0, len(users))
	for _, user := range users {
		if !user.Disabled {
			directory = append(directory, entry{ID: user.ID, Username: user.Username})
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(directory)
}
