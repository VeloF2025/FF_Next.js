import { describe, it, expect } from 'vitest';
import { classifyFile, processProjectGroup, type BundleFile } from '../bundleProcessor';

function mk(name: string): BundleFile {
  return { originalName: name, filepath: '/tmp/x', size: 0 };
}

describe('classifyFile — project hint extraction', () => {
  it('extracts hint from standard payment PDF', () => {
    const c = classifyFile(mk('Lawley WE260419.pdf'));
    expect(c.kind).toBe('ft-payment-pdf');
    expect(c.projectHint).toBe('Lawley');
  });

  it('extracts hint from notes XLSX', () => {
    const c = classifyFile(mk('Lawley WE260419 notes.xlsx'));
    expect(c.kind).toBe('notes-xlsx');
    expect(c.projectHint).toBe('Lawley');
  });

  it('extracts hint from zone uptake PDF', () => {
    const c = classifyFile(mk('Tembisa POP01_installation uptake per zone_260419.pdf'));
    expect(c.kind).toBe('zone-uptake-pdf');
    expect(c.projectHint).toBe('Tembisa POP01');
  });

  it('strips trailing " notes" from misnamed notes file without WE-code', () => {
    const c = classifyFile(mk('Tembisa POP01 notes.xlsx'));
    expect(c.kind).toBe('notes-xlsx');
    expect(c.projectHint).toBe('Tembisa POP01');
  });

  it('strips FT site-code prefix + trailing " notes" ("059 TEM POP01 notes" → "TEM POP01")', () => {
    const c = classifyFile(mk('059 TEM POP01 notes.xlsx'));
    expect(c.kind).toBe('notes-xlsx');
    expect(c.projectHint).toBe('TEM POP01');
  });

  it('strips FT site-code prefix on payment PDF', () => {
    const c = classifyFile(mk('059 Tembisa POP01 WE260419.pdf'));
    expect(c.kind).toBe('ft-payment-pdf');
    expect(c.projectHint).toBe('Tembisa POP01');
  });

  // WE260726: FT shipped the POP03 notes workbook as a print-to-PDF and left
  // the payment summary out. The catch-all `.pdf` branch claimed it as the
  // payment PDF, which parsed to weekEnding='' and hit the DB as
  // `invalid input syntax for type date: ""`.
  it('classifies a notes PDF as notes-pdf, NOT as the payment PDF', () => {
    const c = classifyFile(mk('Tembisa POP03 WE260726 notes.pdf'));
    expect(c.kind).toBe('notes-pdf');
    expect(c.projectHint).toBe('Tembisa POP03');
  });

  it('classifies a notes PDF without a WE-code as notes-pdf', () => {
    const c = classifyFile(mk('060 TEM POP03 notes.pdf'));
    expect(c.kind).toBe('notes-pdf');
    expect(c.projectHint).toBe('TEM POP03');
  });

  it('still classifies uptake PDFs ahead of the notes-PDF branch', () => {
    expect(classifyFile(mk('Lawley_installation uptake per zone per pon_260726.pdf')).kind)
      .toBe('zone-pon-uptake-pdf');
    expect(classifyFile(mk('Lawley_installation uptake per zone_260726.pdf')).kind)
      .toBe('zone-uptake-pdf');
  });
});

describe('processProjectGroup — notes PDF does not become a payment summary', () => {
  it('leaves summary null and warns when the group holds only a notes PDF', async () => {
    const group = {
      projectHint: 'Tembisa POP03',
      files: [classifyFile(mk('Tembisa POP03 WE260726 notes.pdf'))].map((f) => ({
        ...f,
        filepath: '/tmp/notes.pdf',
      })),
    };

    const result = await processProjectGroup(
      group,
      () => Buffer.from('irrelevant — a notes PDF is never handed to a parser'),
      [{ id: 'p-1', name: 'Tembisa POP03' }],
    );

    // summary===null is what routes the import to the "No FT payment PDF in
    // bundle — skipping DB write" branch instead of writing week_ending=''.
    expect(result.summary).toBeNull();
    expect(result.fatalError).toBeNull();
    expect(result.parseWarnings.some((w) => w.includes('Ignored notes PDF'))).toBe(true);
  });
});
