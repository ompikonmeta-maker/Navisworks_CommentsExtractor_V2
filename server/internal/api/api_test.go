package api

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"tabelin/server/internal/auth"
	"tabelin/server/internal/db"
)

// ---- test server: the same wiring as main.go, on a temporary data folder ----

type env struct {
	t        *testing.T
	api      *API
	db       *sql.DB
	url      string
	admin    *http.Client
	reviewer *http.Client
	anon     *http.Client
}

func newEnv(t *testing.T) *env {
	t.Helper()
	dir := t.TempDir()
	files := filepath.Join(dir, "files")
	if err := os.MkdirAll(files, 0o755); err != nil {
		t.Fatal(err)
	}
	d, err := db.Open(filepath.Join(dir, "tabelin.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	a := &API{DB: d, Version: "test", FilesDir: files, ServerURLs: func() []string { return nil }}
	root := http.NewServeMux()
	root.HandleFunc("POST /api/login", a.Login)
	root.HandleFunc("POST /api/logout", a.Logout)
	root.Handle("/api/", auth.Middleware(a.Identify, a.ResolveUser)(a.Routes()))
	srv := httptest.NewServer(root)
	t.Cleanup(func() { srv.Close(); d.Close() })

	e := &env{t: t, api: a, db: d, url: srv.URL, anon: srv.Client()}
	for _, u := range [][3]string{{"boss", "Boss", "admin"}, {"rina", "Rina", "reviewer"}} {
		if _, err := d.Exec(`INSERT INTO users(username, display_name, role) VALUES(?,?,?)`, u[0], u[1], u[2]); err != nil {
			t.Fatal(err)
		}
	}
	e.admin = e.login("boss", "1111")
	e.reviewer = e.login("rina", "2222")
	return e
}

// login signs in (the first sign-in sets the PIN) and returns a client that
// carries the session cookie.
func (e *env) login(user, pin string) *http.Client {
	e.t.Helper()
	jar, _ := cookiejar.New(nil)
	c := &http.Client{Jar: jar}
	code, body := e.do(c, "POST", "/api/login", map[string]string{"username": user, "pin": pin})
	if code != http.StatusOK {
		e.t.Fatalf("login %s: %d %s", user, code, body)
	}
	return c
}

// do sends a request. body may be nil, []byte (sent raw, as image/png unless a
// content type is given) or anything JSON-encodable.
func (e *env) do(c *http.Client, method, path string, body any, ctype ...string) (int, []byte) {
	e.t.Helper()
	var rd io.Reader
	ct := ""
	switch b := body.(type) {
	case nil:
	case []byte:
		rd, ct = bytes.NewReader(b), "image/png"
	default:
		j, err := json.Marshal(b)
		if err != nil {
			e.t.Fatal(err)
		}
		rd, ct = bytes.NewReader(j), "application/json"
	}
	if len(ctype) > 0 {
		ct = ctype[0]
	}
	req, err := http.NewRequest(method, e.url+path, rd)
	if err != nil {
		e.t.Fatal(err)
	}
	if ct != "" {
		req.Header.Set("Content-Type", ct)
	}
	res, err := c.Do(req)
	if err != nil {
		e.t.Fatalf("%s %s: %v", method, path, err)
	}
	defer res.Body.Close()
	out, _ := io.ReadAll(res.Body)
	return res.StatusCode, out
}

// want sends a request and fails the test unless the status matches.
func (e *env) want(status int, c *http.Client, method, path string, body any, ctype ...string) []byte {
	e.t.Helper()
	code, out := e.do(c, method, path, body, ctype...)
	if code != status {
		e.t.Errorf("%s %s: status %d, want %d (%s)", method, path, code, status, strings.TrimSpace(string(out)))
	}
	return out
}

func decode[T any](t *testing.T, b []byte) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatalf("decode %s: %v", b, err)
	}
	return v
}

type fixture struct {
	pid, rid int64
	ids      []int64 // record IDs, in import order
}

