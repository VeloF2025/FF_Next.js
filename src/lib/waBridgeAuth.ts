/**
 * Outbound authentication headers for calls to the WhatsApp bridge on :8083.
 *
 * The bridge historically authenticated nobody: every endpoint served any
 * caller that could reach the port. It now checks an `x-bridge-secret` header,
 * running in a permissive "log" mode until every caller here sends one — see
 * services/whatsapp-bridge/pairing.go.
 *
 * The same WA_BRIDGE_SECRET already proves the bridge's identity on inbound
 * calls (pages/api/activate/process-new-dr.ts and siblings); this is the same
 * shared secret in the other direction.
 */
import { log } from '@/lib/logger';

let warned = false;

/**
 * Returns the bridge auth header, or an empty object when the secret is unset.
 *
 * Deliberately does not throw. While the bridge is in "log" mode an unset
 * secret still works, and throwing here would take down OTP delivery and DR
 * acks over a misconfiguration that is currently non-fatal. It warns once so
 * the gap is visible before the bridge is switched to "enforce".
 */
export function waBridgeAuthHeaders(): Record<string, string> {
  const secret = process.env.WA_BRIDGE_SECRET;
  if (!secret) {
    if (!warned) {
      warned = true;
      log.warn(
        'WA_BRIDGE_SECRET is not set; bridge calls are unauthenticated and will fail once the bridge enforces auth'
      );
    }
    return {};
  }
  return { 'x-bridge-secret': secret };
}

/** Convenience wrapper: JSON content type plus the bridge secret. */
export function waBridgeJsonHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', ...waBridgeAuthHeaders() };
}

/** Test seam: resets the once-only warning latch. */
export function __resetWaBridgeAuthWarning(): void {
  warned = false;
}
