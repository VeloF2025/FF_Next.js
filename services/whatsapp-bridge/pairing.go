package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"go.mau.fi/whatsmeow"
)

// Inbound authentication for the bridge's HTTP surface.
//
// Until 2026-08-22 no endpoint checked its caller at all, and :8083 was open to
// the internet. The port is now firewalled to Velocity's egress and the tailnet,
// but a shared secret is the actual control.
//
// Rolling this out cannot break the ack path, so authMode has two settings:
//
//	log     - a missing or wrong secret is logged and the request proceeds.
//	enforce - a missing or wrong secret returns 401.
//
// Existing endpoints start in "log" so the bridge can ship before FibreFlow
// sends the header. Endpoints introduced by this change enforce unconditionally
// (see guardStrict): nothing calls them yet, so there is no caller to break.
const (
	authModeLog     = "log"
	authModeEnforce = "enforce"
)

func bridgeAuthMode() string {
	if getEnvOrDefault("WA_BRIDGE_AUTH_MODE", authModeLog) == authModeEnforce {
		return authModeEnforce
	}
	return authModeLog
}

// secretMatches reports whether the request carries the bridge secret.
//
// An empty bridgeSecret never matches. Treating "no secret configured" as
// "everything authenticates" would silently disable the check on exactly the
// deployment that forgot to set it.
func secretMatches(r *http.Request) bool {
	if bridgeSecret == "" {
		return false
	}
	presented := r.Header.Get("x-bridge-secret")
	if presented == "" {
		presented = strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	}
	// Length-independent comparison is not required here: the secret is a
	// 64-char hex string and the port is already restricted to two sources.
	return presented == bridgeSecret
}

func writeJSON(w http.ResponseWriter, status int, body map[string]interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// guard wraps a mutating handler in the configured auth mode.
func guard(name string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if secretMatches(r) {
			next(w, r)
			return
		}
		if bridgeAuthMode() == authModeEnforce {
			writeJSON(w, http.StatusUnauthorized, map[string]interface{}{
				"success": false,
				"error":   "missing or invalid x-bridge-secret",
			})
			return
		}
		fmt.Printf("⚠️  UNAUTHENTICATED %s from %s - would be rejected under WA_BRIDGE_AUTH_MODE=enforce\n", name, r.RemoteAddr)
		next(w, r)
	}
}

// guardStrict always rejects an unauthenticated caller, regardless of mode.
// Used for endpoints with no pre-existing callers.
func guardStrict(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !secretMatches(r) {
			writeJSON(w, http.StatusUnauthorized, map[string]interface{}{
				"success": false,
				"error":   "missing or invalid x-bridge-secret",
			})
			return
		}
		next(w, r)
	}
}

// pairingCodeTTL is how long WhatsApp accepts a phone pairing code. The real
// window is not published; three minutes is deliberately shorter than any
// observed acceptance so the UI stops showing a code before it silently fails.
const pairingCodeTTL = 3 * time.Minute

type pairingState struct {
	mu          sync.Mutex
	code        string
	phoneNumber string
	requestedAt time.Time
}

var currentPairing pairingState

func (p *pairingState) set(code, phone string, now time.Time) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.code = code
	p.phoneNumber = phone
	p.requestedAt = now
}

// snapshot returns the outstanding code, or empty strings once it has expired.
func (p *pairingState) snapshot(now time.Time) (code, phone string, expiresAt time.Time) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.code == "" || now.Sub(p.requestedAt) >= pairingCodeTTL {
		return "", "", time.Time{}
	}
	return p.code, p.phoneNumber, p.requestedAt.Add(pairingCodeTTL)
}

func (p *pairingState) clear() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.code = ""
	p.phoneNumber = ""
	p.requestedAt = time.Time{}
}

var e164Pattern = regexp.MustCompile(`^\+[1-9]\d{7,14}$`)

// normalisePhoneNumber trims incidental spacing and validates E.164.
//
// whatsmeow will happily request a code for a malformed number and fail later
// with an opaque error, so reject the shape here where the message is useful.
func normalisePhoneNumber(raw string) (string, error) {
	trimmed := strings.ReplaceAll(strings.TrimSpace(raw), " ", "")
	if trimmed == "" {
		return "", fmt.Errorf("phone_number is required")
	}
	if !e164Pattern.MatchString(trimmed) {
		return "", fmt.Errorf("phone_number must be E.164, e.g. +27785687945")
	}
	return trimmed, nil
}

