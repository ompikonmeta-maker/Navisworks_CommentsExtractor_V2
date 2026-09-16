# Tabelin V2 server

A single self-contained Go binary: serves the React SPA, a JSON API, and stores
everything in a local SQLite file + a `data/` folder. Runs on one office machine,
no admin install. Users are identified by their office (AD) account.

## Status

Phase 1 scaffold. Working: SQLite schema + migrations, the identity pipeline
(dev header now → Windows Integrated Auth later), and the first API endpoints
(`/api/health`, `/api/me`, projects, users). Not yet: record/image/config
endpoints, the AD handshake, and the SPA data adapter.

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

### Identity during development

Real Windows auth is not wired yet. Send the caller identity with a header:

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
