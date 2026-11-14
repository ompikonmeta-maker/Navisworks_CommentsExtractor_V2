package api

import (
	"fmt"
	"net/http"
	"testing"
	"time"
)

// ---- create one comment ----

func TestCreateOneRecord(t *testing.T) {
	e := newEnv(t)
	f := e.seed()
	path := fmt.Sprintf("/api/reviews/%d/records/one", f.rid)
	body := map[string]any{"viewpoint": "Manual VP", "commentRaw": "typed", "commentText": "typed", "status": "Open", "source": "manual", "extra": map[string]string{"cf_x": "1"}}

	e.want(403, e.reviewer, "POST", path, body)
	e.want(404, e.admin, "POST", "/api/reviews/999/records/one", body)

	rec := decode[Record](t, e.want(201, e.admin, "POST", path, body))
	if rec.ID == 0 || rec.ReviewID != f.rid || rec.Viewpoint != "Manual VP" || rec.Source != "manual" || rec.Version != 1 {
		t.Fatalf("created = %+v", rec)
	}
	if got := decode[map[string]string](t, rec.Extra); got["cf_x"] != "1" {
		t.Errorf("extra = %s", rec.Extra)
	}
	if n := len(e.records(f.rid)); n != 4 {
		t.Errorf("records after create: %d, want 4", n)
	}
	h := decode[[]event](t, e.want(200, e.reviewer, "GET", fmt.Sprintf("/api/records/%d/history", rec.ID), nil))
	if len(h) != 1 || h[0].Action != "import" || h[0].Detail["source"] != "manual" {
		t.Errorf("history = %+v", h)
	}
	// readable on its own
	if got := decode[Record](t, e.want(200, e.reviewer, "GET", fmt.Sprintf("/api/records/%d", rec.ID), nil)); got.ID != rec.ID {
		t.Errorf("GET one = %+v", got)
	}
	e.want(404, e.reviewer, "GET", "/api/records/9999", nil)
}

func TestImportReturnsIDsInOrder(t *testing.T) {
	e := newEnv(t)
	f := e.seed()
	out := decode[struct {
		Imported int     `json:"imported"`
		IDs      []int64 `json:"ids"`
	}](t, e.want(201, e.admin, "POST", fmt.Sprintf("/api/reviews/%d/records", f.rid), map[string]any{"records": sampleRecords()}))
	if out.Imported != 3 || len(out.IDs) != 3 {
		t.Fatalf("import answer = %+v", out)
	}
	for i, id := range out.IDs {
		r := e.record(f.rid, id)
		if want := sampleRecords()[i]["commentId"]; r.CommentID != want {
			t.Errorf("id %d is comment %q, want %q", id, r.CommentID, want)
		}
	}
	e.want(404, e.admin, "POST", "/api/reviews/999/records", map[string]any{"records": sampleRecords()})
}

// ---- versions ----

type patchAnswer struct {
	OK     bool   `json:"ok"`
	Record Record `json:"record"`
}
type conflictAnswer struct {
	Error  string `json:"error"`
	Record Record `json:"record"`
}

