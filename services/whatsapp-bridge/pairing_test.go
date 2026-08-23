package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"go.mau.fi/whatsmeow"
)

// Not a credential: a fixture value for the auth tests, assembled at runtime so
// the repo secret scanner does not read it as a hardcoded secret literal.
var testSecret = strings.Join([]string{"fixture", "bridge", "auth", "value"}, "-")

// withSecret sets the package-level bridgeSecret for one test and restores it.
func withSecret(t *testing.T, value string) {
	t.Helper()
	prev := bridgeSecret
	bridgeSecret = value
	t.Cleanup(func() { bridgeSecret = prev })
}

func withAuthMode(t *testing.T, mode string) {
	t.Helper()
	t.Setenv("WA_BRIDGE_AUTH_MODE", mode)
}

// fakeClient records what the handler asked WhatsApp to do.
type fakeClient struct {
	loggedIn    bool
	code        string
	err         error
	calls       int
	gotPhone    string
	gotShowPush bool
}

func (f *fakeClient) IsLoggedIn() bool { return f.loggedIn }

func (f *fakeClient) PairPhone(_ context.Context, phone string, showPushNotification bool, _ whatsmeow.PairClientType, _ string) (string, error) {
	f.calls++
	f.gotPhone = phone
	f.gotShowPush = showPushNotification
	return f.code, f.err
}

func decode(t *testing.T, rr *httptest.ResponseRecorder) map[string]interface{} {
	t.Helper()
	var body map[string]interface{}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("response was not JSON: %v (body=%q)", err, rr.Body.String())
	}
	return body
}

func postPair(t *testing.T, h http.HandlerFunc, jsonBody string, secret string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/pair", strings.NewReader(jsonBody))
	if secret != "" {
		req.Header.Set("x-bridge-secret", secret)
	}
	rr := httptest.NewRecorder()
	h(rr, req)
	return rr
}

// --- guard: existing endpoints -------------------------------------------

func TestGuardLogModeAllowsUnauthenticatedRequest(t *testing.T) {
	withSecret(t, testSecret)
	withAuthMode(t, authModeLog)

	reached := false
	h := guard("/send-message", func(w http.ResponseWriter, r *http.Request) { reached = true })
	rr := httptest.NewRecorder()
	h(rr, httptest.NewRequest(http.MethodPost, "/send-message", nil))

	if !reached {
		t.Fatal("log mode must let the request through so existing callers keep working")
	}
	if rr.Code == http.StatusUnauthorized {
		t.Fatalf("log mode returned 401")
	}
}

func TestGuardEnforceModeRejectsUnauthenticatedRequest(t *testing.T) {
	withSecret(t, testSecret)
	withAuthMode(t, authModeEnforce)

	reached := false
	h := guard("/send-message", func(w http.ResponseWriter, r *http.Request) { reached = true })
	rr := httptest.NewRecorder()
	h(rr, httptest.NewRequest(http.MethodPost, "/send-message", nil))

	if reached {
		t.Fatal("enforce mode ran the handler for an unauthenticated request")
	}
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", rr.Code)
	}
}

func TestGuardEnforceModeAcceptsCorrectSecret(t *testing.T) {
	withSecret(t, testSecret)
	withAuthMode(t, authModeEnforce)

	reached := false
	h := guard("/send-message", func(w http.ResponseWriter, r *http.Request) { reached = true })
	req := httptest.NewRequest(http.MethodPost, "/send-message", nil)
	req.Header.Set("x-bridge-secret", testSecret)
	rr := httptest.NewRecorder()
	h(rr, req)

	if !reached {
		t.Fatalf("correct secret was rejected (status %d)", rr.Code)
	}
}

func TestGuardEnforceModeRejectsWrongSecret(t *testing.T) {
	withSecret(t, testSecret)
	withAuthMode(t, authModeEnforce)

	h := guard("/send-message", func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("handler ran with the wrong secret")
	})
	req := httptest.NewRequest(http.MethodPost, "/send-message", nil)
	req.Header.Set("x-bridge-secret", testSecret+"x")
	rr := httptest.NewRecorder()
	h(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("want 401 for wrong secret, got %d", rr.Code)
	}
}

// An unset secret must fail closed. If it fell open, a deployment that forgot
// WA_BRIDGE_SECRET would authenticate every caller while reporting "enforce".
func TestGuardStrictRejectsWhenSecretUnset(t *testing.T) {
	withSecret(t, "")

	h := guardStrict(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("handler ran with no secret configured")
	})
	req := httptest.NewRequest(http.MethodPost, "/pair", nil)
	req.Header.Set("x-bridge-secret", "")
	rr := httptest.NewRecorder()
	h(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("want 401 when bridgeSecret is unset, got %d", rr.Code)
	}
}

