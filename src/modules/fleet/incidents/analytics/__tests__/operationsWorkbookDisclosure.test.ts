/**
 * What may not reach a cell.
 *
 * Separate from the rendering suite because these are the assertions that stop
 * being true silently: a workbook that starts carrying an identifier, a
 * coordinate or an evaluable string still opens, still looks right, and is on
 * someone's disk before anyone reads it closely.
 */
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { PROJECT, everyCellText, open, report } from './workbookFixtures';

describe('what may not reach a cell', () => {
  /**
   * Proven by handing the builder a report whose strings begin with the four
   * characters a spreadsheet reads as a formula. The filter parser cannot
   * produce one today; the guard is here because the day it can is not the day
   * to find out.
   */
  it('neutralises a value a spreadsheet would evaluate as a formula', async () => {
    const dangerous = ['=1+1', '+cmd', '-2', '@SUM(A1)'];
    const workbook = await open(report({ suppressionNotices: dangerous }));
    const sheet = workbook.getWorksheet('Metadata');
    const written: string[] = [];
    sheet?.eachRow((row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        expect(cell.type).not.toBe(ExcelJS.ValueType.Formula);
        if (typeof cell.value === 'string') written.push(cell.value);
      });
    });
    for (const value of dangerous) {
      expect(written).toContain(`'${value}`);
      expect(written).not.toContain(value);
    }
  });

  it('writes no identity, coordinate, link or prose the response never carried', async () => {
    const workbook = await open(report({
      suppressionNotices: ['No figures were published for the incident group in 2026-01-01.'],
    }));
    const text = everyCellText(workbook).join('\n');
    for (const forbidden of [
      'contributorKey', 'staffId', 'vehicleId', 'incidentId',
      'latitude', 'longitude', 'http://', 'https://', '@',
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });

  /**
   * The filters a caller supplied are echoed back, and two of them are staff
   * and vehicle ids. That is the caller's own input and it has to be stated for
   * the file to say what it covers — but it is also the only UUID the workbook
   * may contain, so the claim is made precisely rather than by a blanket ban
   * this row would break.
   */
  it('contains no UUID beyond the ones the caller filtered by', async () => {
    const workbook = await open(report({
      filters: { start: '2026-01-01', end: '2026-03-31', projectId: PROJECT },
    }));
    const uuids = everyCellText(workbook)
      .join('\n')
      .match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? [];
    expect([...new Set(uuids)]).toEqual([PROJECT]);
  });
});
