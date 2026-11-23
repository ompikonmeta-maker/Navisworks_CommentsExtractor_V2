package api

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"tabelin/server/internal/auth"
	"tabelin/server/internal/db"
)

// ---- wrong-PIN limit ----

func useClock(t *testing.T, at *time.Time) {
	old := clock
	clock = func() time.Time { return *at }
	t.Cleanup(func() { clock = old })
}

func (e *env) pinTry(user, pin string) (int, string, string) {
	e.t.Helper()
	req, _ := http.NewRequest("POST", e.url+"/api/login", strings.NewReader(`{"username":"`+user+`","pin":"`+pin+`"}`))
	req.Header.Set("Content-Type", "application/json")
	res, err := e.anon.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer res.Body.Close()
	b := new(strings.Builder)
	buf := make([]byte, 512)
	for {
		n, err := res.Body.Read(buf)
		b.Write(buf[:n])
		if err != nil {
			break
		}
	}
	return res.StatusCode, res.Header.Get("Retry-After"), b.String()
}

func TestWrongPinsLockTheAccount(t *testing.T) {
	now := time.Date(2026, 11, 15, 9, 0, 0, 0, time.UTC)
	useClock(t, &now)
	e := newEnv(t) // rina's PIN is 2222

	for i := 1; i < maxPinFailures; i++ {
		if code, _, _ := e.pinTry("rina", "0000"); code != 401 {
			t.Fatalf("wrong PIN %d: status %d, want 401", i, code)
		}
	}
	code, retry, body := e.pinTry("rina", "0000")
	if code != 429 || retry != "300" || !strings.Contains(body, "Try again in 5 minutes") {
		t.Fatalf("5th wrong PIN: %d retry=%q %s", code, retry, body)
	}
	// locked: even the right PIN is refused, and it says how long is left
	now = now.Add(2*time.Minute + 10*time.Second)
	if code, retry, body := e.pinTry("rina", "2222"); code != 429 || retry != "170" || !strings.Contains(body, "3 minutes") {
		t.Errorf("right PIN while locked: %d retry=%q %s", code, retry, body)
	}
	// another account is not affected
	if code, _, _ := e.pinTry("boss", "1111"); code != 200 {
		t.Errorf("other account while rina is locked: %d", code)
	}
	// after the lock the right PIN works and the count starts again
	now = now.Add(3 * time.Minute)
	if code, _, _ := e.pinTry("rina", "2222"); code != 200 {
		t.Fatalf("right PIN after the lock: %d", code)
	}
	for i := 1; i < maxPinFailures; i++ {
		e.pinTry("rina", "0000")
	}
	if code, _, _ := e.pinTry("rina", "2222"); code != 200 {
		t.Errorf("4 wrong then right: %d, want 200 (a success clears the count)", code)
	}
	for i := 1; i < maxPinFailures; i++ {
		if code, _, _ := e.pinTry("rina", "0000"); code != 401 {
			t.Errorf("count did not start again after a success (try %d → %d)", i, code)
		}
	}
}

func TestAdminResetLiftsTheLock(t *testing.T) {
	now := time.Date(2026, 11, 15, 9, 0, 0, 0, time.UTC)
	useClock(t, &now)
	e := newEnv(t)
	for i := 0; i < maxPinFailures; i++ {
		e.pinTry("rina", "0000")
	}
	if code, _, _ := e.pinTry("rina", "2222"); code != 429 {
		t.Fatalf("not locked: %d", code)
	}
	var id int64
	e.db.QueryRow(`SELECT id FROM users WHERE username='rina'`).Scan(&id)
	e.want(200, e.admin, "POST", "/api/users/"+itoa(id)+"/reset-pin", nil)
	// the next sign-in sets a new PIN
	if code, _, _ := e.pinTry("rina", "5555"); code != 200 {
		t.Errorf("sign-in after reset: %d", code)
	}
	if n := e.count(`SELECT COUNT(*) FROM pin_attempts`); n != 0 {
		t.Errorf("attempt rows left: %d", n)
	}
}

func TestUnknownAccountsAreNotCounted(t *testing.T) {
	e := newEnv(t)
	for i := 0; i < maxPinFailures+2; i++ {
		if code, _, _ := e.pinTry("nobody", "0000"); code != 401 {
			t.Fatalf("unknown account: %d, want 401", code)
		}
	}
	if n := e.count(`SELECT COUNT(*) FROM pin_attempts`); n != 0 {
		t.Errorf("attempt rows for an unknown account: %d", n)
	}
}

