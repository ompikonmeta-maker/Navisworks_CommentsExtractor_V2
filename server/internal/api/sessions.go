package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"os"
	"strconv"
	"time"

	"golang.org/x/crypto/bcrypt"

	"tabelin/server/internal/auth"
)

const sessionCookie = "tabelin_sess"
const sessionTTL = 30 * 24 * time.Hour

// Wrong-PIN limit: after maxPinFailures wrong PINs in a row an account is
// locked for pinLockout. A correct PIN or an admin "Reset PIN" clears it.
const maxPinFailures = 5

var pinLockout = 5 * time.Minute

// clock is time.Now, swappable in tests.
var clock = time.Now

// lockedFor reports how long the account is still locked (0 = not locked).
func (a *API) lockedFor(userID int64) time.Duration {
	var until string
	if a.DB.QueryRow(`SELECT locked_until FROM pin_attempts WHERE user_id=?`, userID).Scan(&until) != nil || until == "" {
		return 0
	}
	t, err := time.Parse(time.RFC3339, until)
	if err != nil {
		return 0
	}
	if d := t.Sub(clock()); d > 0 {
		return d
	}
	return 0
}

// pinFailed counts a wrong PIN; the maxPinFailures-th locks the account and
// starts the count again. Returns the lock length (0 = not locked).
func (a *API) pinFailed(userID int64) time.Duration {
	a.DB.Exec(`INSERT INTO pin_attempts(user_id, failures, locked_until) VALUES(?, 1, '')
		ON CONFLICT(user_id) DO UPDATE SET failures = failures + 1`, userID)
	var n int
	a.DB.QueryRow(`SELECT failures FROM pin_attempts WHERE user_id=?`, userID).Scan(&n)
	if n < maxPinFailures {
		return 0
	}
	until := clock().UTC().Add(pinLockout).Format(time.RFC3339)
	a.DB.Exec(`UPDATE pin_attempts SET failures=0, locked_until=? WHERE user_id=?`, until, userID)
	return pinLockout
}

// clearPinFailures forgets wrong PINs and any lock (correct PIN, admin reset).
func (a *API) clearPinFailures(userID int64) {
	a.DB.Exec(`DELETE FROM pin_attempts WHERE user_id=?`, userID)
}

// writeLocked answers 429 with a plain message and Retry-After.
func writeLocked(w http.ResponseWriter, d time.Duration) {
	mins := int((d + time.Minute - 1) / time.Minute)
	if mins < 1 {
		mins = 1
	}
	w.Header().Set("Retry-After", strconv.Itoa(int(d.Seconds()+0.999)))
	unit := "minutes"
	if mins == 1 {
		unit = "minute"
	}
	writeErr(w, http.StatusTooManyRequests, "Too many wrong PINs. Try again in "+strconv.Itoa(mins)+" "+unit+", or ask an admin to reset your PIN.")
}

// Identify supplies the caller's account name to the auth middleware. Order:
//  1. a valid login-session cookie (the browser path used off-domain);
//  2. the dev header — only when TABELIN_DEV_AUTH=1, otherwise anyone on the
//     network could claim any account by sending it.
//
// On the office network a Windows Integrated Auth check would be added ahead of
// these; the rest of the pipeline is unchanged.
func (a *API) Identify(r *http.Request) string {
	if c, err := r.Cookie(sessionCookie); err == nil && c.Value != "" {
		var username string
		err := a.DB.QueryRow(
			`SELECT username FROM sessions WHERE token=? AND expires_at > ?`,
			c.Value, time.Now().UTC().Format(time.RFC3339),
		).Scan(&username)
		if err == nil {
			return username
		}
	}
	if os.Getenv("TABELIN_DEV_AUTH") == "1" {
		return r.Header.Get(auth.DevUserHeader)
	}
	return ""
}

// Login authenticates a provisioned account with its PIN and starts a session.
// If the account has no PIN yet, the first login sets it (claims the account) —
// convenient for a small team on a trusted network; the AD path replaces this.
func (a *API) Login(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Username string `json:"username"`
		PIN      string `json:"pin"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "bad body")
		return
	}
	username := auth.Normalize(body.Username)
	if username == "" || body.PIN == "" {
		writeErr(w, http.StatusBadRequest, "username and PIN required")
		return
	}
	var id int64
	var role, hash string
	var active int
	err := a.DB.QueryRow(`SELECT id, role, active, pin_hash FROM users WHERE username=?`, username).
		Scan(&id, &role, &active, &hash)
	if err == sql.ErrNoRows || (err == nil && active != 1) {
		writeErr(w, http.StatusUnauthorized, "account not provisioned")
		return
	}
	if err != nil {
		writeErr(w, 500, "lookup user")
		return
	}
	if d := a.lockedFor(id); d > 0 {
		writeLocked(w, d)
		return
	}
	if hash == "" {
		// First login: set the PIN.
		h, _ := bcrypt.GenerateFromPassword([]byte(body.PIN), bcrypt.DefaultCost)
		if _, err := a.DB.Exec(`UPDATE users SET pin_hash=? WHERE id=?`, string(h), id); err != nil {
			writeErr(w, 500, "set pin")
			return
		}
	} else if bcrypt.CompareHashAndPassword([]byte(hash), []byte(body.PIN)) != nil {
		if d := a.pinFailed(id); d > 0 {
			writeLocked(w, d)
			return
		}
		writeErr(w, http.StatusUnauthorized, "wrong PIN")
		return
	}
	a.clearPinFailures(id)
	token := randKey() + randKey()
	if _, err := a.DB.Exec(`INSERT INTO sessions(token, username, expires_at) VALUES(?,?,?)`,
		token, username, time.Now().UTC().Add(sessionTTL).Format(time.RFC3339)); err != nil {
		writeErr(w, 500, "create session")
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: token, Path: "/", HttpOnly: true,
		SameSite: http.SameSiteLaxMode, MaxAge: int(sessionTTL.Seconds()),
	})
	writeJSON(w, http.StatusOK, map[string]any{"username": username, "role": role})
}

// Logout clears the session.
func (a *API) Logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil {
		a.DB.Exec(`DELETE FROM sessions WHERE token=?`, c.Value)
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", MaxAge: -1, HttpOnly: true})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
