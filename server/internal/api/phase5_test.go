package api

import (
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"
)

// ---- wrong-PIN limit ----

func useClock(t *testing.T, at *time.Time) {
	old := clock
	clock = func() time.Time { return *at }
	t.Cleanup(func() { clock = old })
}

func (e *env) pinTry(user, pin string) (int, string, string) {
	e.t.Helper()
	req, _ := http.NewRequest("POST", e.url+"/api/login", strings.NewReader(`{"username":"`+user+`","pin":"`+pin+`"}`))
	req.Header.Set("Content-Type", "application/json")
	res, err := e.anon.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer res.Body.Close()
	b := new(strings.Builder)
	buf := make([]byte, 512)
	for {
		n, err := res.Body.Read(buf)
		b.Write(buf[:n])
		if err != nil {
			break
		}
	}
	return res.StatusCode, res.Header.Get("Retry-After"), b.String()
}

func TestWrongPinsLockTheAccount(t *testing.T) {
	now := time.Date(2026, 11, 15, 9, 0, 0, 0, time.UTC)
	useClock(t, &now)
	e := newEnv(t) // rina's PIN is 2222

	for i := 1; i < maxPinFailures; i++ {
		if code, _, _ := e.pinTry("rina", "0000"); code != 401 {
			t.Fatalf("wrong PIN %d: status %d, want 401", i, code)
		}
	}
	code, retry, body := e.pinTry("rina", "0000")
	if code != 429 || retry != "300" || !strings.Contains(body, "Try again in 5 minutes") {
		t.Fatalf("5th wrong PIN: %d retry=%q %s", code, retry, body)
	}
	// locked: even the right PIN is refused, and it says how long is left
	now = now.Add(2*time.Minute + 10*time.Second)
	if code, retry, body := e.pinTry("rina", "2222"); code != 429 || retry != "170" || !strings.Contains(body, "3 minutes") {
		t.Errorf("right PIN while locked: %d retry=%q %s", code, retry, body)
	}
	// another account is not affected
	if code, _, _ := e.pinTry("boss", "1111"); code != 200 {
		t.Errorf("other account while rina is locked: %d", code)
	}
	// after the lock the right PIN works and the count starts again
	now = now.Add(3 * time.Minute)
	if code, _, _ := e.pinTry("rina", "2222"); code != 200 {
		t.Fatalf("right PIN after the lock: %d", code)
	}
	for i := 1; i < maxPinFailures; i++ {
		e.pinTry("rina", "0000")
	}
	if code, _, _ := e.pinTry("rina", "2222"); code != 200 {
		t.Errorf("4 wrong then right: %d, want 200 (a success clears the count)", code)
	}
	for i := 1; i < maxPinFailures; i++ {
		if code, _, _ := e.pinTry("rina", "0000"); code != 401 {
			t.Errorf("count did not start again after a success (try %d → %d)", i, code)
		}
	}
}

func TestAdminResetLiftsTheLock(t *testing.T) {
	now := time.Date(2026, 11, 15, 9, 0, 0, 0, time.UTC)
	useClock(t, &now)
	e := newEnv(t)
	for i := 0; i < maxPinFailures; i++ {
		e.pinTry("rina", "0000")
	}
	if code, _, _ := e.pinTry("rina", "2222"); code != 429 {
		t.Fatalf("not locked: %d", code)
	}
	var id int64
	e.db.QueryRow(`SELECT id FROM users WHERE username='rina'`).Scan(&id)
	e.want(200, e.admin, "POST", "/api/users/"+itoa(id)+"/reset-pin", nil)
	// the next sign-in sets a new PIN
	if code, _, _ := e.pinTry("rina", "5555"); code != 200 {
		t.Errorf("sign-in after reset: %d", code)
	}
	if n := e.count(`SELECT COUNT(*) FROM pin_attempts`); n != 0 {
		t.Errorf("attempt rows left: %d", n)
	}
}

func TestUnknownAccountsAreNotCounted(t *testing.T) {
	e := newEnv(t)
	for i := 0; i < maxPinFailures+2; i++ {
		if code, _, _ := e.pinTry("nobody", "0000"); code != 401 {
			t.Fatalf("unknown account: %d, want 401", code)
		}
	}
	if n := e.count(`SELECT COUNT(*) FROM pin_attempts`); n != 0 {
		t.Errorf("attempt rows for an unknown account: %d", n)
	}
}

func itoa(n int64) string { return strconv.FormatInt(n, 10) }
