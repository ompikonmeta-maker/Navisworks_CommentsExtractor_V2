package db

import (
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
