package api

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"tabelin/server/internal/auth"
)

// Per-project access (Phase 5). A project is open to every signed-in user
// unless an admin restricts it; then only admins and its members may open it.
// Nothing changes for an existing install: every project starts unrestricted.
//
// The guards below sit in front of every route that names a project, review,
// record or file, so a hidden project answers 404 everywhere — as if it did
// not exist. They also hide what is in the Trash (deleted reviews and records).

// canOpenProject: admins always; others if the project is unrestricted or they
// are a member.
func (a *API) canOpenProject(u *auth.User, pid int64) bool {
	var restricted int
	if err := a.DB.QueryRow(`SELECT restricted FROM projects WHERE id=?`, pid).Scan(&restricted); err != nil {
		return false
	}
	if isAdminRole(u) || restricted == 0 {
		return true
	}
	var n int
	a.DB.QueryRow(`SELECT COUNT(*) FROM project_members WHERE project_id=? AND user_id=?`, pid, u.ID).Scan(&n)
	return n > 0
}

// visibleProjectsSQL is a WHERE fragment (on projects p) for the projects u may open.
func visibleProjectsSQL(u *auth.User) (string, []any) {
	if isAdminRole(u) {
		return `1=1`, nil
	}
	return `(p.restricted = 0 OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = ?))`, []any{u.ID}
}

// projectOfReview → the project of a review that is not in the Trash.
func (a *API) projectOfReview(rid int64) (int64, bool) {
	var pid sql.NullInt64
	err := a.DB.QueryRow(`SELECT project_id FROM reviews WHERE id=? AND deleted_at=''`, rid).Scan(&pid)
	return pid.Int64, err == nil && pid.Valid
}

// projectOfRecord → the project of a record (record and review not in the Trash).
func (a *API) projectOfRecord(id int64) (int64, bool) {
	var pid sql.NullInt64
	err := a.DB.QueryRow(`SELECT v.project_id FROM records r JOIN reviews v ON v.id = r.review_id
		WHERE r.id=? AND r.deleted_at='' AND v.deleted_at=''`, id).Scan(&pid)
	return pid.Int64, err == nil && pid.Valid
}

// projectOfFile → the project a stored photo belongs to.
func (a *API) projectOfFile(key string) (int64, bool) {
	var pid sql.NullInt64
	err := a.DB.QueryRow(`SELECT v.project_id FROM images i JOIN records r ON r.id = i.record_id JOIN reviews v ON v.id = r.review_id
		WHERE i.file_key=? AND r.deleted_at='' AND v.deleted_at=''`, key).Scan(&pid)
	return pid.Int64, err == nil && pid.Valid
}

type scope int

const (
	byProject scope = iota // {pid}
	byReview               // {rid}
	byRecord               // {id} of a record
	byFile                 // {key} of a photo
)

// guard wraps a handler: it resolves the project from the path and answers
// 404 when the caller may not open it (or the thing is in the Trash).
func (a *API) guard(s scope, h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u := auth.FromContext(r.Context())
		var pid int64
		ok := false
		switch s {
		case byProject:
			pid, ok = pathID(r, "pid")
		case byReview:
			if rid, good := pathID(r, "rid"); good {
				pid, ok = a.projectOfReview(rid)
			}
		case byRecord:
			if id, good := pathID(r, "id"); good {
				pid, ok = a.projectOfRecord(id)
			}
		case byFile:
			pid, ok = a.projectOfFile(r.PathValue("key"))
		}
		if !ok || !a.canOpenProject(u, pid) {
			writeErr(w, http.StatusNotFound, "not found")
			return
		}
		h(w, r)
	}
}

// getProjectAccess → {"restricted": bool, "members": [user ids]} (admin).
func (a *API) getProjectAccess(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	pid, ok := pathID(r, "pid")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad project id")
		return
	}
	var restricted int
	if err := a.DB.QueryRow(`SELECT restricted FROM projects WHERE id=?`, pid).Scan(&restricted); err != nil {
		writeErr(w, http.StatusNotFound, "project not found")
		return
	}
	members := []int64{}
	rows, err := a.DB.Query(`SELECT user_id FROM project_members WHERE project_id=? ORDER BY user_id`, pid)
	if err == nil {
		for rows.Next() {
			var id int64
			if rows.Scan(&id) == nil {
				members = append(members, id)
			}
		}
		rows.Close()
	}
	writeJSON(w, http.StatusOK, map[string]any{"restricted": restricted == 1, "members": members})
}

// putProjectAccess sets who may open a project (admin). Body like the GET answer.
func (a *API) putProjectAccess(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	pid, ok := pathID(r, "pid")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad project id")
		return
	}
	var body struct {
		Restricted bool    `json:"restricted"`
		Members    []int64 `json:"members"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "bad body")
		return
	}
	tx, err := a.DB.Begin()
	if err != nil {
		writeErr(w, 500, "begin")
		return
	}
	defer tx.Rollback()
	restricted := 0
	if body.Restricted {
		restricted = 1
	}
	res, err := tx.Exec(`UPDATE projects SET restricted=? WHERE id=?`, restricted, pid)
	if err != nil {
		writeErr(w, 500, "update project")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeErr(w, http.StatusNotFound, "project not found")
		return
	}
	tx.Exec(`DELETE FROM project_members WHERE project_id=?`, pid)
	for _, uid := range body.Members {
		tx.Exec(`INSERT OR IGNORE INTO project_members(project_id, user_id) SELECT ?, id FROM users WHERE id=?`, pid, uid)
	}
	if err := tx.Commit(); err != nil {
		writeErr(w, 500, "commit")
		return
	}
	a.getProjectAccess(w, r)
}
