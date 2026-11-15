package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"sort"
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
	ChangedBy      string          `json:"changedBy,omitempty"`
	ChangedAt      string          `json:"changedAt,omitempty"`
	Version        int64           `json:"version"`
}

// modStamp is the time format of records.modified_at: fixed-width UTC, so the
// column sorts and compares correctly as text.
const modStamp = "2006-01-02T15:04:05.000000Z"

func modNow() string { return time.Now().UTC().Format(modStamp) }

// refreshOverlap is how far back the next ?since= starts. A save stamps its
// time just before it is written, so a refresh running in between could miss
// it; asking again for a short overlap catches it (the client ignores records
// whose version it already has).
var refreshOverlap = 10 * time.Second

func pathID(r *http.Request, name string) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue(name), 10, 64)
	return id, err == nil && id > 0
}

// queryRecords loads records (with image URLs) matching a WHERE clause on
// records r, in id order.
func (a *API) queryRecords(where string, args ...any) ([]Record, error) {
	rows, err := a.DB.Query(`
		SELECT r.id, r.review_id, r.comment_id, r.viewpoint, r.commenter, r.discipline, r.comment_raw,
		       r.comment_text, r.resolution, r.status, r.closed_at, r.comment_date, r.author_code,
		       r.camera_position, r.image_ref, r.source, r.extra,
		       COALESCE(NULLIF(u.display_name, ''), u.username, ''), r.updated_at, r.version
		FROM records r LEFT JOIN users u ON u.id = r.updated_by
		WHERE `+where+` ORDER BY r.id`, args...)
	if err != nil {
		return nil, err
	}
	out := []Record{}
	idx := map[int64]int{}
	for rows.Next() {
		var rec Record
		var extra string
		var closed, cdate, changedAt sql.NullString
		if err := rows.Scan(&rec.ID, &rec.ReviewID, &rec.CommentID, &rec.Viewpoint, &rec.Commenter,
			&rec.Discipline, &rec.CommentRaw, &rec.CommentText, &rec.Resolution, &rec.Status,
			&closed, &cdate, &rec.AuthorCode, &rec.CameraPosition, &rec.ImageRef, &rec.Source, &extra,
			&rec.ChangedBy, &changedAt, &rec.Version); err != nil {
			rows.Close()
			return nil, err
		}
		rec.ClosedAt, rec.CommentDate = closed.String, cdate.String
		// Imported rows carry no edit stamp; only real edits report who/when.
		if changedAt.String != "" {
			rec.ChangedAt = changedAt.String
		} else {
			rec.ChangedBy = ""
		}
		if extra == "" {
			extra = "{}"
		}
		rec.Extra = json.RawMessage(extra)
		idx[rec.ID] = len(out)
		out = append(out, rec)
	}
	rows.Close()
	if len(out) == 0 {
		return out, nil
	}
	// Attach image URLs (before/after) in one pass.
	imgs, err := a.DB.Query(`
		SELECT i.record_id, i.kind, i.file_key FROM images i
		JOIN records r ON r.id = i.record_id WHERE `+where, args...)
	if err != nil {
		return nil, err
	}
	defer imgs.Close()
	for imgs.Next() {
		var id int64
		var kind, key string
		if imgs.Scan(&id, &kind, &key) != nil {
			continue
		}
		i, ok := idx[id]
		if !ok {
			continue
		}
		if kind == "after" {
			out[i].AfterURL = "/api/files/" + key
		} else {
			out[i].BeforeURL = "/api/files/" + key
		}
	}
	return out, nil
}

// getRecord loads one record, or (nil, nil) when it does not exist.
func (a *API) getRecord(id int64) (*Record, error) {
	list, err := a.queryRecords(`r.id=?`, id)
	if err != nil || len(list) == 0 {
		return nil, err
	}
	return &list[0], nil
}