func sampleRecords() []map[string]any {
	return []map[string]any{
		{"commentId": "101", "viewpoint": "Tag View 1", "commentRaw": "CPY_Dito: first", "commentText": "first", "status": "Open", "discipline": "PIP", "commenter": "CPY_Dito", "source": "report.html"},
		{"commentId": "102", "viewpoint": "Tag View 2", "commentRaw": "OPS(Teguh): second", "commentText": "second", "status": "Open", "discipline": "OTHER", "commenter": "OPS(Teguh)", "source": "report.html"},
		{"commentId": "103", "viewpoint": "Tag View 3", "commentRaw": "third", "commentText": "third", "status": "Open", "discipline": "STR", "source": "report.html"},
	}
}

// seed creates a project, a review and three imported comments (as admin).
func (e *env) seed() fixture {
	e.t.Helper()
	var f fixture
	f.pid = decode[struct{ ID int64 }](e.t, e.want(201, e.admin, "POST", "/api/projects", map[string]string{"name": "Project A"})).ID
	f.rid = decode[struct{ ID int64 }](e.t, e.want(201, e.admin, "POST", fmt.Sprintf("/api/projects/%d/reviews", f.pid), map[string]string{"name": "Review 1"})).ID
	e.want(201, e.admin, "POST", fmt.Sprintf("/api/reviews/%d/records", f.rid), map[string]any{"records": sampleRecords()})
	for _, r := range e.records(f.rid) {
		f.ids = append(f.ids, r.ID)
	}
	if len(f.ids) != 3 {
		e.t.Fatalf("seed: %d records, want 3", len(f.ids))
	}
	return f
}

func (e *env) records(rid int64) []Record {
	e.t.Helper()
	return decode[[]Record](e.t, e.want(200, e.reviewer, "GET", fmt.Sprintf("/api/reviews/%d/records", rid), nil))
}

func (e *env) record(rid, id int64) Record {
	e.t.Helper()
	for _, r := range e.records(rid) {
		if r.ID == id {
			return r
		}
	}
	e.t.Fatalf("record %d not found", id)
	return Record{}
}

func (e *env) count(q string, args ...any) int {
	e.t.Helper()
	var n int
	if err := e.db.QueryRow(q, args...).Scan(&n); err != nil {
		e.t.Fatalf("count: %v", err)
	}
	return n
}

var png = []byte("\x89PNG\r\n\x1a\nnot really a picture")

// ---- sign-in ----

func TestSignInIsRequired(t *testing.T) {
	e := newEnv(t)
	for _, p := range []string{"/api/me", "/api/projects", "/api/users", "/api/config"} {
		e.want(401, e.anon, "GET", p, nil)
	}
	e.want(401, e.anon, "POST", "/api/login", map[string]string{"username": "rina", "pin": "0000"}) // wrong PIN
	e.want(401, e.anon, "POST", "/api/login", map[string]string{"username": "nobody", "pin": "1"})  // not provisioned

	me := decode[auth.User](t, e.want(200, e.reviewer, "GET", "/api/me", nil))
	if me.Username != "rina" || me.Role != "reviewer" {
		t.Errorf("me = %+v", me)
	}
	e.want(200, e.reviewer, "POST", "/api/logout", nil)
	e.want(401, e.reviewer, "GET", "/api/me", nil)
}

// ---- roles ----

