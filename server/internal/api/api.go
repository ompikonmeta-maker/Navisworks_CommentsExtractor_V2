// Package api holds the JSON HTTP handlers for Tabelin V2.
package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"

	"tabelin/server/internal/auth"
)

// API bundles the dependencies the handlers need.
type API struct {
	DB       *sql.DB
	Version  string
	FilesDir string // where uploaded images/templates live on disk
	// ServerURLs lists the addresses colleagues can open (office network);
	// set by main, shown to admins when inviting the team.
	ServerURLs func() []string
}

// canWriteRole is the small-team access rule: any signed-in user may READ every
// review; admins and editors may WRITE (import, edit, upload, config); viewers
// are read-only.
func canWriteRole(u *auth.User) bool { return u.Role == "admin" || u.Role == "editor" }

// ResolveUser looks up an active, admin-provisioned user by normalized name.
// Wired into the auth middleware.
func (a *API) ResolveUser(username string) (*auth.User, error) {
	var u auth.User
	var active int
	err := a.DB.QueryRow(
		`SELECT id, username, display_name, role, active FROM users WHERE username = ?`,
		username,
	).Scan(&u.ID, &u.Username, &u.DisplayName, &u.Role, &active)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	u.Active = active == 1
	return &u, nil
}

// Routes returns the /api/* handler. Auth (except health) is applied by caller.
func (a *API) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", a.health)
	mux.HandleFunc("GET /api/me", a.me)
	// Project > Review (admins create both; everyone signed in can read)
	mux.HandleFunc("GET /api/projects", a.listProjects)
	mux.HandleFunc("POST /api/projects", a.createProject)        // admin
	mux.HandleFunc("PATCH /api/projects/{pid}", a.renameProject) // admin
	mux.HandleFunc("GET /api/projects/{pid}/reviews", a.listReviews)
	mux.HandleFunc("POST /api/projects/{pid}/reviews", a.createReview) // admin
	mux.HandleFunc("PATCH /api/reviews/{rid}", a.renameReview)
	mux.HandleFunc("DELETE /api/reviews/{rid}", a.deleteReview)   // admin
	mux.HandleFunc("DELETE /api/projects/{pid}", a.deleteProject) // admin, empty projects only
	mux.HandleFunc("GET /api/server-info", a.serverInfo)          // admin         // admin
	mux.HandleFunc("GET /api/users", a.listUsers)                 // admin
	mux.HandleFunc("POST /api/users", a.createUser)               // admin
	mux.HandleFunc("PATCH /api/users/{id}", a.updateUser)         // admin
	mux.HandleFunc("DELETE /api/users/{id}", a.deleteUser)        // admin
	mux.HandleFunc("POST /api/users/{id}/reset-pin", a.resetPin)  // admin
	// records + images
	mux.HandleFunc("GET /api/reviews/{rid}/records", a.listRecords)
	mux.HandleFunc("POST /api/reviews/{rid}/records", a.importRecords)
	mux.HandleFunc("PATCH /api/reviews/{rid}/records", a.bulkPatchRecords)
	mux.HandleFunc("PATCH /api/records/{id}", a.patchRecord)
	mux.HandleFunc("DELETE /api/records/{id}", a.deleteRecord)
	mux.HandleFunc("POST /api/records/{id}/images", a.uploadImage)
	mux.HandleFunc("DELETE /api/records/{id}/images", a.deleteImage)
	mux.HandleFunc("POST /api/reviews/{rid}/records/delete", a.bulkDeleteRecords)
	mux.HandleFunc("GET /api/files/{key}", a.getFile)
	// central configuration (settings, detection, statuses, template mapping, custom fields)
	mux.HandleFunc("GET /api/config", a.getGlobalConfig)
	mux.HandleFunc("PUT /api/config", a.putGlobalConfig)
	mux.HandleFunc("GET /api/projects/{pid}/config", a.getProjectConfig)
	mux.HandleFunc("PUT /api/projects/{pid}/config", a.putProjectConfig)
	mux.HandleFunc("GET /api/projects/{pid}/template", a.getTemplate)
	mux.HandleFunc("PUT /api/projects/{pid}/template", a.putTemplate)
	mux.HandleFunc("DELETE /api/projects/{pid}/template", a.deleteTemplate)
	mux.HandleFunc("GET /api/reviews/{rid}/config", a.getReviewConfig)
	mux.HandleFunc("PUT /api/reviews/{rid}/config", a.putReviewConfig)
	return mux
}

func (a *API) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "version": a.Version})
}

func (a *API) me(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, auth.FromContext(r.Context()))
}

func (a *API) listUsers(w http.ResponseWriter, r *http.Request) {
	if u := auth.FromContext(r.Context()); u.Role != "admin" {
		writeErr(w, http.StatusForbidden, "admin only")
		return
	}
	rows, err := a.DB.Query(`SELECT id, username, display_name, role, active, pin_hash != '' FROM users ORDER BY username`)
	if err != nil {
		writeErr(w, 500, "query users")
		return
	}
	defer rows.Close()
	// signedIn: the account has set its PIN, i.e. the person has signed in at
	// least once (shown when inviting the team).
	type listed struct {
		auth.User
		SignedIn bool `json:"signedIn"`
	}
	out := []listed{}
	for rows.Next() {
		var u listed
		var active, signed int
		if err := rows.Scan(&u.ID, &u.Username, &u.DisplayName, &u.Role, &active, &signed); err != nil {
			writeErr(w, 500, "scan user")
			return
		}
		u.Active = active == 1
		u.SignedIn = signed == 1
		out = append(out, u)
	}
	writeJSON(w, http.StatusOK, out)
}

// createUser provisions an account (admin only). username is an AD account.
func (a *API) createUser(w http.ResponseWriter, r *http.Request) {
	if u := auth.FromContext(r.Context()); u.Role != "admin" {
		writeErr(w, http.StatusForbidden, "admin only")
		return
	}
	var body struct {
		Username    string `json:"username"`
		DisplayName string `json:"displayName"`
		Role        string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "bad body")
		return
	}
	username := auth.Normalize(body.Username)
	if username == "" {
		writeErr(w, http.StatusBadRequest, "username required")
		return
	}
	role := body.Role
	if role != "admin" && role != "editor" && role != "viewer" {
		role = "viewer"
	}
	_, err := a.DB.Exec(`INSERT INTO users(username, display_name, role) VALUES(?, ?, ?)`, username, body.DisplayName, role)
	if err != nil {
		writeErr(w, http.StatusConflict, "user exists or invalid")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"username": username, "role": role})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}
