# Tabelin V2 server

A single self-contained Go binary: serves the React SPA, a JSON API, and stores
everything in a local SQLite file + a `data/` folder. Runs on one office machine,
no admin install. Users are identified by their office (AD) account.

## Status

Working: SQLite schema + migrations, sign-in (username + PIN session cookie),
users and roles (admin / reviewer), the **Project › Review** hierarchy
(admins create projects and reviews; every signed-in user sees all of them),
records, before/after images, and config at global / project / review scope:
the project holds the Excel template file + its column mapping, statuses,
detection rules, labels and custom fields; the review holds its target date.
Not yet: the Windows (AD) handshake.

Data model: `projects` → `reviews` → `records` → `images`. A database from
before Project › Review is upgraded on startup: each old "project" becomes a
review inside a project called "General", which an admin can rename.

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
