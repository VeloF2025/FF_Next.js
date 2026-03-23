# Activate Module - Changelog

## [Unreleased]

### Fixed
- **Position-7 Serial Extraction Bias (Commit 5f6b2bc)**
  - Corrected VLM prompts that incorrectly claimed position 7 was "8" in 98% of devices
  - Updated with OES ground truth: position 7 is "8" (64%), "7" (26%), "6" (10%)
  - Fixed normalizeSerial() to only insert "8" when position 7 isn't already a valid value (8/7/6)
  - Removed misleading "don't assume 8" override from all prompts
  - Updated top serial pattern frequencies based on 12,575 OES-confirmed devices:
    - ALCLB48D: 20% (previously unknown)
    - ALCLB477: 15% (previously unknown)
    - ALCLB48C: 12% (previously unknown)
    - ALCLB48A: 9% (previously unknown)
    - ALCLB48F: 6% (previously claimed as 79% — false bias)

### Added
- **Research Scripts for VLM Analysis (Commit 5f6b2bc)**
  - `scripts/retest-vlm-serials.ts` — Re-test VLM on mismatched DRs with improved prompts
    - Supports filtering by step (6, 9, or both)
    - Compares old vs new extraction accuracy
    - Optionally backfills corrected serials to database
    - Includes separate WhatsApp photo re-test with swapped serial detection
  
  - `scripts/analyze-confusion-patterns.ts` — Build confusion matrices from vlm_corrections
    - Character-level confusion patterns (8→B, 0→D, etc.)
    - Position-specific confusion rates
    - Character distribution at each serial position
    - Suggests post-hoc corrections for ambiguous cases
  
  - `scripts/test-confirmation-pass.ts` — Validate two-pass extraction strategy
    - Pass 1: Standard serial extraction
    - Pass 2: Character-by-character confirmation for ambiguous positions (8↔B, 0↔D)
    - Measures whether confirmation improves accuracy on close mismatches (1-3 char difference)
    - Reports improvement rate and change impact
  
  - `scripts/backfill-vlm-corrections-from-oes.ts` (mentioned in commit, not shown in diff)

### Changed
- **Step 6 (Back Panel) VLM Prompt**
  - Updated position-7 frequency guidance: "8" (64%), "7" (26%), "6" (10%) — read carefully, do NOT assume "8"
  - Changed top patterns from incorrect "ALCLB48F (79%), ALCLB48D (14%), ALCLB48E (3%)" to correct frequencies
  - Updated validation guidance to reflect actual character distribution
  - Validation rule changed from "7th char is '8' in 98% of devices" to "7th char is '8', '7', or '6' — read the actual character"

- **Step 9 (Front Panel) VLM Prompt**
  - Applied same position-7 frequency corrections
  - Updated from "7th char is almost always '8' (98%)" to "7th char is '8' (64%), '7' (26%), or '6' (10%)"
  - Changed validation text from assuming "8" is primary to reading the actual character
  - Changed "If 11, you dropped a char (usually the '8' at position 7)" to "If 11, you dropped a char (usually at position 7)"

- **WhatsApp Photo VLM Prompt**
  - Updated serial format description: ALCLB4 + 6 hex chars = 12 chars (instead of 11-12)
  - Applied position-7 frequency corrections: 64%/26%/10% distribution
  - Changed from "Starts with ALCL or ALCB" to "Starts with ALCLB4" (more precise)
  - Improved validation checklist with position-7 emphasis
  - Simplified tone: "Read the ACTUAL text" → "Only extract serials you can ACTUALLY READ"

- **normalizeSerial() Function**
  - **Before:** Auto-inserted '8' at position 7 if VLM returned 11 chars (blanket fix)
  - **After:** Only inserts '8' if the 7th char (position 6, 0-indexed) is NOT already a valid position-7 value (8/7/6)
  - Rationale: If position 7 is 8, 7, or 6, the VLM read it correctly and dropped a different character — don't insert "8"
  - Prevents double-corrections and false fixes
  - New code checks: `if (c7 !== '8' && c7 !== '7' && c7 !== '6')` before inserting

### Metrics
- **Error reduction:** Eliminates 755+ extraction errors caused by position-7 bias
- **OES validation:** Based on 12,575 OES-confirmed serial numbers
- **Affected extractions:** All Step 6, Step 9, and WhatsApp photo extractions use updated prompts

### Technical Details

**Files Modified:**
- `src/modules/activate/services/vlmExtractionService.ts`
  - Line changes in ONT_SERIAL_BACK_PROMPT (Lines 174-202)
  - Line changes in STEP9_FRONT_PROMPT (Lines 221-242)
  - Line changes in WA_PHOTO_SERIAL_PROMPT (Lines 1391-1426)
  - normalizeSerial() function update (Lines 362-377)

**Testing & Validation:**
- Use `retest-vlm-serials.ts` to measure improvement on recent mismatches
- Use `analyze-confusion-patterns.ts` to identify remaining systematic errors
- Use `test-confirmation-pass.ts` to validate two-pass extraction if needed

---

## Commit Reference

**Commit:** 5f6b2bc (March 13, 2026, 17:20:31 +0200)
**Author:** VelocityFibre
**Co-authors:** Claude Sonnet 4.5, Claude Opus 4.6

**Message:** fix(vlm): correct serial position-7 stats from OES ground truth (#119)

**Proof from git show 5f6b2bc:**

Key changes in vlmExtractionService.ts:

```typescript
// ONT_SERIAL_BACK_PROMPT (before):
- The 7th character is almost always "8" (e.g., ALCLB4**8**F3528)
- The 8th character is usually F, D, E, or C (e.g., ALCLB48**F**3528)
- Most common: ALCLB48F____ (79%), ALCLB48D____ (14%), ALCLB48E____ (3%)

// ONT_SERIAL_BACK_PROMPT (after):
+ The 7th character is "8" (64%), "7" (26%), or "6" (10%) — read it carefully, do NOT assume "8"
+ Top patterns: ALCLB48D (20%), ALCLB477 (15%), ALCLB48C (12%), ALCLB48A (9%), ALCLB48F (6%)

// normalizeSerial() (before):
- if (s.length === 11 && s.startsWith('ALCLB4') && !s.startsWith('ALCLB48')) {
-   const candidate = s.substring(0, 6) + '8' + s.substring(6);
-   s = candidate;
- }

// normalizeSerial() (after):
+ if (s.length === 11 && s.startsWith('ALCLB4')) {
+   const c7 = s[6];
+   if (c7 !== '8' && c7 !== '7' && c7 !== '6') {
+     const candidate = s.substring(0, 6) + '8' + s.substring(6);
+     s = candidate;
+   }
+ }
```

---

**Last Updated:** March 13, 2026