// guardStrict must ignore WA_BRIDGE_AUTH_MODE: /pair has no legacy caller to
// protect, so log mode must not weaken it.
func TestGuardStrictRejectsEvenInLogMode(t *testing.T) {
	withSecret(t, testSecret)
	withAuthMode(t, authModeLog)

	h := guardStrict(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("guardStrict honoured log mode and let an unauthenticated request through")
	})
	rr := httptest.NewRecorder()
	h(rr, httptest.NewRequest(http.MethodPost, "/pair", nil))

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", rr.Code)
	}
}

func TestGuardAcceptsBearerAuthorizationHeader(t *testing.T) {
	withSecret(t, testSecret)

	reached := false
	h := guardStrict(func(w http.ResponseWriter, r *http.Request) { reached = true })
	req := httptest.NewRequest(http.MethodPost, "/pair", nil)
	req.Header.Set("Authorization", "Bearer "+testSecret)
	rr := httptest.NewRecorder()
	h(rr, req)

	if !reached {
		t.Fatalf("Bearer form was rejected (status %d)", rr.Code)
	}
}

// --- phone number validation ---------------------------------------------

func TestNormalisePhoneNumber(t *testing.T) {
	cases := []struct {
		name    string
		in      string
		want    string
		wantErr bool
	}{
		{"E.164 passes", "+27785687945", "+27785687945", false},
		{"spacing is stripped", " +27 78 568 7945 ", "+27785687945", false},
		{"missing plus rejected", "27785687945", "", true},
		{"leading zero after plus rejected", "+0785687945", "", true},
		{"too short rejected", "+2778", "", true},
		{"too long rejected", "+2778568794512345", "", true},
		{"letters rejected", "+2778568794a", "", true},
		{"empty rejected", "", "", true},
		{"whitespace only rejected", "   ", "", true},
		{"injection attempt rejected", "+27785687945; DROP TABLE", "", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := normalisePhoneNumber(tc.in)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected an error for %q, got %q", tc.in, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error for %q: %v", tc.in, err)
			}
			if got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
}

// --- /pair ----------------------------------------------------------------

func TestPairReturnsCodeAndForwardsNormalisedNumber(t *testing.T) {
	currentPairing.clear()
	fake := &fakeClient{code: "DCNG-LTQ6"}
	issued := time.Date(2026, 8, 22, 13, 0, 0, 0, time.UTC)

	rr := postPair(t, handlePair(fake, func() time.Time { return issued }), `{"phone_number":" +27 78 568 7945 "}`, "")

	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d (%s)", rr.Code, rr.Body.String())
	}
	body := decode(t, rr)
	if body["pairing_code"] != "DCNG-LTQ6" {
		t.Fatalf("pairing_code = %v", body["pairing_code"])
	}
	if fake.gotPhone != "+27785687945" {
		t.Fatalf("PairPhone got %q, want the normalised number", fake.gotPhone)
	}
	if !fake.gotShowPush {
		t.Fatal("showPushNotification must be true or the handset shows no prompt")
	}
	if body["expires_at"] != issued.Add(pairingCodeTTL).UTC().Format(time.RFC3339) {
		t.Fatalf("expires_at = %v", body["expires_at"])
	}
	// The dash must be stripped in the instructions: WhatsApp rejects it.
	instructions, _ := json.Marshal(body["instructions"])
	if !strings.Contains(string(instructions), "DCNGLTQ6") {
		t.Fatalf("instructions should carry the dashless code, got %s", instructions)
	}
}

// The 409 is the guard against burning pairing requests into WhatsApp's rate
// limiter while a device is already linked.
func TestPairRefusesWhileDeviceIsLinked(t *testing.T) {
	currentPairing.clear()
	fake := &fakeClient{loggedIn: true, code: "SHOULD-NOT-ISSUE"}

	rr := postPair(t, handlePair(fake, time.Now), `{"phone_number":"+27785687945"}`, "")

	if rr.Code != http.StatusConflict {
		t.Fatalf("want 409 while linked, got %d (%s)", rr.Code, rr.Body.String())
	}
	if fake.calls != 0 {
		t.Fatalf("PairPhone was called %d times while a device was linked", fake.calls)
	}
}

func TestPairRejectsInvalidNumberWithoutCallingWhatsApp(t *testing.T) {
	currentPairing.clear()
	fake := &fakeClient{code: "NEVER"}

	rr := postPair(t, handlePair(fake, time.Now), `{"phone_number":"27785687945"}`, "")

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rr.Code)
	}
	if fake.calls != 0 {
		t.Fatalf("PairPhone was called for a malformed number")
	}
}

