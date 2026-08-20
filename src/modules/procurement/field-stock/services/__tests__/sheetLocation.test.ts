/**
 * resolveSheetLocation — map a workbook tab name onto a stock_location.
 *
 * The workbook's tab names do not equal the warehouse names, and the mismatches
 * are of three different kinds (all present in the live data as of 2026-08-20):
 *   Lawley       → "Lawley"          exact
 *   Mamelodi     → "Mamelodi Pop1"   the warehouse name carries a suffix
 *   Tembelilhle  → "Tembelihle"      the tab is misspelled
 *   Thembisa     → Tembisa 1 | 2 | 3 genuinely ambiguous — must NOT be guessed
 *
 * Guessing on the ambiguous case would silently receive 2,520 serials into the
 * wrong warehouse, so an ambiguous or unknown tab is refused with a reason.
 */
import { describe, it, expect } from 'vitest';
import { resolveSheetLocation, NON_PROJECT_SHEETS } from '../sheetLocation';
import type { LocationRef } from '../sheetLocation';

/** The live warehouse rows this resolver has to cope with. */
const LOCATIONS: LocationRef[] = [
  { id: 'loc-lawley', name: 'Lawley' },
  { id: 'loc-mohadin', name: 'Mohadin' },
  { id: 'loc-mamelodi', name: 'Mamelodi Pop1' },
  { id: 'loc-etwatwa', name: 'Etwatwa' },
  { id: 'loc-tembelihle', name: 'Tembelihle' },
  { id: 'loc-tembisa1', name: 'Tembisa 1' },
  { id: 'loc-tembisa2', name: 'Tembisa 2' },
  { id: 'loc-tembisa3', name: 'Tembisa 3' },
  { id: 'loc-grabouw', name: 'Grabouw' },
  { id: 'loc-ivory', name: 'Ivory Park' },
];

describe('resolveSheetLocation', () => {
  it('matches an exact name', () => {
    expect(resolveSheetLocation('Lawley', LOCATIONS)).toEqual({
      ok: true, locationId: 'loc-lawley', locationName: 'Lawley', how: 'exact',
    });
  });

  it('ignores case and surrounding whitespace', () => {
    expect(resolveSheetLocation('  mOhAdIn ', LOCATIONS)).toMatchObject({
      ok: true, locationId: 'loc-mohadin',
    });
  });

  it('matches a warehouse whose name carries a suffix', () => {
    expect(resolveSheetLocation('Mamelodi', LOCATIONS)).toEqual({
      ok: true, locationId: 'loc-mamelodi', locationName: 'Mamelodi Pop1', how: 'prefix',
    });
  });

  it('matches a misspelled tab to the intended warehouse', () => {
    expect(resolveSheetLocation('Tembelilhle', LOCATIONS)).toEqual({
      ok: true, locationId: 'loc-tembelihle', locationName: 'Tembelihle', how: 'fuzzy',
    });
  });

  it('REFUSES an ambiguous tab rather than picking a warehouse', () => {
    // No aliases: this is the resolver's own behaviour when names cannot decide.
    const result = resolveSheetLocation('Thembisa', LOCATIONS, {});
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('ambiguous');
    expect(result.ok === false && result.candidates).toEqual(['Tembisa 1', 'Tembisa 2', 'Tembisa 3']);
  });

  it('honours an explicit alias for a tab names cannot disambiguate', () => {
    expect(resolveSheetLocation('Thembisa', LOCATIONS, { thembisa: 'Tembisa 1' })).toEqual({
      ok: true, locationId: 'loc-tembisa1', locationName: 'Tembisa 1', how: 'alias',
    });
  });

  it('reports an alias pointing at a warehouse that no longer exists', () => {
    const result = resolveSheetLocation('Thembisa', LOCATIONS, { thembisa: 'Closed Depot' });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('alias-target-missing');
  });

  it('refuses the summary and info tabs by name, never by accident', () => {
    for (const sheet of NON_PROJECT_SHEETS) {
      const result = resolveSheetLocation(sheet, LOCATIONS);
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason).toBe('not-a-project');
    }
  });

  it('the shipped alias table resolves the live Thembisa tab', () => {
    // Regression guard on the default export: the live workbook has this tab.
    expect(resolveSheetLocation('Thembisa', LOCATIONS)).toMatchObject({
      ok: true, locationName: 'Tembisa 1', how: 'alias',
    });
  });

  it('refuses an unknown tab with a reason instead of skipping silently', () => {
    const result = resolveSheetLocation('Kimberley', LOCATIONS);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('no-match');
  });

  it('does not fuzzy-match a short tab name onto a warehouse', () => {
    // "All" is 3 chars; a 2-edit budget would otherwise reach real names.
    const result = resolveSheetLocation('Ivy', LOCATIONS);
    expect(result.ok).toBe(false);
  });

  it('does not fuzzy-match two warehouses that are equally close', () => {
    const near: LocationRef[] = [
      { id: 'a', name: 'Tembisa 1' },
      { id: 'b', name: 'Tembisa 2' },
    ];
    const result = resolveSheetLocation('Tembisa X', near);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('ambiguous');
  });

  it('picks a new project up automatically once it has a warehouse', () => {
    // The whole point of resolving against the DB: no code change needed.
    expect(resolveSheetLocation('Grabouw', LOCATIONS)).toMatchObject({
      ok: true, locationId: 'loc-grabouw',
    });
  });
});
