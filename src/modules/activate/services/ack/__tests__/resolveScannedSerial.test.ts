/**
 * resolveScannedSerial.test.ts
 * Unit tests for GS1 DataMatrix dump resolution in ack serial fields.
 */
import { describe, it, expect } from 'vitest';
import { resolveScannedSerial, generateAckMessage } from '../ackMessageBuilder';
import {
  looksLikeOntSerial,
  looksLikeGizzuSerial,
} from '@/modules/activate/services/qaAutoFailService';

// Real GS1 2D DataMatrix payload as scanned into the ONT field, with the true
// serial (ALCLB48DE9FE) embedded and followed by more field data (no delimiter).
const GS1_DUMP =
  '[)>1P3TN01414BASALCLB48DE9FE18VLENOK2P011VOM02D2508294LCN20SM022535ALU0005993223S80AE3C6BF78E';

describe('resolveScannedSerial', () => {
  it('returns null for null input', () => {
    expect(resolveScannedSerial(null, 'ALCLB48DE9FE', looksLikeOntSerial)).toBeNull();
  });

  it('returns a clean ONT serial trimmed, preserving original case for display', () => {
    expect(resolveScannedSerial('  ALCLB48DE9FE ', 'ALCLB48DE9FE', looksLikeOntSerial)).toBe(
      'ALCLB48DE9FE'
    );
  });

  it('extracts the embedded serial from a GS1 dump that contains the VLM read', () => {
    expect(resolveScannedSerial(GS1_DUMP, 'ALCLB48DE9FE', looksLikeOntSerial)).toBe('ALCLB48DE9FE');
  });

  it('leaves the raw dump unchanged when the VLM read is NOT embedded in it', () => {
    // VLM read a different serial — this is a genuine discrepancy, not a dump match.
    expect(resolveScannedSerial(GS1_DUMP, 'ALCLB48FFFFF', looksLikeOntSerial)).toBe(GS1_DUMP);
  });

  it('leaves the raw dump unchanged when there is no VLM anchor', () => {
    expect(resolveScannedSerial(GS1_DUMP, null, looksLikeOntSerial)).toBe(GS1_DUMP);
  });

  it('ignores a short / non-serial VLM anchor (no spurious substring match)', () => {
    // 'ALCL' appears inside the dump but is not a valid serial — must not anchor.
    expect(resolveScannedSerial(GS1_DUMP, 'ALCL', looksLikeOntSerial)).toBe(GS1_DUMP);
  });

  it('returns null for a whitespace-only field (treated as not scanned)', () => {
    expect(resolveScannedSerial('   ', 'ALCLB48DE9FE', looksLikeOntSerial)).toBeNull();
  });

  it('resolves a UPS serial field using the Gizzu check', () => {
    const upsDump = 'NOISE-GU18W12V2509031056-TRAILER';
    expect(resolveScannedSerial(upsDump, 'GU18W12V2509031056', looksLikeGizzuSerial)).toBe(
      'GU18W12V2509031056'
    );
  });
});

describe('generateAckMessage — VLM confidence gate for GS1 resolution', () => {
  // A GS1 dump in the ONT field whose embedded serial (ALCLB48DE9FE) is a valid
  // serial. Resolution must happen ONLY when the VLM read is trusted (>=95%).
  const ackArgs = (confidence: number) =>
    generateAckMessage(
      'DR1234567',
      true,
      3,
      GS1_DUMP, // ontSerial (the raw dump)
      null, // upsSerial
      { hasPhoto: true, photoCount: 1 },
      { ontSerial: 'ALCLB48DE9FE', upsSerial: null, confidence, ontConfidence: confidence }
    ).message;

  it('does NOT resolve/extract at 0.94 confidence (raw dump preserved, no false ✅)', () => {
    const msg = ackArgs(0.94);
    expect(msg).toContain('[)>'); // raw dump still shown — sub-threshold read not trusted
    expect(msg).not.toContain('🟡 *ONT Serial MISMATCH:*'); // and no false mismatch fired
  });

  it('resolves to the clean embedded serial at 0.96 confidence (no dump shown)', () => {
    const msg = ackArgs(0.96);
    expect(msg).toContain('ALCLB48DE9FE');
    expect(msg).not.toContain('[)>'); // dump collapsed to the embedded serial
    expect(msg).not.toContain('🟡 *ONT Serial MISMATCH:*'); // and it's treated as a match
  });
});
