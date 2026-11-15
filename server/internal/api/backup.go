package api

import (
	"archive/zip"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

// backup streams a zip of everything Tabelin keeps (admin): tabelin.db (a
// consistent copy made with VACUUM INTO, so it is safe while people work) and
// the files/ folder (photos and templates). Restore = stop the server, replace
// the data folder's tabelin.db and files/ with the zip's, start it again
// (server/README.md, "Backup and restore").
func (a *API) backup(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	tmp, err := os.MkdirTemp("", "tabelin-backup-")
	if err != nil {
		writeErr(w, 500, "temp folder")
		return
	}
	defer os.RemoveAll(tmp)
	snap := filepath.Join(tmp, "tabelin.db")
	if _, err := a.DB.Exec(`VACUUM INTO ?`, snap); err != nil {
		writeErr(w, 500, "copy database")
		return
	}
	name := "tabelin-backup-" + clock().Format("2006-01-02-1504") + ".zip"
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
	zw := zip.NewWriter(w)
	defer zw.Close()
	add := func(zipPath, diskPath string, mod time.Time) {
		f, err := os.Open(diskPath)
		if err != nil {
			return
		}
		defer f.Close()
		hdr := &zip.FileHeader{Name: zipPath, Method: zip.Deflate, Modified: mod}
		if out, err := zw.CreateHeader(hdr); err == nil {
			io.Copy(out, f)
		}
	}
	add("tabelin.db", snap, clock())
	if entries, err := os.ReadDir(a.FilesDir); err == nil {
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			info, _ := e.Info()
			mod := clock()
			if info != nil {
				mod = info.ModTime()
			}
			add("files/"+e.Name(), filepath.Join(a.FilesDir, e.Name()), mod)
		}
	}
	if out, err := zw.Create("RESTORE.txt"); err == nil {
		io.WriteString(out, restoreText)
	}
}

const restoreText = `Tabelin backup

To restore:
1. Close the Tabelin server window.
2. Open the server's data folder (next to tabelin-server.exe, called "data").
3. Move the old tabelin.db and files folder somewhere safe (do not delete them yet).
4. Copy tabelin.db and the files folder from this zip into the data folder.
5. Start tabelin-server.exe again and check a review opens with its photos.
`
