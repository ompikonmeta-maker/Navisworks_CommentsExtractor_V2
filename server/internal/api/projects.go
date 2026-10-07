package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"

	"tabelin/server/internal/auth"
)

// Project > Review. Every signed-in user can see all projects and reviews (the
// small-team model); only admins create or rename them.

func requireAdmin(w http.ResponseWriter, r *http.Request) bool {
	if auth.FromContext(r.Context()).Role != "admin" {
		writeErr(w, http.StatusForbidden, "admin only")
		return false
	}
	return true
}

func decodeName(w http.ResponseWriter, r *http.Request) (string, bool) {
	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Name) == "" {
		writeErr(w, http.StatusBadRequest, "name required")
		return "", false
	}
	return strings.TrimSpace(body.Name), true
}

// listProjects returns every project with its number of reviews.
func (a *API) listProjects(w http.ResponseWriter, r *http.Request) {
	rows, err := a.DB.Query(`
		SELECT p.id, p.name, p.created_at, COUNT(v.id)
		FROM projects p LEFT JOIN reviews v ON v.project_id = p.id
		GROUP BY p.id ORDER BY p.id DESC`)
	if err != nil {
		writeErr(w, 500, "query projects")
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, n int64
		var name, created string
		if err := rows.Scan(&id, &name, &created, &n); err != nil {
			writeErr(w, 500, "scan project")
			return
		}
		out = append(out, map[string]any{"id": id, "name": name, "createdAt": created, "reviews": n})
	}
	writeJSON(w, http.StatusOK, out)
}

func (a *API) createProject(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	name, ok := decodeName(w, r)
	if !ok {
		return
	}
	res, err := a.DB.Exec(`INSERT INTO projects(name, created_by) VALUES(?, ?)`, name, auth.FromContext(r.Context()).ID)
	if err != nil {
		writeErr(w, 500, "insert project")
		return
	}
	id, _ := res.LastInsertId()
	writeJSON(w, http.StatusCreated, map[string]any{"id": id, "name": name, "reviews": 0})
}

func (a *API) renameProject(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	pid, ok := pathID(r, "pid")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad project id")
		return
	}
	name, ok := decodeName(w, r)
	if !ok {
		return
	}
	if res, err := a.DB.Exec(`UPDATE projects SET name=? WHERE id=?`, name, pid); err != nil {
		writeErr(w, 500, "rename project")
		return
	} else if n, _ := res.RowsAffected(); n == 0 {
		writeErr(w, http.StatusNotFound, "project not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": pid, "name": name})
}

// listReviews returns a project's reviews with their comment counts.
func (a *API) listReviews(w http.ResponseWriter, r *http.Request) {
	pid, ok := pathID(r, "pid")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad project id")
		return
	}
	var pname string
	if err := a.DB.QueryRow(`SELECT name FROM projects WHERE id=?`, pid).Scan(&pname); err == sql.ErrNoRows {
		writeErr(w, http.StatusNotFound, "project not found")
		return
	}
	rows, err := a.DB.Query(`
		SELECT v.id, v.name, v.created_at, COUNT(c.id)
		FROM reviews v LEFT JOIN records c ON c.review_id = v.id
		WHERE v.project_id = ? GROUP BY v.id ORDER BY v.id DESC`, pid)
	if err != nil {
		writeErr(w, 500, "query reviews")
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, n int64
		var name, created string
		if err := rows.Scan(&id, &name, &created, &n); err != nil {
			writeErr(w, 500, "scan review")
			return
		}
		out = append(out, map[string]any{"id": id, "projectId": pid, "name": name, "createdAt": created, "comments": n})
	}
	writeJSON(w, http.StatusOK, out)
}

func (a *API) createReview(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	pid, ok := pathID(r, "pid")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad project id")
		return
	}
	name, ok := decodeName(w, r)
	if !ok {
		return
	}
	res, err := a.DB.Exec(`INSERT INTO reviews(project_id, name, created_by) SELECT id, ?, ? FROM projects WHERE id=?`,
		name, auth.FromContext(r.Context()).ID, pid)
	if err != nil {
		writeErr(w, 500, "insert review")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeErr(w, http.StatusNotFound, "project not found")
		return
	}
	id, _ := res.LastInsertId()
	writeJSON(w, http.StatusCreated, map[string]any{"id": id, "projectId": pid, "name": name, "comments": 0})
}

func (a *API) renameReview(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	rid, ok := pathID(r, "rid")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad review id")
		return
	}
	name, ok := decodeName(w, r)
	if !ok {
		return
	}
	if res, err := a.DB.Exec(`UPDATE reviews SET name=? WHERE id=?`, name, rid); err != nil {
		writeErr(w, 500, "rename review")
		return
	} else if n, _ := res.RowsAffected(); n == 0 {
		writeErr(w, http.StatusNotFound, "review not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": rid, "name": name})
}
