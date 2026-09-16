package api

import (
	"encoding/json"
	"net/http"

	"tabelin/server/internal/auth"
)

// updateUser changes a user's display name, role, or active flag (admin only).
// Guards prevent an admin from locking everyone out: you cannot change your own
// role/active, and you cannot remove the last active admin.
func (a *API) updateUser(w http.ResponseWriter, r *http.Request) {
	me := auth.FromContext(r.Context())
	if me.Role != "admin" {
		writeErr(w, http.StatusForbidden, "admin only")
		return
	}
	id, ok := pathID(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	var body struct {
		DisplayName *string `json:"displayName"`
		Role        *string `json:"role"`
		Active      *bool   `json:"active"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "bad body")
		return
	}
	if id == me.ID && (body.Role != nil || body.Active != nil) {
		writeErr(w, http.StatusBadRequest, "cannot change your own role or active status")
		return
	}
	// Prevent removing the last active admin.
	if (body.Role != nil && *body.Role != "admin") || (body.Active != nil && !*body.Active) {
		if a.isAdmin(id) && a.activeAdmins() <= 1 {
			writeErr(w, http.StatusBadRequest, "at least one active admin is required")
			return
		}
	}
	if body.DisplayName != nil {
		a.DB.Exec(`UPDATE users SET display_name=? WHERE id=?`, *body.DisplayName, id)
	}
	if body.Role != nil {
		role := *body.Role
		if role == "admin" || role == "editor" || role == "viewer" {
			a.DB.Exec(`UPDATE users SET role=? WHERE id=?`, role, id)
		}
	}
	if body.Active != nil {
		v := 0
		if *body.Active {
			v = 1
		}
		a.DB.Exec(`UPDATE users SET active=? WHERE id=?`, v, id)
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// resetPin clears a user's PIN so they set a new one on their next sign-in.
func (a *API) resetPin(w http.ResponseWriter, r *http.Request) {
	if me := auth.FromContext(r.Context()); me.Role != "admin" {
		writeErr(w, http.StatusForbidden, "admin only")
		return
	}
	id, ok := pathID(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	if _, err := a.DB.Exec(`UPDATE users SET pin_hash='' WHERE id=?`, id); err != nil {
		writeErr(w, 500, "reset pin")
		return
	}
	// Sign the user out of any active sessions so the new PIN is required.
	a.DB.Exec(`DELETE FROM sessions WHERE username=(SELECT username FROM users WHERE id=?)`, id)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// deleteUser removes an account (admin only). Cannot delete yourself or the last
// active admin. Records they authored stay; only the login is removed.
func (a *API) deleteUser(w http.ResponseWriter, r *http.Request) {
	me := auth.FromContext(r.Context())
	if me.Role != "admin" {
		writeErr(w, http.StatusForbidden, "admin only")
		return
	}
	id, ok := pathID(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	if id == me.ID {
		writeErr(w, http.StatusBadRequest, "cannot delete your own account")
		return
	}
	if a.isAdmin(id) && a.activeAdmins() <= 1 {
		writeErr(w, http.StatusBadRequest, "at least one active admin is required")
		return
	}
	a.DB.Exec(`DELETE FROM sessions WHERE username=(SELECT username FROM users WHERE id=?)`, id)
	if _, err := a.DB.Exec(`DELETE FROM users WHERE id=?`, id); err != nil {
		writeErr(w, 500, "delete user")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *API) isAdmin(id int64) bool {
	var role string
	a.DB.QueryRow(`SELECT role FROM users WHERE id=?`, id).Scan(&role)
	return role == "admin"
}

func (a *API) activeAdmins() int {
	var n int
	a.DB.QueryRow(`SELECT COUNT(*) FROM users WHERE role='admin' AND active=1`).Scan(&n)
	return n
}