func itoa(n int64) string { return strconv.FormatInt(n, 10) }

// ---- Trash ----

type trashList struct {
	Reviews []trashedReview `json:"reviews"`
	Records []trashedRecord `json:"records"`
	Days    int             `json:"days"`
}

func TestDeletedCommentsGoToTheTrash(t *testing.T) {
	now := time.Date(2026, 11, 15, 9, 0, 0, 0, time.UTC)
	useClock(t, &now)
	e := newEnv(t)
	f := e.seed()
	e.want(201, e.admin, "POST", fmt.Sprintf("/api/records/%d/images?kind=after", f.ids[0]), png)

	e.want(200, e.admin, "DELETE", fmt.Sprintf("/api/records/%d", f.ids[0]), nil)
	e.want(200, e.admin, "POST", fmt.Sprintf("/api/reviews/%d/records/delete", f.rid), map[string]any{"ids": []int64{f.ids[1]}})

	// gone from the review, its routes and the refresh
	if n := len(e.records(f.rid)); n != 1 {
		t.Fatalf("records after deleting two: %d, want 1", n)
	}
	for _, p := range []string{"/api/records/%d", "/api/records/%d/history"} {
		e.want(404, e.reviewer, "GET", fmt.Sprintf(p, f.ids[0]), nil)
	}
	e.want(404, e.reviewer, "PATCH", fmt.Sprintf("/api/records/%d", f.ids[0]), map[string]string{"status": "Closed"})
	ch := decode[changes](t, e.want(200, e.reviewer, "GET", fmt.Sprintf("/api/reviews/%d/records?since=", f.rid), nil))
	if len(ch.IDs) != 1 || len(ch.Records) != 1 {
		t.Errorf("refresh still sees deleted comments: %v", ch.IDs)
	}
	// the photo of a deleted comment is not served
	var key string
	e.db.QueryRow(`SELECT file_key FROM images WHERE record_id=?`, f.ids[0]).Scan(&key)
	e.want(404, e.reviewer, "GET", "/api/files/"+key, nil)

	// only admins see the Trash
	e.want(403, e.reviewer, "GET", "/api/trash", nil)
	tr := decode[trashList](t, e.want(200, e.admin, "GET", "/api/trash", nil))
	if len(tr.Records) != 2 || tr.Days != 30 || tr.Records[0].DeletedBy != "Boss" || tr.Records[0].ReviewName != "Review 1" {
		t.Fatalf("trash = %+v", tr)
	}
	if tr.Records[0].PurgeAt != "2026-12-15T09:00:00Z" {
		t.Errorf("purgeAt = %q", tr.Records[0].PurgeAt)
	}

	// restore one: it is back, with its photo, and the others' refresh picks it up
	e.want(403, e.reviewer, "POST", "/api/trash/restore", map[string]any{"records": []int64{f.ids[0]}})
	e.want(200, e.admin, "POST", "/api/trash/restore", map[string]any{"records": []int64{f.ids[0]}})
	r := e.record(f.rid, f.ids[0])
	if r.AfterURL == "" || r.Version < 3 {
		t.Errorf("restored comment = %+v", r)
	}
	e.want(200, e.reviewer, "GET", "/api/files/"+key, nil)
	h := decode[[]event](t, e.want(200, e.reviewer, "GET", fmt.Sprintf("/api/records/%d/history", f.ids[0]), nil))
	if h[0].Action != "restore" || h[1].Action != "delete" {
		t.Errorf("history = %+v", h[:2])
	}

	// delete the other for good
	e.want(200, e.admin, "POST", "/api/trash/purge", map[string]any{"records": []int64{f.ids[1]}})
	if n := e.count(`SELECT COUNT(*) FROM records WHERE id=?`, f.ids[1]); n != 0 {
		t.Errorf("purged comment still in the database")
	}
	// a live comment can't be purged through the Trash
	e.want(200, e.admin, "POST", "/api/trash/purge", map[string]any{"records": []int64{f.ids[2]}})
	if n := len(e.records(f.rid)); n != 2 {
		t.Errorf("a live comment was purged: %d left", n)
	}
}