func TestReviewerCannotDoAdminWork(t *testing.T) {
	e := newEnv(t)
	f := e.seed()
	rid, pid, id := f.rid, f.pid, f.ids[0]
	cfg := map[string]any{"key": "k", "json": map[string]int{"a": 1}}

	denied := []struct {
		method, path string
		body         any
	}{
		{"POST", fmt.Sprintf("/api/reviews/%d/records", rid), map[string]any{"records": sampleRecords()}}, // import
		{"DELETE", fmt.Sprintf("/api/records/%d", id), nil},
		{"POST", fmt.Sprintf("/api/reviews/%d/records/delete", rid), map[string]any{"ids": f.ids}}, // bulk delete
		{"PUT", "/api/config", cfg},
		{"PUT", fmt.Sprintf("/api/projects/%d/config", pid), cfg},
		{"PUT", fmt.Sprintf("/api/reviews/%d/config", rid), cfg},
		{"PUT", fmt.Sprintf("/api/projects/%d/template?name=t.xlsx", pid), []byte("xlsx bytes")},
		{"DELETE", fmt.Sprintf("/api/projects/%d/template", pid), nil},
		{"GET", "/api/users", nil},
		{"POST", "/api/users", map[string]string{"username": "new", "role": "admin"}},
		{"PATCH", "/api/users/1", map[string]string{"role": "reviewer"}},
		{"DELETE", "/api/users/1", nil},
		{"POST", "/api/users/1/reset-pin", nil},
		{"GET", "/api/server-info", nil},
		{"POST", "/api/projects", map[string]string{"name": "X"}},
		{"PATCH", fmt.Sprintf("/api/projects/%d", pid), map[string]string{"name": "X"}},
		{"DELETE", fmt.Sprintf("/api/projects/%d", pid), nil},
		{"POST", fmt.Sprintf("/api/projects/%d/reviews", pid), map[string]string{"name": "X"}},
		{"PATCH", fmt.Sprintf("/api/reviews/%d", rid), map[string]string{"name": "X"}},
		{"DELETE", fmt.Sprintf("/api/reviews/%d", rid), nil},
	}
	for _, d := range denied {
		e.want(403, e.reviewer, d.method, d.path, d.body)
	}

	// Nothing above took effect.
	if n := len(e.records(rid)); n != 3 {
		t.Errorf("records after denied calls: %d, want 3", n)
	}
	if n := e.count(`SELECT COUNT(*) FROM config`); n != 0 {
		t.Errorf("config rows: %d, want 0", n)
	}
	if n := e.count(`SELECT COUNT(*) FROM templates`); n != 0 {
		t.Errorf("templates: %d, want 0", n)
	}
	if n := e.count(`SELECT COUNT(*) FROM users`); n != 2 {
		t.Errorf("users: %d, want 2", n)
	}
	if n := e.count(`SELECT COUNT(*) FROM projects WHERE name='Project A'`) + e.count(`SELECT COUNT(*) FROM reviews WHERE name='Review 1'`); n != 2 {
		t.Errorf("project/review were renamed or removed")
	}
}

func TestReviewerCanWorkComments(t *testing.T) {
	e := newEnv(t)
	f := e.seed()
	rid, id := f.rid, f.ids[0]

	// reading is open to every signed-in user
	e.want(200, e.reviewer, "GET", "/api/projects", nil)
	e.want(200, e.reviewer, "GET", fmt.Sprintf("/api/projects/%d/reviews", f.pid), nil)
	e.want(200, e.reviewer, "GET", fmt.Sprintf("/api/projects/%d/config", f.pid), nil)
	e.want(200, e.reviewer, "GET", fmt.Sprintf("/api/reviews/%d/config", rid), nil)
	e.want(200, e.reviewer, "GET", fmt.Sprintf("/api/records/%d/history", id), nil)

	// the review fields
	e.want(200, e.reviewer, "PATCH", fmt.Sprintf("/api/records/%d", id), map[string]any{
		"status": "Closed", "closedAt": "2025-02-14T03:00:00Z", "resolution": "Rerouted",
		"discipline": "STR", "commenter": "Budi", "extra": map[string]string{"cf_x": "y"},
	})
	r := e.record(rid, id)
	if r.Status != "Closed" || r.ClosedAt != "2025-02-14T03:00:00Z" || r.Resolution != "Rerouted" || r.Discipline != "STR" || r.Commenter != "Budi" {
		t.Errorf("patched record = %+v", r)
	}
	if got := decode[map[string]string](t, r.Extra); got["cf_x"] != "y" {
		t.Errorf("extra = %s", r.Extra)
	}
	if r.ChangedBy != "Rina" || r.ChangedAt == "" {
		t.Errorf("changed by %q at %q, want Rina", r.ChangedBy, r.ChangedAt)
	}

	// a report field alone is rejected…
	e.want(400, e.reviewer, "PATCH", fmt.Sprintf("/api/records/%d", id), map[string]string{"viewpoint": "Hacked"})
	e.want(400, e.reviewer, "PATCH", fmt.Sprintf("/api/records/%d", id), map[string]string{"commentText": "Hacked", "commentRaw": "Hacked"})
	// …and is ignored when sent along with an allowed field, single or bulk
	e.want(200, e.reviewer, "PATCH", fmt.Sprintf("/api/records/%d", id), map[string]string{"viewpoint": "Hacked", "resolution": "Rerouted again"})
	e.want(200, e.reviewer, "PATCH", fmt.Sprintf("/api/reviews/%d/records", rid), map[string]any{"updates": []map[string]any{
		{"id": f.ids[1], "patch": map[string]string{"status": "In Review", "viewpoint": "Hacked", "commentText": "Hacked"}},
	}})
	r = e.record(rid, id)
	if r.Viewpoint != "Tag View 1" || r.CommentText != "first" || r.CommentRaw != "CPY_Dito: first" || r.Resolution != "Rerouted again" {
		t.Errorf("report fields changed by a reviewer: %+v", r)
	}
	r2 := e.record(rid, f.ids[1])
	if r2.Viewpoint != "Tag View 2" || r2.CommentText != "second" || r2.Status != "In Review" {
		t.Errorf("bulk patch by reviewer: %+v", r2)
	}

	// photos
	e.want(201, e.reviewer, "POST", fmt.Sprintf("/api/records/%d/images?kind=after", id), png)
	r = e.record(rid, id)
	if r.AfterURL == "" || r.BeforeURL != "" {
		t.Fatalf("after upload: before=%q after=%q", r.BeforeURL, r.AfterURL)
	}
	if got := e.want(200, e.reviewer, "GET", r.AfterURL, nil); !bytes.Equal(got, png) {
		t.Errorf("downloaded photo differs from the upload")
	}
	e.want(415, e.reviewer, "POST", fmt.Sprintf("/api/records/%d/images?kind=after", id), []byte("GIF89a"), "image/gif")
	e.want(200, e.reviewer, "DELETE", fmt.Sprintf("/api/records/%d/images?kind=after", id), nil)
	if r = e.record(rid, id); r.AfterURL != "" {
		t.Errorf("photo still listed after removal")
	}

	// a comment that does not exist
	e.want(404, e.reviewer, "PATCH", "/api/records/9999", map[string]string{"status": "Closed"})
}

