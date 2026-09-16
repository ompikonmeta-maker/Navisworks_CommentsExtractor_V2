package api

import (
	"encoding/json"
	"net/http"
	"strconv"

	"tabelin/server/internal/auth"
)

// Config is stored as key -> arbitrary JSON, under a scope ("global" or
// "project:<id>"). It holds what V1 kept in the browser: appearance, labels,
// detection rules, statuses, custom-field definitions, and the template mapping.
// Global config is app-wide defaults (admin-managed); project config overrides
// per review.

// getGlobalConfig returns every global config entry. Any signed-in user may read
// defaults so the app can render.
func (a *API) getGlobalConfig(w http.ResponseWriter, r *http.Request) {
	a.writeConfigMap(w, "global")
}

// putGlobalConfig sets one global config entry (admin only).
func (a *API) putGlobalConfig(w http.ResponseWriter, r *http.Request) {
	if u := auth.FromContext(r.Context()); u.Role != "admin" {
		writeErr(w, http.StatusForbidden, "admin only")
		return
	}
	a.putConfig(w, r, "global")
}

// getProjectConfig returns every config entry for a project (members only).
func (a *API) getProjectConfig(w http.ResponseWriter, r *http.Request) {
	u := auth.FromContext(r.Context())
	pid, ok := pathID(r, "pid")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad project id")
		return
	}
	if _, member, err := a.memberRole(u, pid); err != nil || !member {
		writeErr(w, http.StatusForbidden, "no access to project")
		return
	}
	a.writeConfigMap(w, projectScope(pid))
}

// putProjectConfig sets one config entry for a project (owners/editors only).
func (a *API) putProjectConfig(w http.ResponseWriter, r *http.Request) {
	u := auth.FromContext(r.Context())
	pid, ok := pathID(r, "pid")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad project id")
		return
	}
	role, member, err := a.memberRole(u, pid)
	if err != nil || !member || !canWrite(role) {
		writeErr(w, http.StatusForbidden, "cannot write project config")
		return
	}
	a.putConfig(w, r, projectScope(pid))
}

func projectScope(pid int64) string {
	return "project:" + strconv.FormatInt(pid, 10)
}

func (a *API) writeConfigMap(w http.ResponseWriter, scope string) {
	rows, err := a.DB.Query(`SELECT key, json FROM config WHERE scope=?`, scope)
	if err != nil {
		writeErr(w, 500, "query config")
		return
	}
	defer rows.Close()
	out := map[string]json.RawMessage{}
	for rows.Next() {
		var k, j string
		if rows.Scan(&k, &j) == nil {
			if j == "" {
				j = "{}"
			}
			out[k] = json.RawMessage(j)
		}
	}
	writeJSON(w, http.StatusOK, out)
}

// putConfig upserts one { key, json } entry under a scope. json is any JSON value.
func (a *API) putConfig(w http.ResponseWriter, r *http.Request, scope string) {
	var body struct {
		Key  string          `json:"key"`
		JSON json.RawMessage `json:"json"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Key == "" {
		writeErr(w, http.StatusBadRequest, "key and json required")
		return
	}
	val := string(body.JSON)
	if val == "" {
		val = "{}"
	}
	_, err := a.DB.Exec(`
		INSERT INTO config(scope, key, json) VALUES(?,?,?)
		ON CONFLICT(scope, key) DO UPDATE SET json=excluded.json`, scope, body.Key, val)
	if err != nil {
		writeErr(w, 500, "save config")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

