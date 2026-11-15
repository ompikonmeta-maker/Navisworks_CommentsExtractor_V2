package api

import (
	"encoding/json"
	"net/http"
	"time"

	"tabelin/server/internal/auth"
)

// Trash (Phase 5). Deleting a comment or a review only marks it
// (deleted_at/deleted_by): it disappears from every list and route (see the
// guards in access.go) but an admin can restore it for TrashDays days. After
// that — or when an admin deletes it for good — the rows and photo files go.
// A comment of a deleted review comes back with its review.

// TrashDays is how long deleted things can be restored.
const TrashDays = 30

func trashNow() string { return clock().UTC().Format(time.RFC3339) }

// trashRecords marks records of a review as deleted. Returns how many.
func (a *API) trashRecords(rid int64, ids []int64, userID int64) int {
	n := 0
	now := trashNow()
	for _, id := range ids {
		res, err := a.DB.Exec(`UPDATE records SET deleted_at=?, deleted_by=?, modified_at=? WHERE id=? AND review_id=? AND deleted_at=''`,
			now, userID, modNow(), id, rid)
		if err == nil {
			if c, _ := res.RowsAffected(); c > 0 {
				n++
				logEvent(a.exec, id, userID, "delete", map[string]any{})
			}
		}
	}
	return n
}

// purgeRecords deletes records for good, with their photo files.
func (a *API) purgeRecords(where string, args ...any) int {
	a.unlinkFilesWhere(where, args...)
	res, err := a.DB.Exec(`DELETE FROM records AS r WHERE `+where, args...)
	if err != nil {
		return 0
	}
	n, _ := res.RowsAffected()
	return int(n)
}

// purgeReview deletes a review for good: its records, photos and settings.
func (a *API) purgeReview(rid int64) bool {
	a.unlinkFilesWhere(`r.review_id=?`, rid)
	res, err := a.DB.Exec(`DELETE FROM reviews WHERE id=?`, rid)
	if err != nil {
		return false
	}
	a.DB.Exec(`DELETE FROM config WHERE scope=?`, reviewScope(rid))
	n, _ := res.RowsAffected()
	return n > 0
}

// PurgeExpired removes what has been in the Trash longer than TrashDays.
// Called at startup and whenever the Trash is listed.
func (a *API) PurgeExpired() {
	cutoff := clock().UTC().Add(-TrashDays * 24 * time.Hour).Format(time.RFC3339)
	rows, err := a.DB.Query(`SELECT id FROM reviews WHERE deleted_at != '' AND deleted_at < ?`, cutoff)
	if err == nil {
		var old []int64
		for rows.Next() {
			var id int64
			if rows.Scan(&id) == nil {
				old = append(old, id)
			}
		}
		rows.Close()
		for _, id := range old {
			a.purgeReview(id)
		}
	}
	a.purgeRecords(`r.deleted_at != '' AND r.deleted_at < ?`, cutoff)
}

type trashedReview struct {
	ID          int64  `json:"id"`
	Name        string `json:"name"`
	ProjectID   int64  `json:"projectId"`
	ProjectName string `json:"projectName"`
	Comments    int    `json:"comments"`
	DeletedAt   string `json:"deletedAt"`
	DeletedBy   string `json:"deletedBy"`
	PurgeAt     string `json:"purgeAt"`
}

type trashedRecord struct {
	ID          int64  `json:"id"`
	ReviewID    int64  `json:"reviewId"`
	ReviewName  string `json:"reviewName"`
	ProjectName string `json:"projectName"`
	Viewpoint   string `json:"viewpoint"`
	CommentText string `json:"commentText"`
	Status      string `json:"status"`
	DeletedAt   string `json:"deletedAt"`
	DeletedBy   string `json:"deletedBy"`
	PurgeAt     string `json:"purgeAt"`
}

func purgeAt(deletedAt string) string {
	t, err := time.Parse(time.RFC3339, deletedAt)
	if err != nil {
		return ""
	}
	return t.Add(TrashDays * 24 * time.Hour).Format(time.RFC3339)
}

