/**
 * Raw WAHA 1:1 sender — the lowest layer of the WhatsApp send path.
 *
 * Intentionally dependency-free: no logger, no database, no other module in
 * this repo. Both the provider-aware sender (`waSendClient`) and the
 * notifications delivery service (`whatsappDelivery`) need this call, and
 * previously each reached for it through the other, forming an import cycle.
 * Keeping this module import-free is what guarantees it can never be pulled
 * back into one. `importGraph.test.ts` pins that.
 *
 * Contract: resolves on success, THROWS on HTTP failure. `waSendClient` turns
 * that throw into `{ok:false}` for its callers — do not soften it here, or a
 * failed send becomes a silent success upstream.
 *
 * @module communications/whatsapp/send/wahaDmClient
 */

const WAHA_API_URL = process.env.WAHA_API_URL || 'http://100.96.203.105:3001';
const WAHA_SESSION = process.env.WAHA_SESSION || 'default';
const WAHA_TIMEOUT_MS = 30_000;

/** Format a phone number for WAHA: +27xxx / 0xxx / 27xxx → 27xxx@c.us */
export function formatPhoneForWaha(phone: string): string {
  let cleaned = phone.replace(/[^\d]/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '27' + cleaned.substring(1);
  }
  return `${cleaned}@c.us`;
}

/** Send an individual WhatsApp DM via WAHA. Throws on HTTP failure. */
export async function sendWahaDm(phone: string, message: string): Promise<void> {
  const chatId = formatPhoneForWaha(phone);

  const response = await fetch(`${WAHA_API_URL}/api/sendText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session: WAHA_SESSION,
      chatId,
      text: message,
    }),
    signal: AbortSignal.timeout(WAHA_TIMEOUT_MS),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => 'unknown');
    throw new Error(`WAHA DM failed: HTTP ${response.status} — ${text}`);
  }
}
