/**
 * parseOntGizzuWorkbook — tab resolution against real warehouse rows.
 *
 * Built from the live workbook's actual tab names (2026-08-20): a misspelled
 * project tab ("Tembelilhle") had never imported because the old hardcoded
 * sheet→UUID map did not list it, costing 504 ONT + 504 Gizzu serials.
 */
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseOntGizzuWorkbook, FT_ONT_ITEM_ID, FT_GIZZU_ITEM_ID } from '../ontSerialWorkbook';
import type { LocationRef } from '../sheetLocation';

/** Live project rows (2026-08-21) for the allocation half. */
const PROJECTS: LocationRef[] = [
  { id: 'p-lawley', name: 'Lawley' },
  { id: 'p-mamelodi', name: 'Mamelodi' },
  { id: 'p-thembisa1', name: 'Thembisa POP 1' },
  { id: 'p-thembisa2', name: 'Thembisa POP 2' },
  { id: 'p-thembisa3', name: 'Thembisa POP 3' },
];

const LOCATIONS: LocationRef[] = [
  { id: 'loc-lawley', name: 'Lawley' },
  { id: 'loc-mamelodi', name: 'Mamelodi Pop1' },
  { id: 'loc-tembelihle', name: 'Tembelihle' },
  { id: 'loc-tembisa1', name: 'Tembisa 1' },
  { id: 'loc-tembisa2', name: 'Tembisa 2' },
  { id: 'loc-tembisa3', name: 'Tembisa 3' },
];

/** Build a workbook of {tabName: [[ont, gizzu], ...]} with a header row. */
function makeWorkbook(sheets: Record<string, Array<[string, string]>>) {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const aoa = [['Project', 'ONT Serial', 'Gizzu Serial'], ...rows.map(([o, g]) => ['x', o, g])];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  return wb;
}

describe('parseOntGizzuWorkbook', () => {
  it('imports the misspelled Tembelilhle tab that the old map dropped', () => {
    const wb = makeWorkbook({
      Tembelilhle: [['ALCLB4948758', 'GU18W12V2599990001']],
    });

    const parsed = parseOntGizzuWorkbook(wb, XLSX, LOCATIONS);

    // allocatedToProjectId is null here: no project list was supplied, so the
    // tab's allocation is unknown rather than assumed.
    expect(parsed.ontItems).toEqual([
      {
        stockItemId: FT_ONT_ITEM_ID, serialNumber: 'ALCLB4948758',
        locationId: 'loc-tembelihle', allocatedToProjectId: null,
      },
    ]);
    expect(parsed.gizzuItems).toEqual([
      {
        stockItemId: FT_GIZZU_ITEM_ID, serialNumber: 'GU18W12V2599990001',
        locationId: 'loc-tembelihle', allocatedToProjectId: null,
      },
    ]);
    expect(parsed.unresolvedSheets).toEqual([]);
    expect(parsed.projects[0]).toMatchObject({ locationName: 'Tembelihle', matchedBy: 'fuzzy' });
  });

  it('resolves a warehouse whose name carries a suffix', () => {
    const wb = makeWorkbook({ Mamelodi: [['ALCLB4948758', '']] });
    const parsed = parseOntGizzuWorkbook(wb, XLSX, LOCATIONS);
    expect(parsed.ontItems[0]!.locationId).toBe('loc-mamelodi');
    expect(parsed.projects[0]!.matchedBy).toBe('prefix');
  });

  it('sends the Thembisa tab to Tembisa 1 via the alias, not a guess', () => {
    const wb = makeWorkbook({ Thembisa: [['ALCLB4948758', '']] });
    const parsed = parseOntGizzuWorkbook(wb, XLSX, LOCATIONS);
    expect(parsed.ontItems[0]!.locationId).toBe('loc-tembisa1');
    expect(parsed.projects[0]!.matchedBy).toBe('alias');
  });

  it('reports an unresolvable tab WITH the rows it cost, not just its name', () => {
    const wb = makeWorkbook({
      Kimberley: [['ALCLB4948758', 'GU18W12V2599990001'], ['ALCLB4948779', '']],
      Lawley: [['ALCLB49486FF', '']],
    });

    const parsed = parseOntGizzuWorkbook(wb, XLSX, LOCATIONS);

    expect(parsed.unresolvedSheets).toEqual([
      { sheetName: 'Kimberley', reason: 'no-match', rowsLost: 2 },
    ]);
    // The resolvable tab still imports — one bad tab does not stop the run.
    expect(parsed.ontItems).toHaveLength(1);
    expect(parsed.ontItems[0]!.locationId).toBe('loc-lawley');
  });

  it('marks the summary tabs as not-a-project, distinct from a real failure', () => {
    const wb = makeWorkbook({ All: [['ALCLB4948758', '']], 'info sheet': [['', '']] });
    const parsed = parseOntGizzuWorkbook(wb, XLSX, LOCATIONS);
    expect(parsed.ontItems).toHaveLength(0);
    expect(parsed.unresolvedSheets.map((u) => u.reason)).toEqual(['not-a-project', 'not-a-project']);
  });

  it('allocates each serial to the project its tab names', () => {
    const wb = makeWorkbook({ Lawley: [['ALCLB49486FF', 'GU18W12V2599990001']] });
    const parsed = parseOntGizzuWorkbook(wb, XLSX, LOCATIONS, PROJECTS);

    expect(parsed.ontItems[0]!.allocatedToProjectId).toBe('p-lawley');
    expect(parsed.gizzuItems[0]!.allocatedToProjectId).toBe('p-lawley');
    // The warehouse is still recorded — it is where we ASSUME the stock sits.
    expect(parsed.ontItems[0]!.locationId).toBe('loc-lawley');
    expect(parsed.projects[0]).toMatchObject({ allocatedProjectName: 'Lawley' });
    expect(parsed.unallocatedSheets).toEqual([]);
  });

  it('imports the stock but leaves allocation UNSET when the project is ambiguous', () => {
    // Thembisa matches three POPs. Guessing would allocate stock to the wrong
    // project; the stock itself still imports.
    const wb = makeWorkbook({ Thembisa: [['ALCLB49486FF', 'GU18W12V2599990001']] });
    const parsed = parseOntGizzuWorkbook(wb, XLSX, LOCATIONS, PROJECTS);

    expect(parsed.ontItems).toHaveLength(1);
    expect(parsed.ontItems[0]!.allocatedToProjectId).toBeNull();
    expect(parsed.unallocatedSheets).toEqual([
      {
        sheetName: 'Thembisa',
        reason: 'ambiguous',
        candidates: ['Thembisa POP 1', 'Thembisa POP 2', 'Thembisa POP 3'],
        serialsUnallocated: 2,
      },
    ]);
  });

  it('imports the stock but leaves allocation UNSET when no such project exists', () => {
    const wb = makeWorkbook({ Tembelilhle: [['ALCLB49486FF', '']] });
    const parsed = parseOntGizzuWorkbook(wb, XLSX, LOCATIONS, PROJECTS);

    expect(parsed.ontItems[0]!.locationId).toBe('loc-tembelihle');
    expect(parsed.ontItems[0]!.allocatedToProjectId).toBeNull();
    expect(parsed.unallocatedSheets[0]).toMatchObject({ sheetName: 'Tembelilhle', reason: 'no-match' });
  });

  it('keeps skippedSheets populated for existing callers', () => {
    const wb = makeWorkbook({ Kimberley: [['ALCLB4948758', '']] });
    const parsed = parseOntGizzuWorkbook(wb, XLSX, LOCATIONS);
    expect(parsed.skippedSheets).toEqual(['Kimberley']);
  });
});