// listTrash → {"reviews": [...], "records": [...], "days": TrashDays}, newest first (admin).
func (a *API) listTrash(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	a.PurgeExpired()
	reviews := []trashedReview{}
	rows, err := a.DB.Query(`
		SELECT v.id, v.name, COALESCE(p.id, 0), COALESCE(p.name, ''), v.deleted_at,
		       COALESCE(NULLIF(u.display_name, ''), u.username, ''),
		       (SELECT COUNT(*) FROM records c WHERE c.review_id = v.id AND c.deleted_at = '')
		FROM reviews v LEFT JOIN projects p ON p.id = v.project_id LEFT JOIN users u ON u.id = v.deleted_by
		WHERE v.deleted_at != '' ORDER BY v.deleted_at DESC, v.id DESC`)
	if err != nil {
		writeErr(w, 500, "query trash")
		return
	}
	for rows.Next() {
		var t trashedReview
		if rows.Scan(&t.ID, &t.Name, &t.ProjectID, &t.ProjectName, &t.DeletedAt, &t.DeletedBy, &t.Comments) == nil {
			t.PurgeAt = purgeAt(t.DeletedAt)
			reviews = append(reviews, t)
		}
	}
	rows.Close()
	records := []trashedRecord{}
	rows, err = a.DB.Query(`
		SELECT r.id, r.review_id, v.name, COALESCE(p.name, ''), COALESCE(r.viewpoint, ''), COALESCE(r.comment_text, ''),
		       COALESCE(r.status, ''), r.deleted_at, COALESCE(NULLIF(u.display_name, ''), u.username, '')
		FROM records r JOIN reviews v ON v.id = r.review_id LEFT JOIN projects p ON p.id = v.project_id
		LEFT JOIN users u ON u.id = r.deleted_by
		WHERE r.deleted_at != '' AND v.deleted_at = '' ORDER BY r.deleted_at DESC, r.id DESC`)
	if err != nil {
		writeErr(w, 500, "query trash")
		return
	}
	for rows.Next() {
		var t trashedRecord
		if rows.Scan(&t.ID, &t.ReviewID, &t.ReviewName, &t.ProjectName, &t.Viewpoint, &t.CommentText, &t.Status, &t.DeletedAt, &t.DeletedBy) == nil {
			t.PurgeAt = purgeAt(t.DeletedAt)
			records = append(records, t)
		}
	}
	rows.Close()
	writeJSON(w, http.StatusOK, map[string]any{"reviews": reviews, "records": records, "days": TrashDays})
}

type trashPick struct {
	Reviews []int64 `json:"reviews"`
	Records []int64 `json:"records"`
}

// restoreTrash puts reviews and comments back (admin). A comment of a review
// that is still in the Trash is skipped (restore the review instead).
func (a *API) restoreTrash(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	u := auth.FromContext(r.Context())
	var body trashPick
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "bad body")
		return
	}
	nRev, nRec := 0, 0
	for _, id := range body.Reviews {
		if res, err := a.DB.Exec(`UPDATE reviews SET deleted_at='', deleted_by=NULL WHERE id=? AND deleted_at != ''`, id); err == nil {
			if c, _ := res.RowsAffected(); c > 0 {
				nRev++
				// its comments come back to everyone's list on the next refresh
				a.DB.Exec(`UPDATE records SET modified_at=? WHERE review_id=? AND deleted_at=''`, modNow(), id)
			}
		}
	}
	for _, id := range body.Records {
		res, err := a.DB.Exec(`UPDATE records SET deleted_at='', deleted_by=NULL, modified_at=?, version=version+1
			WHERE id=? AND deleted_at != '' AND review_id IN (SELECT id FROM reviews WHERE deleted_at='')`, modNow(), id)
		if err == nil {
			if c, _ := res.RowsAffected(); c > 0 {
				nRec++
				logEvent(a.exec, id, u.ID, "restore", map[string]any{})
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"reviews": nRev, "records": nRec})
}

// purgeTrash deletes picked reviews and comments for good (admin). Only
// things already in the Trash can be purged.
func (a *API) purgeTrash(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	var body trashPick
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "bad body")
		return
	}
	nRev, nRec := 0, 0
	for _, id := range body.Reviews {
		var n int
		a.DB.QueryRow(`SELECT COUNT(*) FROM reviews WHERE id=? AND deleted_at != ''`, id).Scan(&n)
		if n > 0 && a.purgeReview(id) {
			nRev++
		}
	}
	for _, id := range body.Records {
		nRec += a.purgeRecords(`r.id=? AND r.deleted_at != ''`, id)
	}
	writeJSON(w, http.StatusOK, map[string]any{"reviews": nRev, "records": nRec})
}