func TestTrashExpiresAfter30Days(t *testing.T) {
	now := time.Date(2026, 11, 15, 9, 0, 0, 0, time.UTC)
	useClock(t, &now)
	e := newEnv(t)
	f := e.seed()
	e.want(201, e.admin, "POST", fmt.Sprintf("/api/records/%d/images?kind=after", f.ids[0]), png)
	e.want(200, e.admin, "DELETE", fmt.Sprintf("/api/records/%d", f.ids[0]), nil)
	now = now.Add(29 * 24 * time.Hour)
	if tr := decode[trashList](t, e.want(200, e.admin, "GET", "/api/trash", nil)); len(tr.Records) != 1 {
		t.Fatalf("after 29 days: %d in the Trash, want 1", len(tr.Records))
	}
	now = now.Add(2 * 24 * time.Hour)
	if tr := decode[trashList](t, e.want(200, e.admin, "GET", "/api/trash", nil)); len(tr.Records) != 0 {
		t.Errorf("after 31 days: %d in the Trash, want 0", len(tr.Records))
	}
	if n := e.count(`SELECT COUNT(*) FROM images`); n != 0 {
		t.Errorf("photo rows left: %d", n)
	}
	if list, _ := os.ReadDir(e.api.FilesDir); len(list) != 0 {
		t.Errorf("photo files left: %d", len(list))
	}
}

func TestDeletedReviewsGoToTheTrash(t *testing.T) {
	e := newEnv(t)
	f := e.seed()
	e.want(200, e.admin, "DELETE", fmt.Sprintf("/api/records/%d", f.ids[2]), nil) // one comment already in the Trash
	e.want(200, e.admin, "DELETE", fmt.Sprintf("/api/reviews/%d", f.rid), nil)

	projects := decode[[]map[string]any](t, e.want(200, e.reviewer, "GET", "/api/projects", nil))
	if projects[0]["reviews"].(float64) != 0 {
		t.Errorf("project still counts the deleted review: %v", projects[0])
	}
	e.want(404, e.reviewer, "GET", fmt.Sprintf("/api/reviews/%d/config", f.rid), nil)
	tr := decode[trashList](t, e.want(200, e.admin, "GET", "/api/trash", nil))
	if len(tr.Reviews) != 1 || tr.Reviews[0].Comments != 2 || tr.Reviews[0].ProjectName != "Project A" {
		t.Fatalf("trash reviews = %+v", tr.Reviews)
	}
	if len(tr.Records) != 0 {
		t.Errorf("comments of a deleted review are listed separately: %+v", tr.Records)
	}
	// a comment of a deleted review can't be restored on its own
	e.want(200, e.admin, "POST", "/api/trash/restore", map[string]any{"records": []int64{f.ids[2]}})
	e.want(404, e.admin, "GET", fmt.Sprintf("/api/records/%d", f.ids[2]), nil)

	// restoring the review brings back its comments (not the one deleted before)
	e.want(200, e.admin, "POST", "/api/trash/restore", map[string]any{"reviews": []int64{f.rid}})
	if n := len(e.records(f.rid)); n != 2 {
		t.Errorf("comments after restoring the review: %d, want 2", n)
	}
	if tr := decode[trashList](t, e.want(200, e.admin, "GET", "/api/trash", nil)); len(tr.Records) != 1 {
		t.Errorf("the comment deleted before should still be in the Trash: %+v", tr)
	}
}

func TestUndoImportDeletesForGood(t *testing.T) {
	e := newEnv(t)
	f := e.seed()
	e.want(200, e.admin, "POST", fmt.Sprintf("/api/reviews/%d/records/delete?forGood=1", f.rid), map[string]any{"ids": f.ids[:2]})
	if n := e.count(`SELECT COUNT(*) FROM records`); n != 1 {
		t.Errorf("records left: %d, want 1", n)
	}
	if tr := decode[trashList](t, e.want(200, e.admin, "GET", "/api/trash", nil)); len(tr.Records) != 0 {
		t.Errorf("an undone import landed in the Trash")
	}
}

// ---- per-project access ----

