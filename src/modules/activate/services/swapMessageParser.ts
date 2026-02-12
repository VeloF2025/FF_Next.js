/**
 * Parser for ONT swap messages from WhatsApp pre-provision groups.
 *
 * Extracts structured data from free-form or semi-structured messages like:
 *   "Pre provision ALCLB48DC6B6 DR1853558 ACTIVE ✅"
 *   "Encrypted ONT ALCLB48DC6B6 DR1853558"
 */

export interface ParsedSwapMessage {
  dropNumber: string;
  newSerial: string;
  swapType: 'pre_provision' | 'encrypted_ont';
  oesStatus: string | null;
  reason: string | null;
  confidence: 'high' | 'medium' | 'low';
}

// DR number pattern: DR followed by 6-8 digits, optional space/dash separator
const DR_PATTERN = /DR[\s-]?(\d{6,8})/i;

// Nokia ONT serial pattern: ALC followed by L or B then 6-12 hex chars
const SERIAL_PATTERN = /ALC[LB][A-Z0-9]{6,12}/gi;

// OES status keywords
const STATUS_PATTERN = /\b(ACTIVE|INACTIVE)\b/i;

// Swap type detection
const PRE_PROVISION_PATTERN = /pre[\s._-]?provis/i;
const ENCRYPTED_PATTERN = /encrypt/i;

/**
 * Parse a WhatsApp message for ONT swap information.
 * Returns null if no DR number or serial found.
 */
export function parseSwapMessage(text: string): ParsedSwapMessage | null {
  if (!text || text.trim().length === 0) return null;

  const normalized = text.replace(/\s+/g, ' ').trim();

  // Extract DR number
  const drMatch = normalized.match(DR_PATTERN);
  if (!drMatch) return null;
  const dropNumber = `DR${drMatch[1]}`;

  // Extract serial(s) — take the first match
  const serialMatches = normalized.match(SERIAL_PATTERN);
  if (!serialMatches || serialMatches.length === 0) return null;
  const newSerial = serialMatches[0].toUpperCase();

  // Detect swap type
  let swapType: 'pre_provision' | 'encrypted_ont' = 'pre_provision';
  if (ENCRYPTED_PATTERN.test(normalized)) {
    swapType = 'encrypted_ont';
  } else if (PRE_PROVISION_PATTERN.test(normalized)) {
    swapType = 'pre_provision';
  }

  // Extract OES status
  const statusMatch = normalized.match(STATUS_PATTERN);
  const oesStatus = statusMatch?.[1]?.toUpperCase() ?? null;

  // Extract reason — text after status/emoji or after "reason:"
  let reason: string | null = null;
  const reasonExplicit = normalized.match(/reason\s*[:=]\s*(.+)/i);
  if (reasonExplicit?.[1]) {
    reason = reasonExplicit[1].trim();
  } else {
    // Try text after last recognized token (status, emoji, serial, DR)
    const afterStatus = normalized.match(/(?:ACTIVE|INACTIVE)\s*[✅❌✓]?\s*[-–—]?\s*(.+)/i);
    if (afterStatus?.[1] && afterStatus[1].trim().length > 3) {
      reason = afterStatus[1].trim();
    }
  }

  // Determine confidence
  let confidence: 'high' | 'medium' | 'low' = 'low';
  if (drMatch && serialMatches.length >= 1 && (PRE_PROVISION_PATTERN.test(normalized) || ENCRYPTED_PATTERN.test(normalized))) {
    confidence = oesStatus ? 'high' : 'medium';
  } else if (drMatch && serialMatches.length >= 1) {
    confidence = 'medium';
  }

  return {
    dropNumber,
    newSerial,
    swapType,
    oesStatus,
    reason,
    confidence,
  };
}
