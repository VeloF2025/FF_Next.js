import { describe, it, expect } from 'vitest';
import { classifyFile, type BundleFile } from '../bundleProcessor';

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
});