func TestRestrictedProjects(t *testing.T) {
	e := newEnv(t)
	f := e.seed()
	other := e.seed() // a second project the reviewer can keep seeing
	var rina int64
	e.db.QueryRow(`SELECT id FROM users WHERE username='rina'`).Scan(&rina)
	e.want(201, e.admin, "POST", fmt.Sprintf("/api/records/%d/images?kind=after", f.ids[0]), png)
	var key string
	e.db.QueryRow(`SELECT file_key FROM images WHERE record_id=?`, f.ids[0]).Scan(&key)
	e.want(200, e.admin, "PUT", fmt.Sprintf("/api/projects/%d/template?name=t.xlsx", f.pid), []byte("PK"), "application/octet-stream")

	// unrestricted by default: everyone sees both
	if n := len(decode[[]map[string]any](t, e.want(200, e.reviewer, "GET", "/api/projects", nil))); n != 2 {
		t.Fatalf("projects seen by the reviewer: %d, want 2", n)
	}
	acc := decode[struct {
		Restricted bool    `json:"restricted"`
		Members    []int64 `json:"members"`
	}](t, e.want(200, e.admin, "GET", fmt.Sprintf("/api/projects/%d/access", f.pid), nil))
	if acc.Restricted || len(acc.Members) != 0 {
		t.Errorf("default access = %+v", acc)
	}

	// restrict the first project to nobody but admins
	e.want(403, e.reviewer, "PUT", fmt.Sprintf("/api/projects/%d/access", f.pid), map[string]any{"restricted": true})
	e.want(200, e.admin, "PUT", fmt.Sprintf("/api/projects/%d/access", f.pid), map[string]any{"restricted": true, "members": []int64{}})
	projects := decode[[]map[string]any](t, e.want(200, e.reviewer, "GET", "/api/projects", nil))
	if len(projects) != 1 || int64(projects[0]["id"].(float64)) != other.pid {
		t.Fatalf("reviewer sees %v, want only the other project", projects)
	}
	hidden := []struct{ method, path string }{
		{"GET", fmt.Sprintf("/api/projects/%d/reviews", f.pid)},
		{"GET", fmt.Sprintf("/api/projects/%d/config", f.pid)},
		{"GET", fmt.Sprintf("/api/projects/%d/template", f.pid)},
		{"GET", fmt.Sprintf("/api/reviews/%d/records", f.rid)},
		{"GET", fmt.Sprintf("/api/reviews/%d/records?since=", f.rid)},
		{"GET", fmt.Sprintf("/api/reviews/%d/config", f.rid)},
		{"GET", fmt.Sprintf("/api/records/%d", f.ids[0])},
		{"GET", fmt.Sprintf("/api/records/%d/history", f.ids[0])},
		{"GET", "/api/files/" + key},
		{"PATCH", fmt.Sprintf("/api/records/%d", f.ids[0])},
		{"POST", fmt.Sprintf("/api/records/%d/images?kind=after", f.ids[0])},
	}
	for _, h := range hidden {
		var body any
		if h.method == "PATCH" {
			body = map[string]string{"status": "Closed"}
		}
		if h.method == "POST" {
			body = png
		}
		e.want(404, e.reviewer, h.method, h.path, body)
	}
	// admins still see everything; the other project is untouched
	e.want(200, e.admin, "GET", fmt.Sprintf("/api/reviews/%d/records", f.rid), nil)
	e.want(200, e.reviewer, "GET", fmt.Sprintf("/api/reviews/%d/records", other.rid), nil)

	// make Rina a member: she is back in
	e.want(200, e.admin, "PUT", fmt.Sprintf("/api/projects/%d/access", f.pid), map[string]any{"restricted": true, "members": []int64{rina, 9999}})
	acc = decode[struct {
		Restricted bool    `json:"restricted"`
		Members    []int64 `json:"members"`
	}](t, e.want(200, e.admin, "GET", fmt.Sprintf("/api/projects/%d/access", f.pid), nil))
	if !acc.Restricted || fmt.Sprint(acc.Members) != fmt.Sprint([]int64{rina}) {
		t.Errorf("access after adding rina (and an unknown id) = %+v", acc)
	}
	for _, h := range hidden[:9] {
		e.want(200, e.reviewer, "GET", h.path, nil)
	}
	e.want(200, e.reviewer, "PATCH", fmt.Sprintf("/api/records/%d", f.ids[0]), map[string]string{"status": "Closed"})
	projects = decode[[]map[string]any](t, e.want(200, e.reviewer, "GET", "/api/projects", nil))
	if len(projects) != 2 {
		t.Errorf("reviewer sees %d projects after joining, want 2", len(projects))
	}
	for _, p := range decode[[]map[string]any](t, e.want(200, e.admin, "GET", "/api/projects", nil)) {
		if int64(p["id"].(float64)) == f.pid && (p["restricted"] != true || p["members"].(float64) != 1) {
			t.Errorf("project list for the admin = %v, want restricted with 1 member", p)
		}
	}
	// open it again
	e.want(200, e.admin, "PUT", fmt.Sprintf("/api/projects/%d/access", f.pid), map[string]any{"restricted": false})
	e.want(404, e.admin, "GET", "/api/projects/9999/access", nil)
}

