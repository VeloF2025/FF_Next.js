/**
 * The export is the same answer as the screen, in a file. These tests are about
 * the ways a spreadsheet can quietly say something the API did not: a blank
 * where a figure was withheld, a zero where a duration is no longer held, an
 * empty sheet where the filters matched nothing.
 *
 * What may NOT reach a cell is proved separately, in
 * `operationsWorkbookDisclosure.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { NOT_RETAINED } from '../operationsWorkbook';
import { PROJECT, open, report, rowStartingWith, rowsOf, value } from './workbookFixtures';

function metadataWarningRow(workbook: Awaited<ReturnType<typeof open>>): string[] | undefined {
  return rowsOf(workbook, 'Metadata').find((row) => row[0] === 'Warning');
}

describe('buildOperationsWorkbook', () => {
  it('always carries Summary and Metadata', async () => {
    const workbook = await open(report());
    expect(workbook.worksheets.map((sheet) => sheet.name)).toContain('Summary');
    expect(workbook.worksheets.map((sheet) => sheet.name)).toContain('Metadata');
  });

  it('omits Monthly Trends when there is no series rather than shipping an empty sheet', async () => {
    const workbook = await open(report({ series: [] }));
    expect(workbook.getWorksheet('Monthly Trends')).toBeUndefined();
  });

  it('writes one Summary row per card', async () => {
    const workbook = await open(report({
      cards: [
        value({ metricKey: 'incident.late', numerator: 12 }),
        value({ metricKey: 'presence.confirmed_days', numerator: 90, denominator: 100 }),
      ],
    }));
    const rows = rowsOf(workbook, 'Summary');
    expect(rows.filter((row) => row[0] === 'incident.late')).toHaveLength(1);
    expect(rows.filter((row) => row[0] === 'presence.confirmed_days')).toHaveLength(1);
  });

  it('writes a percentage as a real number under a percent format, not a pre-rounded string', async () => {
    const workbook = await open(report({
      cards: [value({ metricKey: 'presence.confirmed_days', numerator: 90, denominator: 100 })],
    }));
    const sheet = workbook.getWorksheet('Summary');
    const row = sheet?.getRow(2);
    expect(row?.getCell(4).value).toBe(0.9);
    expect(row?.getCell(4).numFmt).toContain('%');
  });

  /**
   * A withheld figure and a figure of zero are different answers, and a
   * spreadsheet renders both as an empty-looking cell unless one of them is
   * spelled out.
   */
  it('leaves the percentage empty when there is no denominator to divide by', async () => {
    const workbook = await open(report({
      cards: [value({ metricKey: 'incident.late', numerator: 12, denominator: null })],
    }));
    const row = workbook.getWorksheet('Summary')?.getRow(2);
    expect(row?.getCell(4).value).toBeNull();
  });

  it('leaves the percentage empty rather than dividing by a zero denominator', async () => {
    const workbook = await open(report({
      cards: [value({ metricKey: 'presence.confirmed_days', numerator: 0, denominator: 0 })],
    }));
    const row = workbook.getWorksheet('Summary')?.getRow(2);
    expect(row?.getCell(4).value).toBeNull();
  });

  /**
   * A timing metric's numerator is always zero by construction — the calculator
   * never bumps a count for `timing.*`, it observes a duration. Printing that
   * zero in the Count column would read as "no acknowledgements happened".
   */
  it('never prints a timing metric count, which is structurally zero', async () => {
    const workbook = await open(report({
      cards: [value({
        metricKey: 'timing.acknowledgement',
        histogram: { sampleCount: 4, sumSeconds: 2400, buckets: [1, 2, 1, 0, 0, 0] },
      })],
    }));
    const row = workbook.getWorksheet('Summary')?.getRow(2);
    expect(row?.getCell(2).value).toBeNull();
    expect(row?.getCell(5).value).toBe(4);
    expect(row?.getCell(6).value).toBe(600);
  });

  it('names the bucket the median falls in rather than inventing a precise one', async () => {
    const workbook = await open(report({
      cards: [value({
        metricKey: 'timing.resolution',
        histogram: { sampleCount: 10, sumSeconds: 9000, buckets: [1, 1, 6, 2, 0, 0] },
      })],
    }));
    expect(rowStartingWith(workbook, 'Summary', 'timing.resolution')[6]).toBe('15–30 min');
  });

  /**
   * A purged month keeps its counts and loses its durations — migration 527's
   * view publishes no histogram column. Zero samples would claim no duration
   * was ever recorded.
   */
  it('says a duration is no longer held instead of reporting it as zero', async () => {
    const workbook = await open(report({
      cards: [value({ metricKey: 'timing.acknowledgement', histogram: null })],
    }));
    const row = rowStartingWith(workbook, 'Summary', 'timing.acknowledgement');
    expect(row.slice(4, 7)).toEqual([NOT_RETAINED, NOT_RETAINED, NOT_RETAINED]);
  });

  it('states how many months of the range each figure covers', async () => {
    const workbook = await open(report({
      cards: [value({ metricKey: 'incident.late', numerator: 12, coverage: { months: 2, of: 3 } })],
    }));
    expect(rowStartingWith(workbook, 'Summary', 'incident.late')[7]).toBe('2 of 3');
  });

  it('explains an empty result instead of handing back a sheet of headings', async () => {
    const workbook = await open(report({ cards: [], series: [] }));
    const text = rowsOf(workbook, 'Summary').flat().join(' ');
    expect(text).toMatch(/no figures|nothing matched|matched nothing/i);
  });

  describe('Monthly Trends', () => {
    it('names the source of each month against the retention boundary', async () => {
      const workbook = await open(report({
        retainedDetailFrom: '2026-02-01',
        series: [
          { monthStart: '2026-01-01', values: [value({ metricKey: 'incident.late', numerator: 5 })] },
          { monthStart: '2026-02-01', values: [value({ metricKey: 'incident.late', numerator: 7 })] },
        ],
      }));
      const rows = rowsOf(workbook, 'Monthly Trends');
      const january = rows.find((row) => row[0] === '2026-01-01');
      const february = rows.find((row) => row[0] === '2026-02-01');
      expect(january?.at(-1)).toBe('Published aggregate');
      expect(february?.at(-1)).toBe('Retained detail');
    });

    it('keeps a month that reported nothing, so a gap is visible as a gap', async () => {
      const workbook = await open(report({
        series: [
          { monthStart: '2026-01-01', values: [] },
          { monthStart: '2026-02-01', values: [value({ metricKey: 'incident.late', numerator: 7 })] },
        ],
      }));
      const rows = rowsOf(workbook, 'Monthly Trends');
      const january = rows.find((row) => row[0] === '2026-01-01');
      expect(january).toBeDefined();
      expect(january?.join(' ')).toMatch(/no figures/i);
    });
  });

  describe('Metadata', () => {
    it('records when it was generated, the scope, the metric version and the threshold', async () => {
      const workbook = await open(report());
      const text = rowsOf(workbook, 'Metadata').map((row) => row.join(' | ')).join('\n');
      expect(text).toContain('2026-08-25T09:30:00.000Z');
      expect(text).toContain('Projects you manage');
      expect(text).toMatch(/Metric version \| 1|Metric version\s*\|\s*1/);
      expect(text).toContain('5');
    });

    it('names every filter it accepts, including the ones left unset', async () => {
      const workbook = await open(report({
        filters: { start: '2026-01-01', end: '2026-03-31', projectId: PROJECT },
      }));
      const rows = rowsOf(workbook, 'Metadata');
      expect(rowStartingWith(workbook, 'Metadata', 'op_project')[1]).toBe(PROJECT);
      // An absent filter is stated, not omitted: a reader cannot tell a filter
      // that was not applied from one the export forgot to mention.
      expect(rowStartingWith(workbook, 'Metadata', 'op_driver')[1]).toMatch(/no filter/i);
      expect(rows.filter((row) => row[0]?.startsWith('op_'))).toHaveLength(11);
    });

    it('states the retention boundary and what it means', async () => {
      const workbook = await open(report({ retainedDetailFrom: '2026-02-01' }));
      const text = rowsOf(workbook, 'Metadata').map((row) => row.join(' ')).join('\n');
      expect(text).toContain('2026-02-01');
      expect(text).toMatch(/retention boundary/i);
    });

    it('carries every suppression notice the response gave', async () => {
      const notices = ['No figures were published for the incident group in 2026-01-01.', 'Second notice.'];
      const workbook = await open(report({ suppressionNotices: notices }));
      const text = rowsOf(workbook, 'Metadata').flat().join('\n');
      for (const notice of notices) expect(text).toContain(notice);
    });

    it('warns when the aggregates behind the historic half are stale or failed', async () => {
      const workbook = await open(report({
        freshness: { aggregatesThrough: null, lastRunStatus: 'failed' },
      }));
      const warningRow = rowStartingWith(workbook, 'Metadata', 'Warning');
      expect(warningRow.join(' ')).toMatch(/fail|incomplete|out of date/i);
    });

    it('still warns when the run succeeded but left no recorded aggregation boundary', async () => {
      const workbook = await open(report({
        freshness: { aggregatesThrough: null, lastRunStatus: 'succeeded' },
      }));
      const warningRow = rowStartingWith(workbook, 'Metadata', 'Warning');
      expect(warningRow.join(' ')).toMatch(/fail|incomplete|out of date/i);
    });

    it('carries no Warning row once the run succeeded and a boundary was recorded', async () => {
      const workbook = await open(report({
        freshness: { aggregatesThrough: '2026-07-01', lastRunStatus: 'succeeded' },
      }));
      expect(metadataWarningRow(workbook)).toBeUndefined();
    });
  });
});
