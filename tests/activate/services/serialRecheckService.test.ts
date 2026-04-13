import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db-neon', () => ({
  neon: vi.fn(() => vi.fn()),
}));

vi.mock('@/modules/activate/services/waPhotoExtraction', () => ({
  extractUpsSerialRecheck: vi.fn(),
  extractOntSerialRecheck: vi.fn(),
}));

vi.mock('@/services/vlmLearningService', () => ({
  recordVlmCorrection: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { determineRecheckOutcome, buildRecheckWaMessage } from '@/modules/activate/services/serialRecheckService';

describe('determineRecheckOutcome', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns correction when confidence > 0.85 and matches 1Map', () => {
    const result = determineRecheckOutcome({
      secondPassSerial: 'GU18W12V2511020289',
      confidence: 0.9,
      onemapSerial: 'GU18W12V2511020289',
    });
    expect(result).toBe('correction');
  });

  it('returns verify when confidence > 0.85 but does NOT match 1Map', () => {
    const result = determineRecheckOutcome({
      secondPassSerial: 'GU18W12V9999999999',
      confidence: 0.9,
      onemapSerial: 'GU18W12V2511020289',
    });
    expect(result).toBe('verify');
  });

  it('returns verify when confidence between 0.65 and 0.85', () => {
    const result = determineRecheckOutcome({
      secondPassSerial: 'GU18W12V2511020289',
      confidence: 0.75,
      onemapSerial: 'GU18W12V2511020289',
    });
    expect(result).toBe('verify');
  });

  it('returns unclear when confidence is below 0.65', () => {
    const result = determineRecheckOutcome({
      secondPassSerial: null,
      confidence: 0.4,
      onemapSerial: 'GU18W12V2511020289',
    });
    expect(result).toBe('unclear');
  });

  it('returns unclear when second pass serial is null', () => {
    const result = determineRecheckOutcome({
      secondPassSerial: null,
      confidence: 0,
      onemapSerial: 'GU18W12V2511020289',
    });
    expect(result).toBe('unclear');
  });
});

describe('buildRecheckWaMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('formats correction message correctly', () => {
    const msg = buildRecheckWaMessage({
      dropNumber: 'DR474849',
      serialType: 'ups',
      outcome: 'correction',
      onemapSerial: 'GU18W12V2511020289',
      firstPassSerial: 'GUJ8W12V12511020289',
      secondPassSerial: 'GU18W12V2511020289',
      confidence: 0.92,
    });
    expect(msg).toContain('DR474849');
    expect(msg).toContain('1Map serial confirmed');
    expect(msg).toContain('GU18W12V2511020289');
    expect(msg).toContain('No action needed');
  });

  it('formats verify message with confidence percent', () => {
    const msg = buildRecheckWaMessage({
      dropNumber: 'DR474849',
      serialType: 'ups',
      outcome: 'verify',
      onemapSerial: 'GU18W12V2511020289',
      firstPassSerial: 'GUJ8W12V12511020289',
      secondPassSerial: 'GUJ8W12V12511020289',
      confidence: 0.72,
    });
    expect(msg).toContain('72%');
    expect(msg).toContain('Please verify');
  });

  it('formats unclear message', () => {
    const msg = buildRecheckWaMessage({
      dropNumber: 'DR474849',
      serialType: 'ups',
      outcome: 'unclear',
      onemapSerial: 'GU18W12V2511020289',
      firstPassSerial: 'GUJ8W12V12511020289',
      secondPassSerial: null,
      confidence: 0,
    });
    expect(msg).toContain("couldn't read");
    expect(msg).toContain('1Map: GU18W12V2511020289');
  });
});