// ---- backup and restore ----

func TestBackupRestores(t *testing.T) {
	e := newEnv(t)
	f := e.seed()
	e.want(201, e.admin, "POST", fmt.Sprintf("/api/records/%d/images?kind=after", f.ids[0]), png)
	e.want(200, e.reviewer, "PATCH", fmt.Sprintf("/api/records/%d", f.ids[1]), map[string]string{"resolution": "kept in the backup"})

	e.want(403, e.reviewer, "GET", "/api/backup", nil)
	req, _ := http.NewRequest("GET", e.url+"/api/backup", nil)
	res, err := e.admin.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	zipBytes, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != 200 || !strings.HasPrefix(res.Header.Get("Content-Disposition"), `attachment; filename="tabelin-backup-`) {
		t.Fatalf("backup: %d %q", res.StatusCode, res.Header.Get("Content-Disposition"))
	}

	// restore: unpack into an empty data folder, open it, and serve it
	zr, err := zip.NewReader(bytes.NewReader(zipBytes), int64(len(zipBytes)))
	if err != nil {
		t.Fatalf("not a zip: %v", err)
	}
	data := t.TempDir()
	os.MkdirAll(filepath.Join(data, "files"), 0o755)
	names := []string{}
	for _, zf := range zr.File {
		names = append(names, zf.Name)
		rc, _ := zf.Open()
		b, _ := io.ReadAll(rc)
		rc.Close()
		if err := os.WriteFile(filepath.Join(data, filepath.FromSlash(zf.Name)), b, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if fmt.Sprint(names) == "" || names[0] != "tabelin.db" || names[len(names)-1] != "RESTORE.txt" {
		t.Errorf("zip entries = %v", names)
	}
	d2, err := db.Open(filepath.Join(data, "tabelin.db"))
	if err != nil {
		t.Fatalf("open restored db: %v", err)
	}
	defer d2.Close()
	a2 := &API{DB: d2, FilesDir: filepath.Join(data, "files"), ServerURLs: func() []string { return nil }}
	root := http.NewServeMux()
	root.HandleFunc("POST /api/login", a2.Login)
	root.Handle("/api/", auth.Middleware(a2.Identify, a2.ResolveUser)(a2.Routes()))
	srv := httptest.NewServer(root)
	defer srv.Close()
	e2 := &env{t: t, api: a2, db: d2, url: srv.URL, anon: srv.Client()}
	e2.reviewer = e2.login("rina", "2222") // the PIN came along
	e2.admin = e2.login("boss", "1111")
	recs := e2.records(f.rid)
	if len(recs) != 3 {
		t.Fatalf("restored records: %d, want 3", len(recs))
	}
	byID := map[int64]Record{}
	for _, r := range recs {
		byID[r.ID] = r
	}
	if byID[f.ids[1]].Resolution != "kept in the backup" {
		t.Errorf("restored resolution = %q", byID[f.ids[1]].Resolution)
	}
	if got := e2.want(200, e2.reviewer, "GET", byID[f.ids[0]].AfterURL, nil); !bytes.Equal(got, png) {
		t.Errorf("restored photo differs")
	}
}

func TestResetPINFromTheCommandLine(t *testing.T) {
	now := time.Date(2026, 11, 23, 9, 0, 0, 0, time.UTC)
	useClock(t, &now)
	e := newEnv(t)
	for i := 0; i < maxPinFailures; i++ {
		e.pinTry("boss", "0000")
	}
	if code, _, _ := e.pinTry("boss", "1111"); code != 429 {
		t.Fatalf("not locked: %d", code)
	}
	if err := ResetPIN(e.db, " BOSS "); err != nil {
		t.Fatal(err)
	}
	e.want(401, e.admin, "GET", "/api/me", nil) // signed out everywhere
	if code, _, _ := e.pinTry("boss", "4321"); code != 200 {
		t.Errorf("sign-in with a new PIN after the reset: %d", code)
	}
	if code, _, _ := e.pinTry("boss", "1111"); code != 401 {
		t.Errorf("the old PIN still works: %d", code)
	}
	if err := ResetPIN(e.db, "nobody"); err == nil {
		t.Errorf("resetting an unknown account should fail")
	}
}