func TestAdminCanDoEverything(t *testing.T) {
	e := newEnv(t)
	f := e.seed()
	rid, pid, id := f.rid, f.pid, f.ids[0]

	// report fields
	e.want(200, e.admin, "PATCH", fmt.Sprintf("/api/records/%d", id), map[string]string{"viewpoint": "Tag View 1b", "commentText": "first, edited"})
	if r := e.record(rid, id); r.Viewpoint != "Tag View 1b" || r.CommentText != "first, edited" {
		t.Errorf("admin patch: %+v", r)
	}

	// config at the three scopes
	cfg := map[string]any{"key": "target", "json": "2025-03-01"}
	e.want(200, e.admin, "PUT", "/api/config", cfg)
	e.want(200, e.admin, "PUT", fmt.Sprintf("/api/projects/%d/config", pid), cfg)
	e.want(200, e.admin, "PUT", fmt.Sprintf("/api/reviews/%d/config", rid), cfg)
	got := decode[map[string]string](t, e.want(200, e.reviewer, "GET", fmt.Sprintf("/api/reviews/%d/config", rid), nil))
	if got["target"] != "2025-03-01" {
		t.Errorf("review config = %v", got)
	}

	// template
	tpl := []byte("PK\x03\x04 pretend workbook")
	e.want(200, e.admin, "PUT", fmt.Sprintf("/api/projects/%d/template?name=log.xlsx", pid), tpl, "application/octet-stream")
	if back := e.want(200, e.reviewer, "GET", fmt.Sprintf("/api/projects/%d/template", pid), nil); !bytes.Equal(back, tpl) {
		t.Errorf("template read back differs")
	}
	e.want(200, e.admin, "DELETE", fmt.Sprintf("/api/projects/%d/template", pid), nil)

	// users
	e.want(200, e.admin, "GET", "/api/users", nil)
	e.want(201, e.admin, "POST", "/api/users", map[string]string{"username": "Edo", "role": "reviewer"})
	e.want(409, e.admin, "POST", "/api/users", map[string]string{"username": "edo"})
	e.want(200, e.admin, "GET", "/api/server-info", nil)

	// import more, delete one, bulk delete the rest
	e.want(201, e.admin, "POST", fmt.Sprintf("/api/reviews/%d/records", rid), map[string]any{"records": sampleRecords()[:1]})
	if n := len(e.records(rid)); n != 4 {
		t.Fatalf("records after second import: %d, want 4", n)
	}
	e.want(200, e.admin, "DELETE", fmt.Sprintf("/api/records/%d", id), nil)
	e.want(404, e.admin, "DELETE", fmt.Sprintf("/api/records/%d", id), nil)
	e.want(200, e.admin, "POST", fmt.Sprintf("/api/reviews/%d/records/delete", rid), map[string]any{"ids": f.ids[1:]})
	if n := len(e.records(rid)); n != 1 {
		t.Errorf("records after deletes: %d, want 1", n)
	}

	e.want(200, e.admin, "PATCH", fmt.Sprintf("/api/projects/%d", pid), map[string]string{"name": "Project B"})
	e.want(200, e.admin, "PATCH", fmt.Sprintf("/api/reviews/%d", rid), map[string]string{"name": "Review 2"})
}