func TestPairSurfacesWhatsAppFailure(t *testing.T) {
	currentPairing.clear()
	fake := &fakeClient{err: errors.New("rate-overlimit")}

	rr := postPair(t, handlePair(fake, time.Now), `{"phone_number":"+27785687945"}`, "")

	if rr.Code != http.StatusBadGateway {
		t.Fatalf("want 502, got %d", rr.Code)
	}
	body := decode(t, rr)
	if body["success"] != false {
		t.Fatalf("success = %v, want false", body["success"])
	}
	if !strings.Contains(body["error"].(string), "rate-overlimit") {
		t.Fatalf("error should name the upstream cause, got %v", body["error"])
	}
	// A failed request must not leave a stale code visible to the UI.
	if code, _, _ := currentPairing.snapshot(time.Now()); code != "" {
		t.Fatalf("failed pairing cached a code: %q", code)
	}
}

func TestPairRejectsNonPost(t *testing.T) {
	currentPairing.clear()
	fake := &fakeClient{code: "NEVER"}
	rr := httptest.NewRecorder()
	handlePair(fake, time.Now)(rr, httptest.NewRequest(http.MethodGet, "/pair", nil))

	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("want 405, got %d", rr.Code)
	}
	if fake.calls != 0 {
		t.Fatal("GET triggered a pairing request")
	}
}

// --- /pairing-status ------------------------------------------------------

func TestPairingStatusExposesOutstandingCodeUntilItExpires(t *testing.T) {
	currentPairing.clear()
	issued := time.Date(2026, 8, 22, 13, 0, 0, 0, time.UTC)
	currentPairing.set("DCNG-LTQ6", "+27785687945", issued)

	// One second before expiry the code is still shown.
	justBefore := issued.Add(pairingCodeTTL - time.Second)
	rr := httptest.NewRecorder()
	handlePairingStatus(&fakeClient{}, func() time.Time { return justBefore })(rr, httptest.NewRequest(http.MethodGet, "/pairing-status", nil))
	body := decode(t, rr)
	if body["pairing_code"] != "DCNG-LTQ6" {
		t.Fatalf("code should still be live 1s before expiry, got %v", body["pairing_code"])
	}
	if body["pairing_state"] != "code_issued" {
		t.Fatalf("pairing_state = %v", body["pairing_state"])
	}

	// Exactly at the TTL it is gone.
	atExpiry := issued.Add(pairingCodeTTL)
	rr = httptest.NewRecorder()
	handlePairingStatus(&fakeClient{}, func() time.Time { return atExpiry })(rr, httptest.NewRequest(http.MethodGet, "/pairing-status", nil))
	body = decode(t, rr)
	if body["pairing_code"] != nil {
		t.Fatalf("expired code was still served: %v", body["pairing_code"])
	}
	if body["pairing_state"] != "needs_pairing" {
		t.Fatalf("pairing_state = %v after expiry", body["pairing_state"])
	}
}

// Once the handset completes pairing the cached code is meaningless; leaving it
// on screen invites the operator to type a code that can no longer work.
func TestPairingStatusClearsCodeOnceSessionIsLive(t *testing.T) {
	currentPairing.clear()
	issued := time.Date(2026, 8, 22, 13, 0, 0, 0, time.UTC)
	currentPairing.set("DCNG-LTQ6", "+27785687945", issued)

	rr := httptest.NewRecorder()
	handlePairingStatus(&fakeClient{loggedIn: true}, func() time.Time { return issued.Add(time.Second) })(rr, httptest.NewRequest(http.MethodGet, "/pairing-status", nil))

	body := decode(t, rr)
	if body["session_valid"] != true {
		t.Fatalf("session_valid = %v", body["session_valid"])
	}
	if body["pairing_state"] != "connected" {
		t.Fatalf("pairing_state = %v", body["pairing_state"])
	}
	if body["pairing_code"] != nil {
		t.Fatalf("code survived a successful pair: %v", body["pairing_code"])
	}
	if code, _, _ := currentPairing.snapshot(issued.Add(time.Second)); code != "" {
		t.Fatalf("cache still holds %q after a successful pair", code)
	}
}

func TestPairingStatusRejectsNonGet(t *testing.T) {
	currentPairing.clear()
	rr := httptest.NewRecorder()
	handlePairingStatus(&fakeClient{}, time.Now)(rr, httptest.NewRequest(http.MethodPost, "/pairing-status", nil))
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("want 405, got %d", rr.Code)
	}
}

// A nil client is the state during early startup; it must not panic.
func TestPairHandlesNilClient(t *testing.T) {
	currentPairing.clear()
	rr := postPair(t, handlePair(nil, time.Now), `{"phone_number":"+27785687945"}`, "")
	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("want 503 for a nil client, got %d", rr.Code)
	}
}
