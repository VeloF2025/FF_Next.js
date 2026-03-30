/**
 * VLM Prompts
 *
 * Purpose: Centralised prompt strings for ONT serial extraction.
 * Kept separate so extraction modules stay within the 400-line limit.
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

// ============================================================================
// STEP 6 — BACK OF ONT
// ============================================================================

/**
 * Prompt for ONT serial extraction from back (Step 6).
 *
 * Nokia labels have multiple fields that look similar:
 * - S/N: ALCLB6A9C97 ← THIS IS THE SERIAL (starts with ALCL or ALCB)
 * - SSID: ALHN-C397 ← NOT the serial (starts with ALHN)
 * - ONT P/N: STN0145844A ← NOT the serial (model/part number)
 * - MAC ID: 804E3CBE680 ← NOT the serial (MAC address)
 */
export const ONT_SERIAL_BACK_PROMPT = `You are extracting the ONT serial number from the BACK of a Nokia/Alcatel device.

THE SERIAL FORMAT (memorize this):
- Pattern: ALCLB4 + two hex chars + four hex chars = exactly 12 characters
- The 7th character is "8" (64%), "7" (26%), or "6" (10%) — read it carefully, do NOT assume "8"
- Hex chars only: 0-9 and A-F. Never letters like M, N, P, R, S, Y, Z.
- Top patterns: ALCLB48D (20%), ALCLB477 (15%), ALCLB48C (12%), ALCLB48A (9%), ALCLB48F (6%)

WHERE TO FIND IT:
- Look for the "S/N:" field on the white product label
- Below the MAC ID line, above or near the barcode
- The barcode encodes this same serial

❌ DO NOT EXTRACT THESE (common mistakes):
- SSID: starts with "ALHN-" (WiFi name)
- Part number: starts with "STN" (model number)
- MAC: 12 hex chars without "ALCLB4" prefix
- IP address: 192.168.x.x
- DR number: DR followed by digits

⚠️ CRITICAL VALIDATION — check your answer:
1. Is it exactly 12 characters? If not, re-read. You likely dropped a character.
2. Does it start with ALCLB4? If not, you're reading the wrong field.
3. Is the 7th char "8", "7", or "6"? Read the actual character — don't guess.
4. Are all characters hex (0-9, A-F)? Letters like M, N, P, R, Y mean OCR error.
5. Does it look like "ALCL" + digits only (no "B4")? You're reading something else.

Respond in this exact JSON format:
{
  "found": true/false,
  "serial": "<12-char serial starting with ALCLB4, or null>",
  "rawText": "<exact text you read from the S/N field>",
  "confidence": <0.0 to 1.0>
}

If you cannot confidently read a 12-character serial starting with ALCLB4, return found: false.
Returning null is ALWAYS better than guessing.`;

// ============================================================================
// STEP 9 — FRONT PANEL
// ============================================================================

/**
 * Prompt for Step 9 front panel extraction (ONT serial + DR number + green lights).
 */
export const STEP9_FRONT_PROMPT = `You are analyzing the FRONT of a Nokia/Alcatel ONT device with installation labels.

Look for THREE items:

1. GREEN STATUS LIGHTS - Are LEDs illuminated (POWER, PON, LAN, WLAN)?

2. ONT SERIAL NUMBER - on a small white sticker attached to the front:
   FORMAT: ALCLB4 + 6 hex characters = exactly 12 characters total
   - The 7th char is "8" (68.3%), "7" (23.1%), or "6" (8.6%) — read it carefully, do NOT assume "8"
   - Top patterns: ALCLB48D (20%), ALCLB477 (15%), ALCLB48C (12%), ALCLB48A (9%), ALCLB480 (7%), ALCLB48F (6%)
   - Only hex chars after ALCLB4: digits 0-9 and letters A-F
   - NEVER letters like M, N, P, R, S, Y, Z — those mean you misread

   ⚠️ THESE ARE NOT THE SERIAL (frequently confused):
   - DR numbers (DR1736721) — this is the drop reference, NOT the serial
   - Model numbers (840F, 8408) — these are Nokia product codes
   - SSID (ALHN-C397) — this is a WiFi network name
   - Any number without the "ALCLB4" prefix

   ⚠️ VALIDATION CHECKLIST (check before answering):
   - Exactly 12 characters? If 11, you dropped a char (usually at position 7)
   - Starts with ALCLB4? If "ALCL" + random chars, you read the wrong label
   - Only hex after ALCLB4? M/N/P/R/Y = misread
   - Looks like a phone number or DR number? WRONG field

   ⚠️ MULTIPLE SERIAL LABELS WARNING:
   The front of the ONT may have MULTIPLE stickers with serial numbers.
   - READ ONLY the small white sticker ATTACHED to the ONT front panel (usually hand-applied)
   - IGNORE any serial printed on the original packaging/box visible behind the ONT
   - IGNORE any serial on the product's factory label (usually on the back or bottom)
   - If you see multiple ALCLB4 serials, prefer the one on the SMALLEST, most recently applied sticker
   - The front sticker serial should DIFFER from any serial visible on the back label

   DO NOT return the same serial for every photo — each ONT has a UNIQUE serial.
   If you cannot distinguish the front sticker serial from other labels, return found: false.

3. DR NUMBER - handwritten/printed label: "DR" + 6-7 digits (e.g., DR1736721)

   ⚠️ DR NUMBER RULES:
   - CRITICAL: Read ONLY from THIS photo. Do NOT reuse a DR number from memory.
   - Format: "DR" followed by 6-7 numeric digits ONLY (no letters after "DR")
   - If you cannot read it clearly, return found: false — never guess or invent
   - Common digit confusion on handwritten labels: 9↔4, 8↔6, 0↔8, 5↔3
   - Pay extra attention to the last 2-3 digits (most error-prone on handwritten labels)
   - If it looks like a serial number (ALCLB4...) or phone number, WRONG field

Respond in this exact JSON format:
{
  "greenLightsVisible": true/false,
  "ontSerial": {
    "found": true/false,
    "serial": "<12-char serial starting with ALCLB4, or null>",
    "rawText": "<exact text you read from the sticker>",
    "confidence": <0.0 to 1.0>
  },
  "drNumber": {
    "found": true/false,
    "drNumber": "<DR number like DR1234567, or null>",
    "rawText": "<exact text from label>",
    "confidence": <0.0 to 1.0>
  }
}

CRITICAL: If you cannot read a clear 12-char serial starting with ALCLB4, return found: false.
Returning null is ALWAYS better than guessing. Do NOT invent or fabricate serial numbers.`;