// listRecords returns a review's records (with image URLs) to any signed-in user.
//
// With ?since=<time> (the light refresh) it answers
// {"records": [changed since then], "ids": [every id in the review], "next": "<time>"}
// so the client can add/replace changed comments, drop deleted ones, and ask
// again from "next". An empty since returns every record in that shape.
func (a *API) listRecords(w http.ResponseWriter, r *http.Request) {
	rid, ok := pathID(r, "rid")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad review id")
		return
	}
	q := r.URL.Query()
	if !q.Has("since") {
		out, err := a.queryRecords(`r.review_id=? AND r.deleted_at=''`, rid)
		if err != nil {
			writeErr(w, 500, "query records")
			return
		}
		writeJSON(w, http.StatusOK, out)
		return
	}
	since := ""
	if raw := q.Get("since"); raw != "" {
		t, err := time.Parse(time.RFC3339Nano, raw)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "since must be an RFC 3339 time")
			return
		}
		since = t.UTC().Format(modStamp)
	}
	next := time.Now().UTC().Add(-refreshOverlap).Format(modStamp)
	changed, err := a.queryRecords(`r.review_id=? AND r.modified_at >= ? AND r.deleted_at=''`, rid, since)
	if err != nil {
		writeErr(w, 500, "query records")
		return
	}
	ids := []int64{}
	rows, err := a.DB.Query(`SELECT id FROM records WHERE review_id=? AND deleted_at='' ORDER BY id`, rid)
	if err != nil {
		writeErr(w, 500, "query ids")
		return
	}
	for rows.Next() {
		var id int64
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	rows.Close()
	writeJSON(w, http.StatusOK, map[string]any{"records": changed, "ids": ids, "next": next})
}

// getRecordHandler returns one record (any signed-in user).
func (a *API) getRecordHandler(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	rec, err := a.getRecord(id)
	if err != nil {
		writeErr(w, 500, "query record")
		return
	}
	if rec == nil {
		writeErr(w, http.StatusNotFound, "record not found")
		return
	}
	writeJSON(w, http.StatusOK, rec)
}

const insertRecordSQL = `
	INSERT INTO records(review_id, comment_id, viewpoint, commenter, discipline, comment_raw,
		comment_text, resolution, status, closed_at, comment_date, author_code, camera_position,
		image_ref, source, extra, updated_by, updated_at, version, modified_at)
	VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'',1,?)`

// insertRecord adds one record to a review inside tx and writes its history
// row. Returns the new id.
func insertRecord(tx *sql.Tx, rid, userID int64, rec Record) (int64, error) {
	extra := string(rec.Extra)
	if extra == "" || extra == "null" {
		extra = "{}"
	}
	res, err := tx.Exec(insertRecordSQL, rid, rec.CommentID, rec.Viewpoint, rec.Commenter, rec.Discipline,
		rec.CommentRaw, rec.CommentText, rec.Resolution, rec.Status, nullStr(rec.ClosedAt),
		rec.CommentDate, rec.AuthorCode, rec.CameraPosition, rec.ImageRef, rec.Source, extra, userID, modNow())
	if err != nil {
		return 0, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return 0, err
	}
	logEvent(txExec(tx), id, userID, "import", map[string]any{"source": rec.Source})
	return id, nil
}

func (a *API) reviewExists(rid int64) bool {
	var n int
	a.DB.QueryRow(`SELECT COUNT(*) FROM reviews WHERE id=?`, rid).Scan(&n)
	return n > 0
}

// importRecords bulk-inserts parsed records into a review (metadata only;
// images are uploaded separately). Admins only. Answers the new ids in the
// order the records were sent.
func (a *API) importRecords(w http.ResponseWriter, r *http.Request) {
	u := auth.FromContext(r.Context())
	rid, ok := pathID(r, "rid")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad review id")
		return
	}
	if !isAdminRole(u) {
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
	if !a.reviewExists(rid) {
		writeErr(w, http.StatusNotFound, "review not found")
		return
	}
	tx, err := a.DB.Begin()
	if err != nil {
		writeErr(w, 500, "begin")
		return
	}
	defer tx.Rollback()
	ids := make([]int64, 0, len(body.Records))
	for _, rec := range body.Records {
		id, err := insertRecord(tx, rid, u.ID, rec)
		if err != nil {
			writeErr(w, 500, "insert record")
			return
		}
		ids = append(ids, id)
	}
	if err := tx.Commit(); err != nil {
		writeErr(w, 500, "commit")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"imported": len(ids), "ids": ids})
}

