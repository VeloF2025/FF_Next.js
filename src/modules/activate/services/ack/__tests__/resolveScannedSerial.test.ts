/**
 * resolveScannedSerial.test.ts
 * Unit tests for GS1 DataMatrix dump resolution in ack serial fields.
 */
import { describe, it, expect } from 'vitest';
import { resolveScannedSerial } from '../ackMessageBuilder';
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

  it('resolves a UPS serial field using the Gizzu check', () => {
    const upsDump = 'NOISE-GU18W12V2509031056-TRAILER';
    expect(resolveScannedSerial(upsDump, 'GU18W12V2509031056', looksLikeGizzuSerial)).toBe(
      'GU18W12V2509031056'
    );
  });
});
