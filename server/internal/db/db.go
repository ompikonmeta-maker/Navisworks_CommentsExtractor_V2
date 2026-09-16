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
	if _, err := d.Exec(schemaSQL); err != nil {
		d.Close()
		return nil, fmt.Errorf("apply schema: %w", err)
	}
	return d, nil
}
