package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"time"
)

// logEvent records one change to a record for its history. Failures are
// ignored: history must never block a save.
func logEvent(exec func(string, ...any) error, recordID, userID int64, action string, detail map[string]any) {
	b, _ := json.Marshal(detail)
	_ = exec(`INSERT INTO record_events(record_id, user_id, at, action, detail) VALUES(?,?,?,?,?)`,
		recordID, userID, time.Now().UTC().Format(time.RFC3339), action, string(b))
}

// editDetail describes a patch for the history: which fields changed, plus the
// new value of the short ones people want to read back (status, discipline,
// commenter).
func editDetail(patch map[string]json.RawMessage, keys []string) map[string]any {
	d := map[string]any{"fields": keys}
	for _, k := range []string{"status", "discipline", "commenter"} {
		if raw, ok := patch[k]; ok {
			var s string
			json.Unmarshal(raw, &s)
			d[k] = s
		}
	}
	return d
}

// recordHistory returns a record's history, newest first (any signed-in user).
func (a *API) recordHistory(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad id")
		return
	}
	rows, err := a.DB.Query(`
		SELECT e.at, e.action, e.detail, COALESCE(NULLIF(u.display_name,''), u.username, '')
		FROM record_events e LEFT JOIN users u ON u.id = e.user_id
		WHERE e.record_id=? ORDER BY e.id DESC LIMIT 100`, id)
	if err != nil {
		writeErr(w, 500, "query history")
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var at, action, detail, user string
		if rows.Scan(&at, &action, &detail, &user) != nil {
			continue
		}
		out = append(out, map[string]any{"at": at, "action": action, "detail": json.RawMessage(detail), "user": user})
	}
	writeJSON(w, http.StatusOK, out)
}

// exec / txExec adapt the database or a transaction to logEvent.
func (a *API) exec(q string, args ...any) error { _, err := a.DB.Exec(q, args...); return err }

func txExec(tx *sql.Tx) func(string, ...any) error {
	return func(q string, args ...any) error { _, err := tx.Exec(q, args...); return err }
}
