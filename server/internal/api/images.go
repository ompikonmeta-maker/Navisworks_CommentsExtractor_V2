package api

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"io"
	"net/http"
	"os"
	"path/filepath"

	"tabelin/server/internal/auth"
)

const maxImageBytes = 25 << 20 // 25 MB

// extForMime maps the accepted image types to a file extension.
var extForMime = map[string]string{
	"image/png":  ".png",
	"image/jpeg": ".jpg",
	"image/jpg":  ".jpg",
}

// uploadImage stores a before/after photo for a record on disk and records its
// key. Body is the raw image bytes; Content-Type gives the mime. Replaces any
// existing image of the same kind. Admins and reviewers.
func (a *API) uploadImage(w http.ResponseWriter, r *http.Request) {
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
		writeErr(w, http.StatusForbidden, "cannot upload to record")
		return
	}
	kind := r.URL.Query().Get("kind")
	if kind != "after" {
		kind = "before"
	}
	mime := r.Header.Get("Content-Type")
	ext, okMime := extForMime[mime]
	if !okMime {
		writeErr(w, http.StatusUnsupportedMediaType, "only png/jpeg")
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxImageBytes))
	if err != nil {
		writeErr(w, http.StatusRequestEntityTooLarge, "image too large")
		return
	}
	key := randKey() + ext
	if err := os.WriteFile(filepath.Join(a.FilesDir, key), body, 0o644); err != nil {
		writeErr(w, 500, "write file")
		return
	}
	// Replace any existing image of this kind for the record.
	if old, e := a.DB.Query(`SELECT file_key FROM images WHERE record_id=? AND kind=?`, id, kind); e == nil {
		for old.Next() {
			var k string
			if old.Scan(&k) == nil {
				os.Remove(filepath.Join(a.FilesDir, k))
			}
		}
		old.Close()
	}
	if _, err := a.DB.Exec(`DELETE FROM images WHERE record_id=? AND kind=?`, id, kind); err != nil {
		writeErr(w, 500, "clear old image")
		return
	}
	if _, err := a.DB.Exec(`INSERT INTO images(record_id, kind, file_key, mime, size) VALUES(?,?,?,?,?)`,
		id, kind, key, mime, len(body)); err != nil {
		writeErr(w, 500, "insert image")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"key": key, "url": "/api/files/" + key, "kind": kind})
}

// deleteImage removes a record's before/after photo (admins and reviewers).
func (a *API) deleteImage(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	if !canReviewRole(auth.FromContext(r.Context())) {
		writeErr(w, http.StatusForbidden, "cannot change record")
		return
	}
	kind := r.URL.Query().Get("kind")
	if kind != "after" {
		kind = "before"
	}
	if rows, err := a.DB.Query(`SELECT file_key FROM images WHERE record_id=? AND kind=?`, id, kind); err == nil {
		var keys []string
		for rows.Next() {
			var k string
			if rows.Scan(&k) == nil {
				keys = append(keys, k)
			}
		}
		rows.Close()
		for _, k := range keys {
			os.Remove(filepath.Join(a.FilesDir, k))
		}
	}
	if _, err := a.DB.Exec(`DELETE FROM images WHERE record_id=? AND kind=?`, id, kind); err != nil {
		writeErr(w, 500, "delete image")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// unlinkFilesWhere removes the image files of every record matched by the
// given WHERE clause on records (rows themselves go via ON DELETE CASCADE).
func (a *API) unlinkFilesWhere(where string, args ...any) {
	rows, err := a.DB.Query(`SELECT i.file_key FROM images i JOIN records r ON r.id = i.record_id WHERE `+where, args...)
	if err != nil {
		return
	}
	var keys []string
	for rows.Next() {
		var k string
		if rows.Scan(&k) == nil {
			keys = append(keys, k)
		}
	}
	rows.Close()
	for _, k := range keys {
		os.Remove(filepath.Join(a.FilesDir, k))
	}
}

// getFile streams a stored image to any signed-in user.
func (a *API) getFile(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	if key == "" || filepath.Base(key) != key { // no path traversal
		writeErr(w, http.StatusBadRequest, "bad key")
		return
	}
	var mime string
	err := a.DB.QueryRow(`SELECT mime FROM images WHERE file_key=?`, key).Scan(&mime)
	if err == sql.ErrNoRows {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	if err != nil {
		writeErr(w, 500, "lookup file")
		return
	}
	if mime != "" {
		w.Header().Set("Content-Type", mime)
	}
	http.ServeFile(w, r, filepath.Join(a.FilesDir, key))
}

// unlinkRecordFiles removes all image files for a record from disk (rows go via
// ON DELETE CASCADE).
func (a *API) unlinkRecordFiles(recordID int64) {
	rows, err := a.DB.Query(`SELECT file_key FROM images WHERE record_id=?`, recordID)
	if err != nil {
		return
	}
	defer rows.Close()
	for rows.Next() {
		var k string
		if rows.Scan(&k) == nil {
			os.Remove(filepath.Join(a.FilesDir, k))
		}
	}
}

func randKey() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}
