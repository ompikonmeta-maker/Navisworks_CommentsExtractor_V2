package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"tabelin/server/internal/auth"
)

// Record mirrors the V1 parser shape (camelCase JSON) plus server fields.
type Record struct {
	ID             int64           `json:"id"`
	ReviewID       int64           `json:"reviewId"`
	CommentID      string          `json:"commentId"`
	Viewpoint      string          `json:"viewpoint"`
	Commenter      string          `json:"commenter"`
	Discipline     string          `json:"discipline"`
	CommentRaw     string          `json:"commentRaw"`
	CommentText    string          `json:"commentText"`
	Resolution     string          `json:"resolution"`
	Status         string          `json:"status"`
	ClosedAt       string          `json:"closedAt"`
	CommentDate    string          `json:"commentDate"`
	AuthorCode     string          `json:"authorCode"`
	CameraPosition string          `json:"cameraPosition"`
	ImageRef       string          `json:"imageRef"`
	Source         string          `json:"source"`
	Extra          json.RawMessage `json:"extra"`
	BeforeURL      string          `json:"beforeUrl,omitempty"`
	AfterURL       string          `json:"afterUrl,omitempty"`
}

func pathID(r *http.Request, name string) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue(name), 10, 64)
	return id, err == nil && id > 0
}

// listRecords returns a review's records (with image URLs) to any signed-in user.
func (a *API) listRecords(w http.ResponseWriter, r *http.Request) {
	rid, ok := pathID(r, "rid")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad review id")
		return
	}
	rows, err := a.DB.Query(`
		SELECT id, review_id, comment_id, viewpoint, commenter, discipline, comment_raw,
		       comment_text, resolution, status, closed_at, comment_date, author_code,
		       camera_position, image_ref, source, extra
		FROM records WHERE review_id=? ORDER BY id`, rid)
	if err != nil {
		writeErr(w, 500, "query records")
		return
	}
	defer rows.Close()
	out := []Record{}
	for rows.Next() {
		var rec Record
		var extra string
		var closed, cdate sql.NullString
		if err := rows.Scan(&rec.ID, &rec.ReviewID, &rec.CommentID, &rec.Viewpoint, &rec.Commenter,
			&rec.Discipline, &rec.CommentRaw, &rec.CommentText, &rec.Resolution, &rec.Status,
			&closed, &cdate, &rec.AuthorCode, &rec.CameraPosition, &rec.ImageRef, &rec.Source, &extra); err != nil {
			writeErr(w, 500, "scan record")
			return
		}
		rec.ClosedAt, rec.CommentDate = closed.String, cdate.String
		if extra == "" {
			extra = "{}"
		}
		rec.Extra = json.RawMessage(extra)
		out = append(out, rec)
	}
	// Attach image URLs (before/after) in one pass.
	imgs, _ := a.DB.Query(`
		SELECT i.record_id, i.kind, i.file_key FROM images i
		JOIN records r ON r.id = i.record_id WHERE r.review_id=?`, rid)
	if imgs != nil {
		defer imgs.Close()
		byRec := map[int64][2]string{} // [before, after]
		for imgs.Next() {
			var rid int64
			var kind, key string
			if imgs.Scan(&rid, &kind, &key) == nil {
				pair := byRec[rid]
				if kind == "after" {
					pair[1] = key
				} else {
					pair[0] = key
				}
				byRec[rid] = pair
			}
		}
		for i := range out {
			if p, ok := byRec[out[i].ID]; ok {
				if p[0] != "" {
					out[i].BeforeURL = "/api/files/" + p[0]
				}
				if p[1] != "" {
					out[i].AfterURL = "/api/files/" + p[1]
				}
			}
		}
	}
	writeJSON(w, http.StatusOK, out)
}

