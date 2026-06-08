import { validateSerialFormat, serialsMatch } from '../verifySerial';

describe('validateSerialFormat — ONT', () => {
  test('valid ALCL serial passes', () => {
    expect(validateSerialFormat('ALCLB4ABC123', 'ont').valid).toBe(true);
  });
  test('lowercase normalised — passes', () => {
    expect(validateSerialFormat('alclb4abc123', 'ont').valid).toBe(true);
  });
  test('GU serial fails for ONT', () => {
    const r = validateSerialFormat('GU18WXXXXXX', 'ont');
    expect(r.valid).toBe(false);
    expect(r.message).toContain('ALCL');
  });
  test('random serial fails', () => {
    expect(validateSerialFormat('RANDOMSERIAL', 'ont').valid).toBe(false);
  });
  test('normalised is uppercased', () => {
    expect(validateSerialFormat('alclb4abc123', 'ont').normalised).toBe('ALCLB4ABC123');
  });
});

describe('validateSerialFormat — UPS', () => {
  test('valid GU serial passes', () => {
    expect(validateSerialFormat('GU18WXXXXXX', 'ups').valid).toBe(true);
  });
  test('ALCL serial fails for UPS', () => {
    const r = validateSerialFormat('ALCLB4ABC123', 'ups');
    expect(r.valid).toBe(false);
    expect(r.message).toContain('GU');
  });
});

describe('serialsMatch (cross-reference, fuzzy)', () => {
  test('exact match', () => {
    expect(serialsMatch('ALCLB4ABC123', 'ALCLB4ABC123')).toBe(true);
  });
  test('1 char difference — pass', () => {
    expect(serialsMatch('ALCLB4ABC124', 'ALCLB4ABC123')).toBe(true);
  });
  test('2 char difference — pass', () => {
    expect(serialsMatch('ALCLB4ABX124', 'ALCLB4ABC123')).toBe(true);
  });
  test('3 char difference — fail', () => {
    expect(serialsMatch('ALCLB4AXX124', 'ALCLB4ABC123')).toBe(false);
  });
});