// A bulk edit only touches comments of the review named in the address.
func TestBulkEditStaysInsideItsReview(t *testing.T) {
	e := newEnv(t)
	f := e.seed()
	other := decode[struct{ ID int64 }](t, e.want(201, e.admin, "POST", fmt.Sprintf("/api/projects/%d/reviews", f.pid), map[string]string{"name": "Review 2"})).ID
	out := e.want(200, e.reviewer, "PATCH", fmt.Sprintf("/api/reviews/%d/records", other), map[string]any{"updates": []map[string]any{
		{"id": f.ids[0], "patch": map[string]string{"status": "Closed"}},
	}})
	if n := decode[struct{ Updated int }](t, out).Updated; n != 0 {
		t.Errorf("updated %d records of another review", n)
	}
	e.want(200, e.admin, "POST", fmt.Sprintf("/api/reviews/%d/records/delete", other), map[string]any{"ids": f.ids})
	if r := e.record(f.rid, f.ids[0]); r.Status != "Open" {
		t.Errorf("status = %q, want Open", r.Status)
	}
}

// ---- history ----

type event struct {
	At     string         `json:"at"`
	Action string         `json:"action"`
	User   string         `json:"user"`
	Detail map[string]any `json:"detail"`
}

func TestHistoryRecordsEveryChange(t *testing.T) {
	e := newEnv(t)
	f := e.seed()
	rid, id := f.rid, f.ids[0]
	history := func() []event {
		return decode[[]event](t, e.want(200, e.reviewer, "GET", fmt.Sprintf("/api/records/%d/history", id), nil))
	}

	if h := history(); len(h) != 1 || h[0].Action != "import" || h[0].User != "Boss" || h[0].Detail["source"] != "report.html" {
		t.Fatalf("after import: %+v", h)
	}

	e.want(200, e.reviewer, "PATCH", fmt.Sprintf("/api/records/%d", id), map[string]string{"status": "In Review", "resolution": "Looking"})
	e.want(200, e.admin, "PATCH", fmt.Sprintf("/api/reviews/%d/records", rid), map[string]any{"updates": []map[string]any{
		{"id": id, "patch": map[string]string{"discipline": "ELE"}},
		{"id": f.ids[1], "patch": map[string]string{"discipline": "ELE"}},
	}})
	e.want(201, e.reviewer, "POST", fmt.Sprintf("/api/records/%d/images?kind=after", id), png)
	e.want(200, e.reviewer, "DELETE", fmt.Sprintf("/api/records/%d/images?kind=after", id), nil)

	h := history()
	if len(h) != 5 {
		t.Fatalf("history has %d entries, want 5: %+v", len(h), h)
	}
	// newest first
	want := []struct{ action, user string }{{"photo", "Rina"}, {"photo", "Rina"}, {"edit", "Boss"}, {"edit", "Rina"}, {"import", "Boss"}}
	for i, w := range want {
		if h[i].Action != w.action || h[i].User != w.user {
			t.Errorf("entry %d = %s by %s, want %s by %s", i, h[i].Action, h[i].User, w.action, w.user)
		}
		if h[i].At == "" {
			t.Errorf("entry %d has no time", i)
		}
	}
	if h[0].Detail["op"] != "remove" || h[1].Detail["op"] != "add" || h[1].Detail["kind"] != "after" {
		t.Errorf("photo details: %v / %v", h[0].Detail, h[1].Detail)
	}
	if h[2].Detail["discipline"] != "ELE" {
		t.Errorf("bulk edit detail: %v", h[2].Detail)
	}
	if h[3].Detail["status"] != "In Review" || fmt.Sprint(h[3].Detail["fields"]) != "[resolution status]" {
		t.Errorf("edit detail: %v", h[3].Detail)
	}

	// the other comment of the bulk edit got its own entry; the untouched one did not
	if n := e.count(`SELECT COUNT(*) FROM record_events WHERE record_id=?`, f.ids[1]); n != 2 {
		t.Errorf("events on second record: %d, want 2 (import + bulk edit)", n)
	}
	if n := e.count(`SELECT COUNT(*) FROM record_events WHERE record_id=?`, f.ids[2]); n != 1 {
		t.Errorf("events on third record: %d, want 1 (import)", n)
	}
	// removing a photo that is not there writes nothing
	e.want(200, e.reviewer, "DELETE", fmt.Sprintf("/api/records/%d/images?kind=after", id), nil)
	if len(history()) != 5 {
		t.Errorf("removing a missing photo added a history entry")
	}
	// a rejected edit writes nothing
	e.want(400, e.reviewer, "PATCH", fmt.Sprintf("/api/records/%d", id), map[string]string{"viewpoint": "Hacked"})
	if len(history()) != 5 {
		t.Errorf("a rejected edit added a history entry")
	}
}

