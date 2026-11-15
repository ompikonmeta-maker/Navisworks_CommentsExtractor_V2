// Package db opens the SQLite database and applies the schema. Pure-Go driver
// (modernc.org/sqlite) so the server stays a single binary with no cgo and no
// admin install.
package db

import (
	"database/sql"
	_ "embed"
	"fmt"

	_ "modernc.org/sqlite"
)

//go:embed schema.sql
var schemaSQL string

// Open opens (creating if needed) the SQLite database at path, turns on WAL and
// foreign keys, and applies the schema. Safe to call on every startup.
func Open(path string) (*sql.DB, error) {
	// _pragma params are applied per connection by the modernc driver.
	dsn := fmt.Sprintf("file:%s?_pragma=journal_mode(WAL)&_pragma=foreign_keys(ON)&_pragma=busy_timeout(5000)", path)
	d, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// One writer at a time keeps SQLite happy under light concurrency.
	d.SetMaxOpenConns(1)
	if err := d.Ping(); err != nil {
		d.Close()
		return nil, err
	}
	if err := migrate(d); err != nil {
		d.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	if _, err := d.Exec(schemaSQL); err != nil {
		d.Close()
		return nil, fmt.Errorf("apply schema: %w", err)
	}
	if err := addRecordColumns(d); err != nil {
		d.Close()
		return nil, fmt.Errorf("add record columns: %w", err)
	}
	// Roles were simplified to admin | reviewer; older editor/viewer accounts
	// become reviewers.
	if _, err := d.Exec(`UPDATE users SET role='reviewer' WHERE role NOT IN ('admin','reviewer')`); err != nil {
		d.Close()
		return nil, fmt.Errorf("migrate roles: %w", err)
	}
	return d, nil
}

// addColumns adds columns introduced after a database may already exist —
// CREATE TABLE IF NOT EXISTS never adds columns to an existing table.
func addColumns(d *sql.DB, table string, cols []struct{ name, def string }) error {
	have := map[string]bool{}
	rows, err := d.Query(`SELECT name FROM pragma_table_info('` + table + `')`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var name string
		if rows.Scan(&name) == nil {
			have[name] = true
		}
	}
	rows.Close()
	for _, c := range cols {
		if have[c.name] {
			continue
		}
		if _, err := d.Exec(`ALTER TABLE ` + table + ` ADD COLUMN ` + c.name + ` ` + c.def); err != nil {
			return fmt.Errorf("%s.%s: %w", table, c.name, err)
		}
	}
	return nil
}

type col = struct{ name, def string }

// addRecordColumns brings an older database up to the current columns:
// record versions (Phase 2), the Trash (Phase 5: deleted_at/deleted_by on
// records and reviews) and per-project access (Phase 5: projects.restricted).
func addRecordColumns(d *sql.DB) error {
	steps := []struct {
		table string
		cols  []col
	}{
		{"records", []col{
			{"version", "INTEGER NOT NULL DEFAULT 1"},
			{"modified_at", "TEXT NOT NULL DEFAULT ''"},
			{"deleted_at", "TEXT NOT NULL DEFAULT ''"},
			{"deleted_by", "INTEGER"},
		}},
		{"reviews", []col{
			{"deleted_at", "TEXT NOT NULL DEFAULT ''"},
			{"deleted_by", "INTEGER"},
		}},
		{"projects", []col{
			{"restricted", "INTEGER NOT NULL DEFAULT 0"},
		}},
	}
	for _, s := range steps {
		if err := addColumns(d, s.table, s.cols); err != nil {
			return err
		}
	}
	for _, q := range []string{
		`CREATE INDEX IF NOT EXISTS idx_records_modified ON records(review_id, modified_at)`,
		`CREATE INDEX IF NOT EXISTS idx_records_deleted ON records(deleted_at)`,
	} {
		if _, err := d.Exec(q); err != nil {
			return err
		}
	}
	return nil
}

func tableExists(d *sql.DB, name string) bool {
	var n int
	d.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?`, name).Scan(&n)
	return n > 0
}

// migrate upgrades an install made before Project > Review existed. Back then
// the "projects" table held what are now reviews, and records/templates pointed
// at it via project_id. The old rows become reviews inside one "General"
// project, so nothing is lost; the admin can rename that project afterwards.
func migrate(d *sql.DB) error {
	if !tableExists(d, "projects") || tableExists(d, "reviews") {
		return nil // fresh install or already migrated
	}
	tx, err := d.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	steps := []string{
		`ALTER TABLE projects RENAME TO reviews`,
		`CREATE TABLE projects (
		   id         INTEGER PRIMARY KEY AUTOINCREMENT,
		   name       TEXT NOT NULL,
		   created_by INTEGER REFERENCES users(id),
		   created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
		`INSERT INTO projects(name, created_by) SELECT 'General', MIN(id) FROM users WHERE role='admin'`,
		`ALTER TABLE reviews ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE`,
		`UPDATE reviews SET project_id = (SELECT id FROM projects WHERE name='General' ORDER BY id LIMIT 1)`,
		`ALTER TABLE records RENAME COLUMN project_id TO review_id`,
		`DROP INDEX IF EXISTS idx_records_project`,
		`DROP TABLE IF EXISTS project_members`,
		// templates were never written by the API; recreate with the new scope.
		`DROP TABLE IF EXISTS templates`,
		// per-review settings saved so far (e.g. a target) move to the review scope.
		`UPDATE config SET scope = 'review:' || substr(scope, 9) WHERE scope LIKE 'project:%'`,
	}
	for _, q := range steps {
		if _, err := tx.Exec(q); err != nil {
			return fmt.Errorf("%s: %w", q[:40], err)
		}
	}
	return tx.Commit()
}
