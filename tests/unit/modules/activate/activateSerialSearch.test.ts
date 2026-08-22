/**
 * The Activate search box has to find a drop by its device serial, not just by
 * DR number or project: field staff read a serial off an ONT or a Gizzu UPS
 * label and have no DR number to hand.
 *
 * Three services apply `filters.search` to the same rows — the paginated list,
 * the summary cards, and the per-project table. If any one of them keeps the
 * drop_number/project-only predicate, a serial search shows a populated list
 * beside zeroed cards (or the reverse). These tests capture the SQL each one
 * emits and assert all three match the serial columns, bound to the same
 * parameter as the drop number.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();

vi.mock('@/lib/db', () => ({
  default: { query: (...args: unknown[]) => queryMock(...args) },
}));

import { getPaginatedDrops } from '@/modules/activate/services/drops/dropQueryService';
import { calculateSummary } from '@/modules/activate/services/drops/dropStatsService';
import { getProjectStats } from '@/modules/activate/services/drops/dropProjectStatsService';

/** A real ONT serial (ALCL prefix); Gizzu UPS serials carry a GU18W prefix. */
const SERIAL = 'ALCLB4947ACB';
const FILTERS = { dateFrom: '2026-08-01', dateTo: '2026-08-22', search: SERIAL };

/** Serial columns on dr_photo_unified_reviews the search must reach. */
const SERIAL_COLUMNS = ['ont_serial_scanned', 'ups_serial_scanned', 'oes_serial'];

interface EmittedQuery {
  sql: string;
  params: unknown[];
}

function emitted(): EmittedQuery[] {
  return queryMock.mock.calls.map((c) => ({ sql: String(c[0]), params: (c[1] ?? []) as unknown[] }));
}

/** Queries that read the unified reviews table directly (not the OES-joined ones). */
function unifiedQueries(): EmittedQuery[] {
  const found = emitted().filter(
    (q) => q.sql.includes('FROM dr_photo_unified_reviews') && !q.sql.includes('FROM oes_activations')
  );
  expect(found.length, 'no unified-table query was emitted').toBeGreaterThan(0);
  return found;
}

/** Queries that count activations off oes_activations. */
function oesQueries(): EmittedQuery[] {
  const found = emitted().filter((q) => q.sql.includes('FROM oes_activations'));
  expect(found.length, 'no oes_activations query was emitted').toBeGreaterThan(0);
  return found;
}

/**
 * The placeholder the drop-number ILIKE is bound to. The serial predicates must
 * reuse it — a serial matched against a different parameter (the date, say)
 * would still "contain ont_serial_scanned" while matching nothing.
 */
function dropNumberSearchPlaceholder(sql: string): string {
  const match = sql.match(/(?:\w+\.)?drop_number ILIKE (\$\d+)/);
  expect(match, `no drop_number ILIKE predicate in:\n${sql}`).not.toBeNull();
  return match?.[1] as string;
}

beforeEach(() => {
  queryMock.mockReset();
  // getPaginatedDrops reads rows[0].count off its COUNT query.
  queryMock.mockResolvedValue({ rows: [{ count: '0' }], rowCount: 0 });
});

describe('Activate serial search', () => {
  it('the paginated list matches every serial column on the search term', async () => {
    await getPaginatedDrops(1, 50, FILTERS);

    for (const { sql, params } of unifiedQueries()) {
      const placeholder = dropNumberSearchPlaceholder(sql);
      for (const col of SERIAL_COLUMNS) {
        expect(sql, `${col} not searched in:\n${sql}`).toContain(`${col} ILIKE ${placeholder}`);
      }
      // The bound value is what actually decides the match.
      const index = Number(placeholder.slice(1)) - 1;
      expect(params[index]).toBe(`%${SERIAL}%`);
    }
  });

  it('the summary cards match the same serial columns as the list', async () => {
    await calculateSummary(FILTERS);

    for (const { sql, params } of unifiedQueries()) {
      const placeholder = dropNumberSearchPlaceholder(sql);
      for (const col of SERIAL_COLUMNS) {
        expect(sql, `${col} not searched in:\n${sql}`).toContain(`${col} ILIKE ${placeholder}`);
      }
      expect(params[Number(placeholder.slice(1)) - 1]).toBe(`%${SERIAL}%`);
    }
  });

  it('the per-project table matches the same serial columns as the list', async () => {
    await getProjectStats(FILTERS);

    for (const { sql, params } of unifiedQueries()) {
      const placeholder = dropNumberSearchPlaceholder(sql);
      for (const col of SERIAL_COLUMNS) {
        expect(sql, `${col} not searched in:\n${sql}`).toContain(`${col} ILIKE ${placeholder}`);
      }
      expect(params[Number(placeholder.slice(1)) - 1]).toBe(`%${SERIAL}%`);
    }
  });

  it('the activated count reaches serials through the OES row and the joined review', async () => {
    await calculateSummary(FILTERS);

    for (const { sql, params } of oesQueries()) {
      const placeholder = dropNumberSearchPlaceholder(sql);
      // OES carries its own serial; the joined review carries the scanned ones.
      expect(sql).toContain(`oes.serial_number ILIKE ${placeholder}`);
      expect(sql).toContain(`upr.ont_serial_scanned ILIKE ${placeholder}`);
      expect(sql).toContain(`upr.ups_serial_scanned ILIKE ${placeholder}`);
      expect(params[Number(placeholder.slice(1)) - 1]).toBe(`%${SERIAL}%`);
    }
  });

  it('leaves the SQL free of serial predicates when no search term is given', async () => {
    await getPaginatedDrops(1, 50, { dateFrom: '2026-08-01', dateTo: '2026-08-22' });

    for (const { sql } of unifiedQueries()) {
      expect(sql).not.toContain('ont_serial_scanned ILIKE');
    }
  });
});