// importRecords bulk-inserts parsed records into a review (metadata only;
// images are uploaded separately). Owners/editors only.
func (a *API) importRecords(w http.ResponseWriter, r *http.Request) {
	u := auth.FromContext(r.Context())
	rid, ok := pathID(r, "rid")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad review id")
		return
	}
	if !canWriteRole(u) {
		writeErr(w, http.StatusForbidden, "cannot write to review")
		return
	}
	var body struct {
		Records []Record `json:"records"`
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
	stmt, err := tx.Prepare(`
		INSERT INTO records(review_id, comment_id, viewpoint, commenter, discipline, comment_raw,
			comment_text, resolution, status, closed_at, comment_date, author_code, camera_position,
			image_ref, source, extra, updated_by)
		VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
	if err != nil {
		writeErr(w, 500, "prepare")
		return
	}
	defer stmt.Close()
	for _, rec := range body.Records {
		extra := string(rec.Extra)
		if extra == "" {
			extra = "{}"
		}
		if _, err := stmt.Exec(rid, rec.CommentID, rec.Viewpoint, rec.Commenter, rec.Discipline,
			rec.CommentRaw, rec.CommentText, rec.Resolution, rec.Status, nullStr(rec.ClosedAt),
			rec.CommentDate, rec.AuthorCode, rec.CameraPosition, rec.ImageRef, rec.Source, extra, u.ID); err != nil {
			writeErr(w, 500, "insert record")
			return
		}
	}
	if err := tx.Commit(); err != nil {
		writeErr(w, 500, "commit")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"imported": len(body.Records)})
}

// patchRecord updates the editable fields of one record (owners/editors only).
func (a *API) patchRecord(w http.ResponseWriter, r *http.Request) {
	u := auth.FromContext(r.Context())
	id, ok := pathID(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	if _, err := a.recordReview(id); err != nil {
		writeErr(w, http.StatusNotFound, "record not found")
		return
	}
	if !canWriteRole(u) {
		writeErr(w, http.StatusForbidden, "cannot edit record")
		return
	}
	var patch map[string]json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		writeErr(w, http.StatusBadRequest, "bad body")
		return
	}
	// Only these fields are editable in the drawer; column ← jsonKey.
	allowed := map[string]string{
		"commenter": "commenter", "discipline": "discipline", "resolution": "resolution",
		"status": "status", "closed_at": "closedAt", "comment_text": "commentText", "extra": "extra",
	}
	set, args := "", []any{}
	for col, key := range allowed {
		raw, present := patch[key]
		if !present {
			continue
		}
		if set != "" {
			set += ", "
		}
		set += col + "=?"
		if col == "extra" {
			args = append(args, string(raw)) // store JSON text as-is
		} else {
			var s string
			json.Unmarshal(raw, &s) // string value; null/other → empty
			args = append(args, s)
		}
	}
	if set == "" {
		writeErr(w, http.StatusBadRequest, "nothing to update")
		return
	}
	set += ", updated_by=?, updated_at=?"
	args = append(args, u.ID, time.Now().UTC().Format(time.RFC3339), id)
	if _, err := a.DB.Exec(`UPDATE records SET `+set+` WHERE id=?`, args...); err != nil {
		writeErr(w, 500, "update record")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// deleteRecord removes a record and its image files (owners/editors only).
func (a *API) deleteRecord(w http.ResponseWriter, r *http.Request) {
	u := auth.FromContext(r.Context())
	id, ok := pathID(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	if _, err := a.recordReview(id); err != nil {
		writeErr(w, http.StatusNotFound, "record not found")
		return
	}
	if !canWriteRole(u) {
		writeErr(w, http.StatusForbidden, "cannot delete record")
		return
	}
	a.unlinkRecordFiles(id)
	if _, err := a.DB.Exec(`DELETE FROM records WHERE id=?`, id); err != nil {
		writeErr(w, 500, "delete record")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *API) recordReview(id int64) (int64, error) {
	var rid int64
	err := a.DB.QueryRow(`SELECT review_id FROM records WHERE id=?`, id).Scan(&rid)
	return rid, err
}

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}