// ---- delete rules ----

func TestDeleteRules(t *testing.T) {
	e := newEnv(t)
	f := e.seed()
	rid, pid := f.rid, f.pid
	e.want(201, e.admin, "POST", fmt.Sprintf("/api/records/%d/images?kind=before", f.ids[0]), png)
	e.want(201, e.admin, "POST", fmt.Sprintf("/api/records/%d/images?kind=after", f.ids[1]), png)
	e.want(200, e.admin, "PUT", fmt.Sprintf("/api/reviews/%d/config", rid), map[string]any{"key": "target", "json": "2025-03-01"})
	filesOnDisk := func() int {
		list, _ := os.ReadDir(e.api.FilesDir)
		return len(list)
	}
	if filesOnDisk() != 2 {
		t.Fatalf("photo files: %d, want 2", filesOnDisk())
	}

	// a project that still has reviews cannot be deleted
	e.want(409, e.admin, "DELETE", fmt.Sprintf("/api/projects/%d", pid), nil)
	if e.count(`SELECT COUNT(*) FROM projects WHERE id=?`, pid) != 1 || len(e.records(rid)) != 3 {
		t.Fatalf("a refused project delete removed data")
	}

	// deleting a review removes its comments, photos, history and settings
	e.want(200, e.admin, "DELETE", fmt.Sprintf("/api/reviews/%d", rid), nil)
	for table, q := range map[string]string{
		"records":       `SELECT COUNT(*) FROM records`,
		"images":        `SELECT COUNT(*) FROM images`,
		"record_events": `SELECT COUNT(*) FROM record_events`,
		"review config": `SELECT COUNT(*) FROM config WHERE scope LIKE 'review:%'`,
		"reviews":       `SELECT COUNT(*) FROM reviews`,
	} {
		if n := e.count(q); n != 0 {
			t.Errorf("%s left after deleting the review: %d", table, n)
		}
	}
	if filesOnDisk() != 0 {
		t.Errorf("photo files left on disk: %d", filesOnDisk())
	}
	e.want(404, e.admin, "DELETE", fmt.Sprintf("/api/reviews/%d", rid), nil)

	// now the empty project can go
	e.want(200, e.admin, "DELETE", fmt.Sprintf("/api/projects/%d", pid), nil)
	if n := e.count(`SELECT COUNT(*) FROM projects`); n != 0 {
		t.Errorf("projects left: %d", n)
	}
}
