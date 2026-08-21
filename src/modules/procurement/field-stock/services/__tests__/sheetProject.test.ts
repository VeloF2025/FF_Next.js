/**
 * resolveSheetTarget against PROJECTS — the allocation half.
 *
 * The workbook tab says which project stock is EARMARKED for. That is not the
 * same as where it physically sits: measured 2026-08-21, only 27.5% of
 * sheet-imported ONTs were installed on the project whose warehouse the tab
 * assigned them to.
 *
 * Two tabs cannot be resolved and must be refused rather than guessed.
 */
import { describe, it, expect } from 'vitest';
import { resolveSheetTarget, PROJECT_ALIASES } from '../sheetLocation';
import type { NamedRef } from '../sheetLocation';

/** The live project rows, verbatim (2026-08-21). */
const PROJECTS: NamedRef[] = [
  { id: 'p-etwatwa', name: 'Etwatwa' },
  { id: 'p-lawley', name: 'Lawley' },
  { id: 'p-mamelodi', name: 'Mamelodi' },
  { id: 'p-mohadin', name: 'Mohadin' },
  { id: 'p-mohadin2', name: 'Mohadin Ph 2' },
  { id: 'p-thembisa1', name: 'Thembisa POP 1' },
  { id: 'p-thembisa2', name: 'Thembisa POP 2' },
  { id: 'p-thembisa3', name: 'Thembisa POP 3' },
];

describe('resolveSheetTarget — tab to project', () => {
  it.each([
    ['Lawley', 'p-lawley'],
    ['Mamelodi', 'p-mamelodi'],
    ['Etwatwa', 'p-etwatwa'],
  ])('resolves %s exactly', (tab, id) => {
    expect(resolveSheetTarget(tab, PROJECTS, PROJECT_ALIASES)).toMatchObject({ ok: true, locationId: id });
  });

  it('resolves Mohadin to the phase-1 project, not Mohadin Ph 2', () => {
    // Both start with "mohadin" — an exact match must win over the prefix rule,
    // or a live project would silently take stock meant for the original.
    expect(resolveSheetTarget('Mohadin', PROJECTS, PROJECT_ALIASES)).toMatchObject({
      ok: true, locationId: 'p-mohadin', locationName: 'Mohadin', how: 'exact',
    });
  });

  it('REFUSES Thembisa — three POPs, no way to tell which', () => {
    const r = resolveSheetTarget('Thembisa', PROJECTS, PROJECT_ALIASES);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe('ambiguous');
    expect(r.ok === false && r.candidates).toEqual(['Thembisa POP 1', 'Thembisa POP 2', 'Thembisa POP 3']);
  });

  it('REFUSES Tembelilhle — no such project exists', () => {
    // Its stock is observed installing on Thembisa POP 1 and Etwatwa, so there
    // is no single right answer to invent.
    const r = resolveSheetTarget('Tembelilhle', PROJECTS, PROJECT_ALIASES);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe('no-match');
  });

  it('ships with NO project aliases, so nothing is guessed by default', () => {
    expect(Object.keys(PROJECT_ALIASES)).toHaveLength(0);
  });

  it('honours an alias once a human decides what a tab means', () => {
    expect(resolveSheetTarget('Thembisa', PROJECTS, { thembisa: 'Thembisa POP 1' })).toMatchObject({
      ok: true, locationId: 'p-thembisa1', how: 'alias',
    });
  });

  it('still refuses the summary tabs', () => {
    expect(resolveSheetTarget('All', PROJECTS, PROJECT_ALIASES)).toMatchObject({
      ok: false, reason: 'not-a-project',
    });
  });
});
