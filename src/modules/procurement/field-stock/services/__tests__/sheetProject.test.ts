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

/**
 * The live project rows, verbatim (2026-08-21) — the FULL list, not a subset.
 *
 * A trimmed fixture is how a resolver test lies: an earlier version of this
 * file omitted `Themb'elihle` and therefore "proved" that the `Tembelilhle`
 * tab is refused, when against the real table it resolves. Keep this in step
 * with `SELECT project_name FROM projects`.
 */
const PROJECTS: NamedRef[] = [
  { id: 'p-barberton', name: 'Barberton' },
  { id: 'p-botshabelo', name: 'Botshabelo' },
  { id: 'p-cal', name: 'Chief Albert Luthuli' },
  { id: 'p-chloorkop', name: 'Chloorkop' },
  { id: 'p-cradock', name: 'Cradock' },
  { id: 'p-etwatwa', name: 'Etwatwa' },
  { id: 'p-general', name: 'General / Equipment' },
  { id: 'p-grabouw', name: 'Grabouw' },
  { id: 'p-kingsway', name: 'Kingsway' },
  { id: 'p-lawley', name: 'Lawley' },
  { id: 'p-mahikeng', name: 'Mahikeng' },
  { id: 'p-malmesbury', name: 'Malmesbury' },
  { id: 'p-mamelodi', name: 'Mamelodi' },
  { id: 'p-middelburg', name: 'Middelburg ' },
  { id: 'p-mohadin', name: 'Mohadin' },
  { id: 'p-mohadin2', name: 'Mohadin Ph 2' },
  { id: 'p-benfarm', name: 'Phalaborwa - Ben Farm' },
  { id: 'p-namakgale', name: 'Phalaborwa - Namakgale' },
  { id: 'p-proteasouth', name: 'Protea South' },
  { id: 'p-thembelihle', name: "Themb'elihle" },
  { id: 'p-thembisa1', name: 'Thembisa POP 1' },
  { id: 'p-thembisa2', name: 'Thembisa POP 2' },
  { id: 'p-thembisa3', name: 'Thembisa POP 3' },
  { id: 'p-tonga', name: 'Tonga' },
  { id: 'p-tzaneen', name: 'Tzaneen' },
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

  it("resolves the misspelled Tembelilhle tab to Themb'elihle", () => {
    // The tab is a misspelling of the same township: the project sits in
    // Lenasia, Gauteng, and is the only candidate among all 25 projects.
    // Edit distance 2 after normalisation ("tembelilhle" vs "thembelihle"),
    // next nearest is 8 — a unique winner, not a coin flip.
    //
    // NOTE: this tab's stock is observed INSTALLING on Thembisa POP 1 and
    // Etwatwa. That is the allocation-vs-reality divergence this whole change
    // exists to record — it does not make the allocation wrong.
    expect(resolveSheetTarget('Tembelilhle', PROJECTS, PROJECT_ALIASES)).toMatchObject({
      ok: true, locationName: "Themb'elihle", how: 'fuzzy',
    });
  });

  it('REFUSES a tab that matches no project at all', () => {
    const r = resolveSheetTarget('Kimberley', PROJECTS, PROJECT_ALIASES);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe('no-match');
  });

  it('does not fuzzy-match a tab onto a merely similar-length project name', () => {
    // Against the FULL project list, guard that the 2-edit budget cannot reach
    // an unrelated name — the risk a trimmed fixture would hide.
    for (const tab of ['Tzaneen', 'Cradock', 'Kingsway', 'Grabouw']) {
      const r = resolveSheetTarget(tab, PROJECTS, PROJECT_ALIASES);
      // Each of these IS a real project, so it must match ITSELF and nothing else.
      expect(r).toMatchObject({ ok: true, locationName: tab });
    }
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
