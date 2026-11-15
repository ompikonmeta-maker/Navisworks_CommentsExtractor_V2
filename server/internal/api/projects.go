package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"

	"tabelin/server/internal/auth"
)

// Project > Review. Every signed-in user sees every project that is not
// restricted (and the restricted ones they are a member of — access.go); only
// admins create, rename or delete them. Deleted reviews sit in the Trash.

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

// listProjects returns the projects the caller may open, with their number
// of reviews (not counting the Trash) and whether access is restricted.
func (a *API) listProjects(w http.ResponseWriter, r *http.Request) {
	where, args := visibleProjectsSQL(auth.FromContext(r.Context()))
	rows, err := a.DB.Query(`
		SELECT p.id, p.name, p.created_at, p.restricted, COUNT(v.id)
		FROM projects p LEFT JOIN reviews v ON v.project_id = p.id AND v.deleted_at = ''
		WHERE `+where+`
		GROUP BY p.id ORDER BY p.id DESC`, args...)
	if err != nil {
		writeErr(w, 500, "query projects")
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, n int64
		var restricted int
		var name, created string
		if err := rows.Scan(&id, &name, &created, &restricted, &n); err != nil {
			writeErr(w, 500, "scan project")
			return
		}
		out = append(out, map[string]any{"id": id, "name": name, "createdAt": created, "reviews": n, "restricted": restricted == 1})
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
		FROM reviews v LEFT JOIN records c ON c.review_id = v.id AND c.deleted_at = ''
		WHERE v.project_id = ? AND v.deleted_at = '' GROUP BY v.id ORDER BY v.id DESC`, pid)
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

// deleteReview moves a review (with its comments) to the Trash (admin).
func (a *API) deleteReview(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	rid, ok := pathID(r, "rid")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad review id")
		return
	}
	res, err := a.DB.Exec(`UPDATE reviews SET deleted_at=?, deleted_by=? WHERE id=? AND deleted_at=''`,
		trashNow(), auth.FromContext(r.Context()).ID, rid)
	if err != nil {
		writeErr(w, 500, "delete review")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeErr(w, http.StatusNotFound, "review not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// deleteProject removes an empty project (admin). Reviews must be deleted —
// and emptied from the Trash — first, so a project's comments are never lost
// by one click.
func (a *API) deleteProject(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	pid, ok := pathID(r, "pid")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad project id")
		return
	}
	var live, trashed int
	a.DB.QueryRow(`SELECT COUNT(*) FROM reviews WHERE project_id=? AND deleted_at=''`, pid).Scan(&live)
	a.DB.QueryRow(`SELECT COUNT(*) FROM reviews WHERE project_id=? AND deleted_at!=''`, pid).Scan(&trashed)
	if live > 0 {
		writeErr(w, http.StatusConflict, "project still has reviews")
		return
	}
	if trashed > 0 {
		writeErr(w, http.StatusConflict, "project has reviews in the Trash — delete them for good first")
		return
	}
	a.removeTemplates(pid)
	if _, err := a.DB.Exec(`DELETE FROM projects WHERE id=?`, pid); err != nil {
		writeErr(w, 500, "delete project")
		return
	}
	a.DB.Exec(`DELETE FROM config WHERE scope=?`, projectScope(pid))
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// serverInfo tells an admin the addresses colleagues can open.
func (a *API) serverInfo(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	urls := []string{}
	if a.ServerURLs != nil {
		urls = append(urls, a.ServerURLs()...)
	}
	writeJSON(w, http.StatusOK, map[string]any{"urls": urls})
}
