// Tabelin V2 server — a single self-contained binary that serves the React SPA,
// a small JSON API, and stores everything in a local SQLite file plus a data
// folder on disk. Designed to run on one office machine with no admin install;
// user identity comes from the office AD account (a dev header stands in until
// the Windows Integrated Auth handshake is wired on the network).
package main

import (
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"tabelin/server/internal/api"
	"tabelin/server/internal/auth"
	"tabelin/server/internal/db"
)

// The built SPA is copied into web/ before `go build` (see server/README.md).
//
//go:embed all:web
var webFS embed.FS

var version = "2.0.0-dev" // set at release build: -ldflags "-X main.version=…"

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
	a.ServerURLs = func() []string {
		var urls []string
		for _, ip := range lanIPs() {
			urls = append(urls, "http://"+ip+portOf(addr))
		}
		return urls
	}
	bootstrapAdmin(database)
	// tabelin-server -reset-pin <account>: clear a forgotten PIN and quit.
	if name, ok := resetPinArg(os.Args[1:]); ok {
		if err := api.ResetPIN(database, name); err != nil {
			fmt.Printf("\nCould not reset the PIN: %v.\n", err)
			os.Exit(1)
		}
		fmt.Printf("\nThe PIN of %q is cleared. Start Tabelin and sign in as %q: the PIN you type then becomes the new one.\n", auth.Normalize(name), auth.Normalize(name))
		return
	}
	a.PurgeExpired() // the Trash keeps deleted things for api.TrashDays days

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
	// Bind first so we can report a busy port plainly and only open the
	// browser once the server is actually reachable.
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		fmt.Printf("\nTabelin could not start: port %s is already in use.\n", addr)
		fmt.Println("It is probably already running in another window — open http://localhost" + portOf(addr) + " in your browser.")
		fmt.Println("\nPress Enter to close.")
		fmt.Scanln()
		os.Exit(1)
	}
	printBanner(addr, dataDir)
	if os.Getenv("TABELIN_NO_BROWSER") != "1" {
		openBrowser("http://localhost" + portOf(addr))
	}
	if err := http.Serve(ln, handler); err != nil {
		log.Fatal(err)
	}
}

// resetPinArg finds "-reset-pin <account>" (or --reset-pin, -reset-pin=<account>).
// With no account given it means "admin".
func resetPinArg(args []string) (string, bool) {
	for i, a := range args {
		switch {
		case a == "-reset-pin" || a == "--reset-pin":
			if i+1 < len(args) && !strings.HasPrefix(args[i+1], "-") {
				return args[i+1], true
			}
			return "admin", true
		case strings.HasPrefix(a, "-reset-pin=") || strings.HasPrefix(a, "--reset-pin="):
			return a[strings.Index(a, "=")+1:], true
		}
	}
	return "", false
}

// printBanner tells a non-technical user what to do: where to open the tool,
// how colleagues reach it, and to keep this window open.
func printBanner(addr, dataDir string) {
	port := portOf(addr)
	fmt.Println()
	fmt.Println("  ================================================")
	fmt.Println("   Tabelin is running  (v" + version + ")")
	fmt.Println("  ================================================")
	fmt.Println()
	fmt.Println("   Open in your browser:   http://localhost" + port)
	ips := lanIPs()
	if len(ips) > 0 {
		fmt.Println()
		fmt.Println("   Colleagues on the office network open:")
		for _, ip := range ips {
			fmt.Println("                           http://" + ip + port)
		}
	}
	fmt.Println()
	fmt.Println("   Data folder: " + dataDir)
	fmt.Println()
	fmt.Println("   KEEP THIS WINDOW OPEN. Closing it stops Tabelin.")
	fmt.Println()
}

func portOf(addr string) string {
	if i := strings.LastIndex(addr, ":"); i >= 0 {
		return addr[i:]
	}
	return ":" + addr
}

// lanIPs lists this machine's IPv4 addresses that other PCs can use.
func lanIPs() []string {
	var out []string
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return out
	}
	for _, a := range addrs {
		if n, ok := a.(*net.IPNet); ok && !n.IP.IsLoopback() && !n.IP.IsLinkLocalUnicast() {
			if v4 := n.IP.To4(); v4 != nil {
				out = append(out, v4.String())
			}
		}
	}
	return out
}

// openBrowser opens the default browser on the host (best effort).
func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	_ = cmd.Start()
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
