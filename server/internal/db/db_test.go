package db

import (
	"database/sql"
	"path/filepath"
	"testing"
)

// A database from before the roles were simplified (admin / editor / viewer)
// must open with every non-admin account as a reviewer.
func TestOpenMigratesOldRolesToReviewer(t *testing.T) {
	path := filepath.Join(t.TempDir(), "tabelin.db")
	d, err := Open(path)
	if err != nil {
		t.Fatalf("open new db: %v", err)
	}
	for name, role := range map[string]string{"boss": "admin", "edi": "editor", "vina": "viewer", "rina": "reviewer"} {
		if _, err := d.Exec(`INSERT INTO users(username, role) VALUES(?, ?)`, name, role); err != nil {
			t.Fatalf("insert %s: %v", name, err)
		}
	}
	d.Close()

	d, err = Open(path)
	if err != nil {
		t.Fatalf("reopen db: %v", err)
	}
	defer d.Close()
	want := map[string]string{"boss": "admin", "edi": "reviewer", "vina": "reviewer", "rina": "reviewer"}
	rows, err := d.Query(`SELECT username, role FROM users`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		var name, role string
		rows.Scan(&name, &role)
		n++
		if want[name] != role {
			t.Errorf("user %s: role %q, want %q", name, role, want[name])
		}
	}
	if n != len(want) {
		t.Errorf("got %d users, want %d", n, len(want))
	}
}

// Opening the same database twice must not lose anything.
func TestOpenIsRepeatable(t *testing.T) {
	path := filepath.Join(t.TempDir(), "tabelin.db")
	d, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	d.Exec(`INSERT INTO users(username, role) VALUES('boss', 'admin')`)
	d.Exec(`INSERT INTO projects(name) VALUES('P')`)
	d.Exec(`INSERT INTO reviews(project_id, name) VALUES(1, 'R')`)
	d.Exec(`INSERT INTO records(review_id, comment_id, status) VALUES(1, '7', 'Open')`)
	d.Close()
	for i := 0; i < 2; i++ {
		if d, err = Open(path); err != nil {
			t.Fatalf("reopen %d: %v", i, err)
		}
		var n int
		d.QueryRow(`SELECT COUNT(*) FROM records WHERE review_id=1 AND comment_id='7'`).Scan(&n)
		d.Close()
		if n != 1 {
			t.Fatalf("reopen %d: record count %d, want 1", i, n)
		}
	}
}

// A database from before record versions gets the new columns on open, and
// its records start at version 1.
func TestOpenAddsVersionColumns(t *testing.T) {
	path := filepath.Join(t.TempDir(), "tabelin.db")
	raw, err := sql.Open("sqlite", "file:"+path)
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		`CREATE TABLE projects (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
		`CREATE TABLE reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, name TEXT NOT NULL, created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
		`CREATE TABLE records (id INTEGER PRIMARY KEY AUTOINCREMENT, review_id INTEGER NOT NULL, comment_id TEXT, viewpoint TEXT,
		   commenter TEXT, discipline TEXT, comment_raw TEXT, comment_text TEXT, resolution TEXT, status TEXT, closed_at TEXT,
		   comment_date TEXT, author_code TEXT, camera_position TEXT, image_ref TEXT, source TEXT, extra TEXT NOT NULL DEFAULT '{}',
		   updated_by INTEGER, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
		`INSERT INTO projects(name) VALUES('P')`,
		`INSERT INTO reviews(project_id, name) VALUES(1, 'R')`,
		`INSERT INTO records(review_id, comment_id, status) VALUES(1, '7', 'Open')`,
	} {
		if _, err := raw.Exec(q); err != nil {
			t.Fatalf("%s: %v", q[:30], err)
		}
	}
	raw.Close()

	d, err := Open(path)
	if err != nil {
		t.Fatalf("open old db: %v", err)
	}
	defer d.Close()
	var version int
	var mod string
	if err := d.QueryRow(`SELECT version, modified_at FROM records WHERE comment_id='7'`).Scan(&version, &mod); err != nil {
		t.Fatalf("read new columns: %v", err)
	}
	if version != 1 || mod != "" {
		t.Errorf("version=%d modified_at=%q, want 1 and empty", version, mod)
	}
	// Phase 5 columns: nothing is in the Trash and no project is restricted
	var recDel, revDel string
	var restricted int
	if err := d.QueryRow(`SELECT r.deleted_at, v.deleted_at, p.restricted FROM records r JOIN reviews v ON v.id = r.review_id JOIN projects p ON p.id = v.project_id`).Scan(&recDel, &revDel, &restricted); err != nil {
		t.Fatalf("read Phase 5 columns: %v", err)
	}
	if recDel != "" || revDel != "" || restricted != 0 {
		t.Errorf("deleted_at=%q/%q restricted=%d, want empty and 0", recDel, revDel, restricted)
	}
	if !tableExists(d, "project_members") || !tableExists(d, "pin_attempts") {
		t.Errorf("Phase 5 tables missing")
	}
	d.Close()
	if d, err = Open(path); err != nil { // a second open must not try to add them again
		t.Fatalf("reopen: %v", err)
	}
}