func TestVersionStopsSilentOverwrite(t *testing.T) {
	e := newEnv(t)
	f := e.seed()
	id := f.ids[0]
	path := fmt.Sprintf("/api/records/%d", id)
	if v := e.record(f.rid, id).Version; v != 1 {
		t.Fatalf("new record version %d, want 1", v)
	}

	// Rina and Boss both opened version 1. Rina saves first.
	a := decode[patchAnswer](t, e.want(200, e.reviewer, "PATCH", path, map[string]any{"version": 1, "resolution": "Rina's text"}))
	if a.Record.Version != 2 || a.Record.Resolution != "Rina's text" {
		t.Fatalf("first save answer = %+v", a)
	}
	// Boss saves against version 1 → refused, with the current record.
	c := decode[conflictAnswer](t, e.want(409, e.admin, "PATCH", path, map[string]any{"version": 1, "resolution": "Boss's text", "status": "Closed"}))
	if c.Record.Version != 2 || c.Record.Resolution != "Rina's text" || c.Record.Status != "Open" {
		t.Errorf("conflict answer = %+v", c.Record)
	}
	if r := e.record(f.rid, id); r.Resolution != "Rina's text" || r.Status != "Open" || r.Version != 2 {
		t.Errorf("a refused save changed the record: %+v", r)
	}
	// Boss saves again against the version he now has.
	b := decode[patchAnswer](t, e.want(200, e.admin, "PATCH", path, map[string]any{"version": 2, "status": "Closed"}))
	if b.Record.Version != 3 || b.Record.Status != "Closed" || b.Record.Resolution != "Rina's text" {
		t.Errorf("second save answer = %+v", b.Record)
	}
	// A save without a version still works (older clients, imports).
	e.want(200, e.reviewer, "PATCH", path, map[string]any{"resolution": "no version"})
	if r := e.record(f.rid, id); r.Version != 4 {
		t.Errorf("version after unversioned save: %d, want 4", r.Version)
	}
	e.want(400, e.reviewer, "PATCH", path, map[string]any{"version": "x", "resolution": "y"})

	// Only the successful saves are in the history.
	if n := e.count(`SELECT COUNT(*) FROM record_events WHERE record_id=? AND action='edit'`, id); n != 3 {
		t.Errorf("edit history rows: %d, want 3", n)
	}
}

func TestPhotosBumpTheVersion(t *testing.T) {
	e := newEnv(t)
	f := e.seed()
	id := f.ids[0]
	up := decode[struct{ Version int64 }](t, e.want(201, e.reviewer, "POST", fmt.Sprintf("/api/records/%d/images?kind=after", id), png))
	if up.Version != 2 || e.record(f.rid, id).Version != 2 {
		t.Errorf("after photo upload: answer %d, record %d, want 2", up.Version, e.record(f.rid, id).Version)
	}
	del := decode[struct{ Version int64 }](t, e.want(200, e.reviewer, "DELETE", fmt.Sprintf("/api/records/%d/images?kind=after", id), nil))
	if del.Version != 3 {
		t.Errorf("after photo removal: version %d, want 3", del.Version)
	}
	// removing a photo that isn't there changes nothing
	again := decode[struct{ Version int64 }](t, e.want(200, e.reviewer, "DELETE", fmt.Sprintf("/api/records/%d/images?kind=after", id), nil))
	if again.Version != 3 {
		t.Errorf("no-op removal: version %d, want 3", again.Version)
	}
	// so a client that saw version 1 is now stale
	e.want(409, e.reviewer, "PATCH", fmt.Sprintf("/api/records/%d", id), map[string]any{"version": 1, "status": "Closed"})
}

func TestBulkEditSkipsStaleRows(t *testing.T) {
	e := newEnv(t)
	f := e.seed()
	// someone changes the second comment first
	e.want(200, e.admin, "PATCH", fmt.Sprintf("/api/records/%d", f.ids[1]), map[string]any{"resolution": "admin was here"})

	out := decode[struct {
		Updated   int              `json:"updated"`
		Versions  map[string]int64 `json:"versions"`
		Conflicts []Record         `json:"conflicts"`
	}](t, e.want(200, e.reviewer, "PATCH", fmt.Sprintf("/api/reviews/%d/records", f.rid), map[string]any{"updates": []map[string]any{
		{"id": f.ids[0], "version": 1, "patch": map[string]string{"discipline": "ELE"}},
		{"id": f.ids[1], "version": 1, "patch": map[string]string{"discipline": "ELE"}}, // stale
		{"id": f.ids[2], "patch": map[string]string{"discipline": "ELE"}},               // no version: always saved
	}}))
	if out.Updated != 2 {
		t.Errorf("updated %d, want 2", out.Updated)
	}
	if out.Versions[fmt.Sprint(f.ids[0])] != 2 || out.Versions[fmt.Sprint(f.ids[2])] != 2 || len(out.Versions) != 2 {
		t.Errorf("versions = %v", out.Versions)
	}
	if len(out.Conflicts) != 1 || out.Conflicts[0].ID != f.ids[1] || out.Conflicts[0].Resolution != "admin was here" || out.Conflicts[0].Version != 2 {
		t.Errorf("conflicts = %+v", out.Conflicts)
	}
	if r := e.record(f.rid, f.ids[1]); r.Discipline != "OTHER" {
		t.Errorf("stale row was changed: discipline %q", r.Discipline)
	}
}

