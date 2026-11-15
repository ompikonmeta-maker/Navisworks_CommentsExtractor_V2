# Tabelin V2 server

A single self-contained Go binary: serves the React SPA, a JSON API, and stores
everything in a local SQLite file + a `data/` folder. Runs on one office machine,
no admin install. Users are identified by their office (AD) account.

## Status

Working: SQLite schema + migrations, sign-in (username + PIN session cookie),
users and roles (admin / reviewer), the **Project › Review** hierarchy
(admins create projects and reviews; signed-in users see the projects they may open),
records, before/after images, and config at global / project / review scope:
the project holds the Excel template file + its column mapping, statuses,
detection rules, labels and custom fields; the review holds its target date.
Not yet: the Windows (AD) handshake.

Data model: `projects` → `reviews` → `records` → `images`. A database from
before Project › Review is upgraded on startup: each old "project" becomes a
review inside a project called "General", which an admin can rename.

## Access, Trash and backup (Phase 5)

- **Wrong PINs:** after 5 wrong PINs in a row an account is locked for 5 minutes
  (answer 429 with `Retry-After`). A correct PIN or an admin **Reset PIN** clears it.
- **Per-project access:** every project is open to all signed-in users until an admin
  restricts it (`PUT /api/projects/{pid}/access` `{ "restricted": true, "members": [user ids] }`).
  Admins always see everything; anyone else gets 404 for a project they may not open.
- **Trash:** deleting a comment or a review moves it to the Trash for 30 days
  (`GET /api/trash`, `POST /api/trash/restore`, `POST /api/trash/purge` — admin). After
  30 days it is deleted for good (checked at startup and whenever the Trash is opened).
  Undoing an import deletes its comments at once (`…/records/delete?forGood=1`).
- **Backup:** `GET /api/backup` (admin) downloads `tabelin-backup-<date>.zip` with
  `tabelin.db` (a consistent copy, safe while people work), the `files/` folder (photos,
  templates) and `RESTORE.txt`.

### Restore from a backup

1. Close the Tabelin server window.
2. In the server's `data` folder, move the old `tabelin.db` and `files` somewhere safe.
3. Copy `tabelin.db` and `files` from the backup zip into the `data` folder.
4. Start `tabelin-server.exe` and check that a review opens with its photos.

`go test ./internal/api -run TestBackupRestores` does exactly this against a fresh folder.

## Run (development)

```bash
cd server
go run .          # listens on :8787, data in ./data
```

Configuration (environment variables):

| Var | Default | Meaning |
| --- | --- | --- |
| `TABELIN_ADDR` | `:8787` | listen address |
| `TABELIN_DATA` | `./data` | folder for the SQLite db + uploaded files |
| `TABELIN_BOOTSTRAP_ADMIN` | – | AD account seeded as the first admin when the users table is empty (e.g. `DOMAIN\jdoe`) |
| `TABELIN_DEV_CORS` | – | set to `1` to allow the Vite dev server (5173) to call the API cross-origin |
| `TABELIN_DEV_AUTH` | – | set to `1` to accept the `X-Tabelin-Dev-User` header (development only — never on the office server) |

### Identity during development

Real Windows auth is not wired yet. With `TABELIN_DEV_AUTH=1` set, send the
caller identity with a header (without it the header is ignored and only a
signed-in session counts):

```bash
curl -H 'X-Tabelin-Dev-User: DOMAIN\jdoe' http://localhost:8787/api/me
```

On the office network this header is replaced by the Negotiate/Kerberos (or
NTLM) handshake in `internal/auth`; everything after identification is unchanged.

## Build a release binary

```bash
# 1. build the SPA and copy it where the server embeds it
npm run build            # from the repo root → dist/index.html
cp -r dist/* server/web/ # (V2 will emit multiple assets; single-file for now)

# 2. build the server (Windows target shown; pure-Go, no cgo)
cd server
GOOS=windows GOARCH=amd64 go build -o tabelin-server.exe .
```

Copy `tabelin-server.exe` next to a `data/` folder to a machine and run it. To
move or back up an install, copy the whole folder (binary + `data/`).