// createRecord adds one comment typed in by hand and returns it with its new
// id and version. Admins only.
func (a *API) createRecord(w http.ResponseWriter, r *http.Request) {
	u := auth.FromContext(r.Context())
	rid, ok := pathID(r, "rid")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad review id")
		return
	}
	if !isAdminRole(u) {
		writeErr(w, http.StatusForbidden, "cannot write to review")
		return
	}
	var rec Record
	if err := json.NewDecoder(r.Body).Decode(&rec); err != nil {
		writeErr(w, http.StatusBadRequest, "bad body")
		return
	}
	if !a.reviewExists(rid) {
		writeErr(w, http.StatusNotFound, "review not found")
		return
	}
	tx, err := a.DB.Begin()
	if err != nil {
		writeErr(w, 500, "begin")
		return
	}
	defer tx.Rollback()
	id, err := insertRecord(tx, rid, u.ID, rec)
	if err != nil {
		writeErr(w, 500, "insert record")
		return
	}
	if err := tx.Commit(); err != nil {
		writeErr(w, 500, "commit")
		return
	}
	out, err := a.getRecord(id)
	if err != nil || out == nil {
		writeErr(w, 500, "read new record")
		return
	}
	writeJSON(w, http.StatusCreated, out)
}

// readVersion takes the optional "version" out of a patch body. ok is false
// when it is present but not a whole number.
func readVersion(patch map[string]json.RawMessage) (v *int64, ok bool) {
	raw, present := patch["version"]
	if !present || string(raw) == "null" {
		return nil, true
	}
	var n int64
	if err := json.Unmarshal(raw, &n); err != nil {
		return nil, false
	}
	return &n, true
}

// patchRecord updates the editable fields of one record. Reviewers may change
// the review fields; admins also the report fields.
//
// The body may carry "version": the version the client last saw. If the record
// has changed since, nothing is saved and the answer is 409 with the current
// record, so the client can show the newer values instead of overwriting them.
// A successful save answers {"ok": true, "record": <record with new version>}.
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
	if !canReviewRole(u) {
		writeErr(w, http.StatusForbidden, "cannot edit record")
		return
	}
	var patch map[string]json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		writeErr(w, http.StatusBadRequest, "bad body")
		return
	}
	version, vok := readVersion(patch)
	if !vok {
		writeErr(w, http.StatusBadRequest, "version must be a number")
		return
	}
	set, args, keys := buildPatch(patch, u.ID, isAdminRole(u))
	if set == "" {
		writeErr(w, http.StatusBadRequest, "nothing to update")
		return
	}
	q, qargs := `UPDATE records SET `+set+` WHERE id=?`, append(args, id)
	if version != nil {
		q, qargs = q+` AND version=?`, append(qargs, *version)
	}
	res, err := a.DB.Exec(q, qargs...)
	if err != nil {
		writeErr(w, 500, "update record")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		a.writeConflict(w, id)
		return
	}
	logEvent(a.exec, id, u.ID, "edit", editDetail(patch, keys))
	rec, err := a.getRecord(id)
	if err != nil || rec == nil {
		writeErr(w, 500, "read record")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "record": rec})
}

// writeConflict answers 409 with the record as it is now.
func (a *API) writeConflict(w http.ResponseWriter, id int64) {
	rec, err := a.getRecord(id)
	if err != nil || rec == nil {
		writeErr(w, http.StatusNotFound, "record not found")
		return
	}
	writeJSON(w, http.StatusConflict, map[string]any{"error": "changed by someone else", "record": rec})
}

