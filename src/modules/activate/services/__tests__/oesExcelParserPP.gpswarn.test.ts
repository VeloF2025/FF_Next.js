/**
 * The PP Address-link parser is the only source of PP GPS. If Fibertime changes
 * its maps URL template, extraction returns null and GPS silently stops flowing.
 * These tests pin the observability signal added for that: a warning when an
 * Address-link formula is present but yields no coordinates, and silence when it
 * parses fine.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as XLSX from 'xlsx';

// vi.hoisted: createLogger() runs at oesExcelParser module-load (during the
// hoisted import below), so mockWarn must exist before a plain `const` would.
const { mockWarn } = vi.hoisted(() => ({ mockWarn: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: mockWarn, error: vi.fn(), debug: vi.fn() }),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { parsePPDataSheet } from '../oes/oesExcelParser';

function ppWorkbook(addressLinkFormula: string): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['Project', 'Serial Number', 'Date', 'Address link'],
    ['MOA', 'SER1', '2026-01-01', ''],
  ]);
  // HYPERLINK cells carry the URL in the formula (f) with an empty cached value.
  ws['D2'] = { t: 's', f: addressLinkFormula, v: '' };
  XLSX.utils.book_append_sheet(wb, ws, 'PP DATA');
  return wb;
}

describe('parsePPDataSheet — GPS parse-failure observability', () => {
  beforeEach(() => mockWarn.mockClear());

  it('warns when an Address-link formula is present but yields no coordinates', () => {
    // A maps URL shape MAPS_LINK_COORDS does not match (path form, not ?q=).
    const rows = parsePPDataSheet(ppWorkbook('HYPERLINK("https://www.google.com/maps/@-26.7,27.0,17z","View")'));
    expect(rows).not.toBeNull();
    expect(mockWarn).toHaveBeenCalledOnce();
    expect(String(mockWarn.mock.calls[0][0])).toMatch(/Fibertime URL template may have changed/);
  });

  it('does not warn when the Address-link formula parses to coordinates', () => {
    parsePPDataSheet(ppWorkbook('HYPERLINK("https://maps.google.com/?q=-26.7,27.0","View")'));
    expect(mockWarn).not.toHaveBeenCalled();
  });
});
