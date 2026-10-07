package api

import (
	"database/sql"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"tabelin/server/internal/auth"
)

const maxTemplateBytes = 50 << 20 // 50 MB

const xlsxMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

// The Excel log-sheet template is stored once per project (its column mapping
// lives in the project config). Any signed-in user may download it; admins and
// admins replace or remove it.

func (a *API) getTemplate(w http.ResponseWriter, r *http.Request) {
	pid, ok := pathID(r, "pid")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad project id")
		return
	}
	var name, key string
	err := a.DB.QueryRow(`SELECT name, file_key FROM templates WHERE project_id=? ORDER BY id DESC LIMIT 1`, pid).Scan(&name, &key)
	if err == sql.ErrNoRows {
		writeErr(w, http.StatusNotFound, "no template")
		return
	}
	if err != nil {
		writeErr(w, 500, "lookup template")
		return
	}
	w.Header().Set("Content-Type", xlsxMime)
	w.Header().Set("X-Template-Name", url.PathEscape(name))
	http.ServeFile(w, r, filepath.Join(a.FilesDir, key))
}

func (a *API) putTemplate(w http.ResponseWriter, r *http.Request) {
	pid, ok := pathID(r, "pid")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad project id")
		return
	}
	if !isAdminRole(auth.FromContext(r.Context())) {
		writeErr(w, http.StatusForbidden, "cannot change template")
		return
	}
	name := strings.TrimSpace(r.URL.Query().Get("name"))
	if name == "" {
		name = "template.xlsx"
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxTemplateBytes))
	if err != nil || len(body) == 0 {
		writeErr(w, http.StatusRequestEntityTooLarge, "template missing or too large")
		return
	}
	key := randKey() + ".xlsx"
	if err := os.WriteFile(filepath.Join(a.FilesDir, key), body, 0o644); err != nil {
		writeErr(w, 500, "write file")
		return
	}
	a.removeTemplates(pid)
	if _, err := a.DB.Exec(`INSERT INTO templates(project_id, name, file_key) SELECT id, ?, ? FROM projects WHERE id=?`, name, key, pid); err != nil {
		os.Remove(filepath.Join(a.FilesDir, key))
		writeErr(w, 500, "save template")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"name": name, "size": len(body)})
}

func (a *API) deleteTemplate(w http.ResponseWriter, r *http.Request) {
	pid, ok := pathID(r, "pid")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad project id")
		return
	}
	if !isAdminRole(auth.FromContext(r.Context())) {
		writeErr(w, http.StatusForbidden, "cannot change template")
		return
	}
	a.removeTemplates(pid)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// removeTemplates deletes a project's stored template rows and their files.
func (a *API) removeTemplates(pid int64) {
	if rows, err := a.DB.Query(`SELECT file_key FROM templates WHERE project_id=?`, pid); err == nil {
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
	a.DB.Exec(`DELETE FROM templates WHERE project_id=?`, pid)
}