// bulkPatchRecords applies many record edits in one transaction — used when a
// change touches lots of records at once (detection re-run, status or custom
// field rename, bulk edit). Only records of this review are touched; same
// field rules as patchRecord.
//
// Each update may carry "version"; a row whose version is stale is skipped and
// listed in "conflicts" (as the current record). The answer also gives the new
// version of every updated row: {"updated": n, "versions": {id: v}, "conflicts": [...]}.
func (a *API) bulkPatchRecords(w http.ResponseWriter, r *http.Request) {
	u := auth.FromContext(r.Context())
	rid, ok := pathID(r, "rid")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad review id")
		return
	}
	if !canReviewRole(u) {
		writeErr(w, http.StatusForbidden, "cannot edit records")
		return
	}
	var body struct {
		Updates []struct {
			ID      int64                      `json:"id"`
			Version *int64                     `json:"version"`
			Patch   map[string]json.RawMessage `json:"patch"`
		} `json:"updates"`
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
	versions := map[string]int64{}
	var stale []int64
	for _, up := range body.Updates {
		set, args, keys := buildPatch(up.Patch, u.ID, isAdminRole(u))
		if set == "" {
			continue
		}
		q, qargs := `UPDATE records SET `+set+` WHERE id=? AND review_id=? AND deleted_at=''`, append(args, up.ID, rid)
		if up.Version != nil {
			q, qargs = q+` AND version=?`, append(qargs, *up.Version)
		}
		res, err := tx.Exec(q, qargs...)
		if err != nil {
			writeErr(w, 500, "update record")
			return
		}
		if c, _ := res.RowsAffected(); c > 0 {
			var v int64
			tx.QueryRow(`SELECT version FROM records WHERE id=?`, up.ID).Scan(&v)
			versions[strconv.FormatInt(up.ID, 10)] = v
			logEvent(txExec(tx), up.ID, u.ID, "edit", editDetail(up.Patch, keys))
		} else if up.Version != nil {
			var n int
			tx.QueryRow(`SELECT COUNT(*) FROM records WHERE id=? AND review_id=? AND deleted_at=''`, up.ID, rid).Scan(&n)
			if n > 0 {
				stale = append(stale, up.ID)
			}
		}
	}
	if err := tx.Commit(); err != nil {
		writeErr(w, 500, "commit")
		return
	}
	conflicts := []Record{}
	for _, id := range stale {
		if rec, err := a.getRecord(id); err == nil && rec != nil {
			conflicts = append(conflicts, *rec)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"updated": len(versions), "versions": versions, "conflicts": conflicts})
}

// buildPatch turns a JSON patch into "col=?, …" plus args for the editable
// fields, stamping who changed it and when. Empty set = nothing editable.
// Reviewers get the review fields only; admins also the report fields.
func buildPatch(patch map[string]json.RawMessage, userID int64, admin bool) (string, []any, []string) {
	// Only these fields are editable; column ← jsonKey.
	allowed := map[string]string{
		"commenter": "commenter", "discipline": "discipline", "resolution": "resolution",
		"status": "status", "closed_at": "closedAt", "extra": "extra",
	}
	if admin {
		for col, key := range map[string]string{
			"comment_text": "commentText",
			// refreshed from a newer Navisworks report when a review is re-imported
			"comment_raw": "commentRaw", "viewpoint": "viewpoint", "comment_date": "commentDate",
			"author_code": "authorCode", "camera_position": "cameraPosition", "image_ref": "imageRef",
		} {
			allowed[col] = key
		}
	}
	set, args, keys := "", []any{}, []string{}
	for col, key := range allowed {
		raw, present := patch[key]
		if !present {
			continue
		}
		keys = append(keys, key)
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
		return "", nil, nil
	}
	sort.Strings(keys)
	set += ", updated_by=?, updated_at=?, version=version+1, modified_at=?"
	return set, append(args, userID, time.Now().UTC().Format(time.RFC3339), modNow()), keys
}

// bulkDeleteRecords moves many comments of a review to the Trash (admin).
// ?forGood=1 deletes them at once instead — used to undo an import, whose
// added comments should not linger in the Trash.
func (a *API) bulkDeleteRecords(w http.ResponseWriter, r *http.Request) {
	u := auth.FromContext(r.Context())
	rid, ok := pathID(r, "rid")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad review id")
		return
	}
	if !isAdminRole(u) {
		writeErr(w, http.StatusForbidden, "cannot delete records")
		return
	}
	var body struct {
		IDs []int64 `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "bad body")
		return
	}
	n := 0
	if r.URL.Query().Get("forGood") == "1" {
		for _, id := range body.IDs {
			n += a.purgeRecords(`r.id=? AND r.review_id=?`, id, rid)
		}
	} else {
		n = a.trashRecords(rid, body.IDs, u.ID)
	}
	writeJSON(w, http.StatusOK, map[string]any{"deleted": n})
}

// deleteRecord moves one comment to the Trash (admins only).
func (a *API) deleteRecord(w http.ResponseWriter, r *http.Request) {
	u := auth.FromContext(r.Context())
	id, ok := pathID(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	rid, err := a.recordReview(id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "record not found")
		return
	}
	if !isAdminRole(u) {
		writeErr(w, http.StatusForbidden, "cannot delete record")
		return
	}
	if a.trashRecords(rid, []int64{id}, u.ID) == 0 {
		writeErr(w, http.StatusNotFound, "record not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *API) recordReview(id int64) (int64, error) {
	var rid int64
	err := a.DB.QueryRow(`SELECT review_id FROM records WHERE id=? AND deleted_at=''`, id).Scan(&rid)
	return rid, err
}

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}