// pairClient is the slice of *whatsmeow.Client the pairing handlers need,
// so the handlers can be tested without a live WhatsApp connection.
type pairClient interface {
	IsLoggedIn() bool
	PairPhone(ctx context.Context, phone string, showPushNotification bool, clientType whatsmeow.PairClientType, clientDisplayName string) (string, error)
}

// handlePair requests a pairing code for the supplied number.
//
// Refuses while a device is already linked: whatsmeow would return a confusing
// error, and the operator's real intent in that case is to unlink first from
// the handset. This mirrors what the healthcheck script already refuses to do —
// a re-pair needs a human holding the phone, and every spurious request pushes
// the account towards WhatsApp's 429 rate-overlimit.
func handlePair(client pairClient, now func() time.Time) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]interface{}{
				"success": false, "error": "Method not allowed. Use POST",
			})
			return
		}
		var req struct {
			PhoneNumber string `json:"phone_number"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]interface{}{
				"success": false, "error": "Invalid JSON",
			})
			return
		}
		phone, err := normalisePhoneNumber(req.PhoneNumber)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]interface{}{
				"success": false, "error": err.Error(),
			})
			return
		}
		if client == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]interface{}{
				"success": false, "error": "WhatsApp client is not initialised",
			})
			return
		}
		if client.IsLoggedIn() {
			writeJSON(w, http.StatusConflict, map[string]interface{}{
				"success": false,
				"error":   "a device is already linked; unlink it from the handset (WhatsApp > Linked Devices) before pairing a new number",
			})
			return
		}

		code, err := client.PairPhone(r.Context(), phone, true, whatsmeow.PairClientChrome, "Chrome (Linux)")
		if err != nil {
			fmt.Printf("❌ Pairing request failed for %s: %v\n", phone, err)
			writeJSON(w, http.StatusBadGateway, map[string]interface{}{
				"success": false,
				"error":   fmt.Sprintf("WhatsApp rejected the pairing request: %v", err),
			})
			return
		}

		issuedAt := now()
		currentPairing.set(code, phone, issuedAt)
		fmt.Printf("🔑 PAIRING CODE: %s (requested via /pair for %s)\n", code, phone)

		writeJSON(w, http.StatusOK, map[string]interface{}{
			"success":      true,
			"pairing_code": code,
			"phone_number": phone,
			"expires_at":   issuedAt.Add(pairingCodeTTL).UTC().Format(time.RFC3339),
			"instructions": []string{
				"Open WhatsApp on the handset for " + phone,
				"Settings > Linked Devices > Link a Device",
				"Tap \"Link with phone number instead\"",
				"Enter " + strings.ReplaceAll(code, "-", "") + " (without the dash)",
			},
		})
	}
}

// handlePairingStatus reports link state and any outstanding pairing code.
func handlePairingStatus(client pairClient, now func() time.Time) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]interface{}{
				"success": false, "error": "Method not allowed. Use GET",
			})
			return
		}
		loggedIn := client != nil && client.IsLoggedIn()
		if loggedIn {
			// A live session makes any cached code meaningless.
			currentPairing.clear()
		}
		code, phone, expiresAt := currentPairing.snapshot(now())

		body := map[string]interface{}{
			"success":       true,
			"session_valid": loggedIn,
			"pairing_state": "needs_pairing",
			"pairing_code":  nil,
			"phone_number":  nil,
			"expires_at":    nil,
		}
		if loggedIn {
			body["pairing_state"] = "connected"
		}
		if code != "" {
			body["pairing_state"] = "code_issued"
			body["pairing_code"] = code
			body["phone_number"] = phone
			body["expires_at"] = expiresAt.UTC().Format(time.RFC3339)
		}
		writeJSON(w, http.StatusOK, body)
	}
}

// registerPairingRoutes wires the pairing endpoints. Both enforce the secret
// unconditionally — they are new, so no existing caller can be broken by it.
func registerPairingRoutes(client *whatsmeow.Client) {
	var c pairClient
	if client != nil {
		c = client
	}
	http.HandleFunc("/pair", guardStrict(handlePair(c, time.Now)))
	http.HandleFunc("/pairing-status", guardStrict(handlePairingStatus(c, time.Now)))
}
