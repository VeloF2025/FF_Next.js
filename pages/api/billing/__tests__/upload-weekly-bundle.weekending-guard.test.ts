/**
 * Guard: a parsed summary with no week-ending date must never reach the DB.
 *
 * `ft_weekly_billing.week_ending` is a `date` column. Before this guard, a PDF
 * that parsed but yielded no "PAYMENT SUMMARY AS AT:" header (WE260726 shipped
 * a print-to-PDF of the notes workbook for Tembisa POP03) was sent through as
 * `week_ending = ''`, which Postgres rejected with the opaque
 * `invalid input syntax for type date: ""`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiResponse } from 'next';

const { mockQuery, mockProcessProjectGroup } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockProcessProjectGroup: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  withAuth: (h: unknown) => h,
  withRole: () => (h: unknown) => h,
}));
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/db', () => ({
  default: { query: mockQuery, connect: vi.fn() },
  pool: { query: mockQuery, connect: vi.fn() },
}));
vi.mock('formidable', () => ({
  IncomingForm: class {
    parse(_req: unknown, cb: (e: unknown, f: unknown, files: unknown) => void) {
      cb(null, { action: ['import'] }, {
        files: [{ originalFilename: 'Tembisa POP03 WE260726 notes.pdf', filepath: '/tmp/x.pdf', mimetype: 'application/pdf', size: 1 }],
      });
    }
  },
}));
vi.mock('fs', () => ({
  default: { readFileSync: () => Buffer.from(''), unlinkSync: () => undefined },
  readFileSync: () => Buffer.from(''),
  unlinkSync: () => undefined,
}));
vi.mock('@/modules/billing/services/bundleProcessor', () => ({
  classifyFile: (f: unknown) => f,
  groupFilesByProject: () => [{ projectHint: 'Tembisa POP03', files: [] }],
  processProjectGroup: mockProcessProjectGroup,
}));
vi.mock('@/modules/billing/services/resolveProjectName', () => ({
  fetchBillableProjects: async () => [{ id: 'p-1', name: 'Tembisa POP 3' }],
}));

import handler from '../upload-weekly-bundle';

function makeRes() {
  const res: Partial<NextApiResponse> & { jsonData?: { projects?: { status: string; statusReason: string }[] } } = {};
  res.status = vi.fn(() => res as NextApiResponse);
  res.json = vi.fn((data: unknown) => {
    res.jsonData = data as { projects?: { status: string; statusReason: string }[] };
    return res as NextApiResponse;
  });
  return res as NextApiResponse & { jsonData?: { projects?: { status: string; statusReason: string }[] } };
}

/** A resolved project whose summary parsed to an EMPTY week-ending date. */
function undatedResult() {
  return {
    projectHint: 'Tembisa POP03',
    resolution: {
      matched: true,
      project: { id: 'p-1', name: 'Tembisa POP 3' },
      candidates: [],
      rawInput: 'Tembisa POP03',
    },
    files: [{ originalName: 'Tembisa POP03 WE260726 notes.pdf', kind: 'ft-payment-pdf' }],
    summary: {
      project: 'Tembisa POP03',
      weekEnding: '',
      totalOnts: 0, previouslyInvoiced: 0, claimable: 0,
      note1Count: 0, note2Count: 0, note3Count: 0, note4Count: 0, note5Count: 0,
      preProvisionsCount: 0, preProvOutstanding: 0, totalClaimableForPayment: 0,
      site: null, contractor: null, areaManager: null,
      lowerThanLinkBudgetCount: 0, parseWarnings: [],
    },
    deductions: [],
    zoneUptake: null,
    zonePonUptake: null,
    reconcile: null,
    parseWarnings: ['Could not find "PAYMENT SUMMARY AS AT:" date — weekEnding left empty'],
    fatalError: null,
  };
}

describe('POST /api/billing/upload-weekly-bundle — empty weekEnding guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProcessProjectGroup.mockResolvedValue(undatedResult());
  });

  it('skips the project and issues NO query when weekEnding is empty', async () => {
    const res = makeRes();
    await (handler as unknown as (r: unknown, s: NextApiResponse) => Promise<void>)(
      { method: 'POST', user: { email: 'test@velocityfibre.co.za' } },
      res,
    );

    // The mock must actually have replaced the real module — otherwise this
    // test silently passes against real parsing.
    expect(mockProcessProjectGroup).toHaveBeenCalledTimes(1);

    const project = res.jsonData?.projects?.[0];
    expect(project?.status).toBe('skipped');
    expect(project?.statusReason).toContain('No week-ending date found');
    expect(project?.statusReason).toContain('Tembisa POP03 WE260726 notes.pdf');
    // Both causes must be named — an empty weekEnding also happens when a
    // GENUINE payment PDF's "PAYMENT SUMMARY AS AT:" header fails to parse,
    // so the message must not assert it's the wrong file.
    expect(project?.statusReason).toContain('PAYMENT SUMMARY AS AT');

    // The whole point: nothing reached Postgres, so `week_ending = ''` can't
    // raise `invalid input syntax for type date: ""`.
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('proceeds past the guard when weekEnding is present', async () => {
    mockProcessProjectGroup.mockResolvedValue({
      ...undatedResult(),
      summary: { ...undatedResult().summary, weekEnding: '2026-07-26' },
    });
    mockQuery.mockResolvedValue({ rows: [{ id: 'week-1', price_per_drop: '250.00' }] });

    const res = makeRes();
    await (handler as unknown as (r: unknown, s: NextApiResponse) => Promise<void>)(
      { method: 'POST', user: { email: 'test@velocityfibre.co.za' } },
      res,
    );

    expect(mockQuery).toHaveBeenCalled();
    expect(res.jsonData?.projects?.[0]?.status).not.toBe('skipped');
  });
});
