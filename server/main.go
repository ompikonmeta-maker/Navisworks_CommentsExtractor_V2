// Tabelin V2 server — a single self-contained binary that serves the React SPA,
// a small JSON API, and stores everything in a local SQLite file plus a data
// folder on disk. Designed to run on one office machine with no admin install;
// user identity comes from the office AD account (a dev header stands in until
// the Windows Integrated Auth handshake is wired on the network).
package main

import (
	"database/sql"
	"embed"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"tabelin/server/internal/api"
	"tabelin/server/internal/auth"
	"tabelin/server/internal/db"
)

// The built SPA is copied into web/ before `go build` (see server/README.md).
//
//go:embed all:web
var webFS embed.FS

const version = "2.0.0-dev"

func main() {
	addr := env("TABELIN_ADDR", ":8787")
	dataDir := env("TABELIN_DATA", "./data")

	if err := os.MkdirAll(filepath.Join(dataDir, "files"), 0o755); err != nil {
		log.Fatalf("create data dir: %v", err)
	}
	database, err := db.Open(filepath.Join(dataDir, "tabelin.db"))
	if err != nil {
		log.Fatalf("open db: %v", err)
	}
	defer database.Close()

	a := &api.API{DB: database, Version: version, FilesDir: filepath.Join(dataDir, "files")}
	bootstrapAdmin(database)

	root := http.NewServeMux()
	// Health is unauthenticated (for uptime checks); it is the more specific
	// pattern, so it wins over the authenticated "/api/" mount below.
	root.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok","version":"` + version + `"}`))
	})
	// Login/logout are unauthenticated (they establish the session).
	root.HandleFunc("POST /api/login", a.Login)
	root.HandleFunc("POST /api/logout", a.Logout)
	root.Handle("/api/", auth.Middleware(a.Identify, a.ResolveUser)(a.Routes()))
	root.Handle("/", spaHandler())

	handler := withCORS(root)
	log.Printf("Tabelin V2 %s listening on %s (data: %s)", version, addr, dataDir)
	if err := http.ListenAndServe(addr, handler); err != nil {
		log.Fatal(err)
	}
}

// bootstrapAdmin seeds the first admin when the users table is empty, so a fresh
// install has someone who can sign in and provision others. It uses
// TABELIN_BOOTSTRAP_ADMIN when set (e.g. the office AD account), otherwise a
// plain "admin" account whose PIN is set on first sign-in — turnkey for a
// double-click install with no configuration.
func bootstrapAdmin(d *sql.DB) {
	var n int
	if err := d.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&n); err != nil || n > 0 {
		return
	}
	name := auth.Normalize(os.Getenv("TABELIN_BOOTSTRAP_ADMIN"))
	if name == "" {
		name = "admin"
	}
	if _, err := d.Exec(`INSERT INTO users(username, display_name, role) VALUES(?, 'Administrator', 'admin')`, name); err != nil {
		log.Printf("bootstrap admin: %v", err)
		return
	}
	log.Printf("bootstrapped admin account: %s (set its PIN on first sign-in)", name)
}

// spaHandler serves the embedded SPA, falling back to index.html for any path
// the SPA routes client-side.
func spaHandler() http.Handler {
	sub, err := fs.Sub(webFS, "web")
	if err != nil {
		log.Fatalf("web fs: %v", err)
	}
	fileServer := http.FileServer(http.FS(sub))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(r.URL.Path, "/")
		if p == "" {
			p = "index.html"
		}
		if _, err := fs.Stat(sub, p); err != nil {
			r = r.Clone(r.Context())
			r.URL.Path = "/"
		}
		fileServer.ServeHTTP(w, r)
	})
}

// withCORS enables cross-origin calls from the Vite dev server during
// development (TABELIN_DEV_CORS=1). Production serves SPA + API same-origin.
func withCORS(next http.Handler) http.Handler {
	if os.Getenv("TABELIN_DEV_CORS") != "1" {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if origin := r.Header.Get("Origin"); origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, "+auth.DevUserHeader)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
