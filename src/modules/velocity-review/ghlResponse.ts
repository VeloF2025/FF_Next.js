/**
 * Pure helpers for reading GoHighLevel response shapes.
 *
 * Split out of ghlClient.ts to keep that file under the 300-line cap. Deliberately
 * excludes contactFrom(), which throws HighLevelRequestError and would make this a
 * runtime import cycle rather than the type-only relationship it has now.
 */
const MAX_ERROR_TEXT_LENGTH = 160;

export function retryAfterSeconds(response: Response): number | undefined {
  const value = response.headers.get('Retry-After')?.trim();
  return value && /^(0|[1-9]\d*)$/.test(value) ? Number(value) : undefined;
}

export function isWhatsappDndBlocked(contact: Record<string, unknown>): boolean {
  if (contact.dnd === true) return true;
  const dndSettings = contact.dndSettings;
  if (!dndSettings || typeof dndSettings !== 'object') return false;
  const whatsapp = (dndSettings as Record<string, unknown>).WhatsApp;
  if (!whatsapp || typeof whatsapp !== 'object') return false;
  const status = (whatsapp as Record<string, unknown>).status;
  return status === 'active' || status === 'permanent';
}

// Narrow: only an object carrying an explicit null/absent `contact` counts as "no
// duplicate". Anything else (a malformed body, a contact without an id) still reaches
// contactFrom and throws, so genuine protocol errors are not silently swallowed here.
export function isAbsentDuplicate(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (!('contact' in value)) return false;
  return (value as Record<string, unknown>).contact == null;
}

export function safeErrorText(raw: string, token: string): string {
  let text = raw.slice(0, MAX_ERROR_TEXT_LENGTH);
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const message = parsed.message ?? parsed.error;
    text = Array.isArray(message) ? message.join(', ') : String(message ?? text);
  } catch {
    // A non-JSON error body is bounded below and never required for correctness.
  }
  return text.slice(0, MAX_ERROR_TEXT_LENGTH)
    .replaceAll(token, '[redacted]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[redacted]');
}
