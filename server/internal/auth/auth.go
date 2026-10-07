// Package auth resolves the current user for each request.
//
// Phase 1 (here) reads the caller's identity from a development header so the
// whole stack can be built and tested off-domain. The identity SEAM is the
// identify() function: on the office network this is where Windows Integrated
// Authentication (Negotiate/Kerberos or NTLM) will fill in the domain account,
// with the rest of the pipeline — normalize → look up the admin-provisioned
// user → attach to context — unchanged.
package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
)

// User is the authenticated caller, matched to an admin-provisioned account.
type User struct {
	ID          int64  `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	Role        string `json:"role"` // admin | reviewer
	Active      bool   `json:"active"`
}

// Resolver looks up an admin-provisioned user by normalized username. It returns
// (nil, nil) when no such active user exists.
type Resolver func(username string) (*User, error)

type ctxKey struct{}

// DevUserHeader carries the caller identity while real AD auth is not wired yet.
const DevUserHeader = "X-Tabelin-Dev-User"

// Identify extracts the raw account name for a request. It is supplied by the
// caller so the identity source can evolve without touching this package: today
// a login-session cookie (and a dev header); on the office network the Windows
// Integrated Auth (Negotiate/NTLM) handshake slots in here.
type Identify func(r *http.Request) string

// Normalize lower-cases and trims an account so "DOMAIN\\JDoe" and "domain\jdoe"
// match the same stored user.
func Normalize(name string) string {
	return strings.ToLower(strings.TrimSpace(name))
}

// Middleware authenticates every request: identify → normalize → resolve. An
// unknown or inactive account is rejected with 401 so only accounts the
// administrator created can use the tool.
func Middleware(identify Identify, resolve Resolver) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			name := Normalize(identify(r))
			if name == "" {
				writeErr(w, http.StatusUnauthorized, "no identity")
				return
			}
			u, err := resolve(name)
			if err != nil {
				writeErr(w, http.StatusInternalServerError, "resolve user")
				return
			}
			if u == nil || !u.Active {
				writeErr(w, http.StatusUnauthorized, "account not provisioned")
				return
			}
			ctx := context.WithValue(r.Context(), ctxKey{}, u)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// FromContext returns the authenticated user, or nil.
func FromContext(ctx context.Context) *User {
	u, _ := ctx.Value(ctxKey{}).(*User)
	return u
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