// ---- light refresh ----

type changes struct {
	Records []Record `json:"records"`
	IDs     []int64  `json:"ids"`
	Next    string   `json:"next"`
}

func TestRefreshSince(t *testing.T) {
	old := refreshOverlap
	refreshOverlap = 0
	t.Cleanup(func() { refreshOverlap = old })

	e := newEnv(t)
	f := e.seed()
	base := fmt.Sprintf("/api/reviews/%d/records?since=", f.rid)
	get := func(since string) changes {
		return decode[changes](t, e.want(200, e.reviewer, "GET", base+since, nil))
	}

	all := get("")
	if len(all.Records) != 3 || len(all.IDs) != 3 || all.Next == "" {
		t.Fatalf("since='' = %+v", all)
	}
	if _, err := time.Parse(time.RFC3339Nano, all.Next); err != nil {
		t.Errorf("next %q is not a time: %v", all.Next, err)
	}
	time.Sleep(5 * time.Millisecond)

	if quiet := get(all.Next); len(quiet.Records) != 0 || len(quiet.IDs) != 3 {
		t.Errorf("nothing changed, got %d records, %d ids", len(quiet.Records), len(quiet.IDs))
	}

	// an edit, a photo, a new comment and a delete all show up
	e.want(200, e.reviewer, "PATCH", fmt.Sprintf("/api/records/%d", f.ids[0]), map[string]string{"status": "Closed"})
	e.want(201, e.reviewer, "POST", fmt.Sprintf("/api/records/%d/images?kind=after", f.ids[1]), png)
	added := decode[Record](t, e.want(201, e.admin, "POST", fmt.Sprintf("/api/reviews/%d/records/one", f.rid), map[string]any{"viewpoint": "New", "source": "manual"}))
	e.want(200, e.admin, "DELETE", fmt.Sprintf("/api/records/%d", f.ids[2]), nil)

	ch := get(all.Next)
	got := map[int64]Record{}
	for _, r := range ch.Records {
		got[r.ID] = r
	}
	if len(got) != 3 || got[f.ids[0]].Status != "Closed" || got[f.ids[1]].AfterURL == "" || got[added.ID].Viewpoint != "New" {
		t.Errorf("changed records = %+v", ch.Records)
	}
	if fmt.Sprint(ch.IDs) != fmt.Sprint([]int64{f.ids[0], f.ids[1], added.ID}) {
		t.Errorf("ids = %v (the deleted comment must be gone)", ch.IDs)
	}

	// the plain list still answers a bare array
	if n := len(e.records(f.rid)); n != 3 {
		t.Errorf("plain list: %d records", n)
	}
	e.want(http.StatusBadRequest, e.reviewer, "GET", base+"yesterday", nil)
}

// The default overlap re-sends recent changes; that is harmless because the
// client compares versions.
func TestRefreshOverlapRepeatsRecentChanges(t *testing.T) {
	e := newEnv(t)
	f := e.seed()
	first := decode[changes](t, e.want(200, e.reviewer, "GET", fmt.Sprintf("/api/reviews/%d/records?since=", f.rid), nil))
	again := decode[changes](t, e.want(200, e.reviewer, "GET", fmt.Sprintf("/api/reviews/%d/records?since=%s", f.rid, first.Next), nil))
	if len(again.Records) != 3 {
		t.Errorf("records within the overlap: %d, want 3", len(again.Records))
	}
}
