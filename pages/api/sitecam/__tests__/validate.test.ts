/**
 * Route-handler tests for POST /api/sitecam/validate — proves the VLM input is
 * resized via optimizeForVlm before the VLM call (#1978; full-res images
 * otherwise blow the VLM context and fail open), and that the duplicate-photo
 * fraud check short-circuits before any VLM work.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const h = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  optimizeForVlm: vi.fn(),
  fetchFn: vi.fn(),
}));

vi.mock('@/modules/attendance/portal/authMiddleware', () => ({
  withMySession:
    (fn: (req: NextApiRequest, res: NextApiResponse, s: { staffId: string }) => unknown) =>
    (req: NextApiRequest, res: NextApiResponse) =>
      fn(req, res, { staffId: 'staff-1' }),
}));
vi.mock('@/lib/logger', () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/db', () => ({ default: { query: h.dbQuery } }));
vi.mock('@/lib/vlmGallery', () => ({ loadGalleryExamples: vi.fn(async () => []) }));
vi.mock('@/modules/activate/services/imagePreprocessService', () => ({ optimizeForVlm: h.optimizeForVlm }));
// Use the REAL POWER_METER_STEP + checkPowerMeterRange so the route's range
// enforcement is exercised end-to-end; only the prompt/criteria are stubbed.
vi.mock('@/modules/activate/services/stepQualityCriteria', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/activate/services/stepQualityCriteria')>();
  return {
    STEP_CRITERIA: { 7: { label: 'Power Meter', failReason: 'Power meter reading not clear' } },
    QUALITY_CHECK_STEPS: [7],
    buildMessageContent: () => ({ content: [] }),
    POWER_METER_STEP: actual.POWER_METER_STEP,
    checkPowerMeterRange: actual.checkPowerMeterRange,
  };
});

import handler from '../validate';

const call = handler as unknown as (req: NextApiRequest, res: NextApiResponse) => Promise<void>;
const base = { jobType: 'activations', stepNumber: 7, siteId: 'DR123', photoBase64: 'RAWFULLRES', attemptNumber: 1 };

async function run(body: Record<string, unknown>) {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method: 'POST', body });
  await call(req, res);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  // dup-check SELECT → no rows; recordPhotoHash INSERT → ok
  h.dbQuery.mockResolvedValue({ rows: [] });
  h.optimizeForVlm.mockResolvedValue('resized-small-b64');
  // Default: a legible meter reading inside the -18..-24 range (Step 7 passes).
  h.fetchFn.mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content: '{"passes":true,"dbm":-21,"fail_reason":null}' } }] }),
  });
  vi.stubGlobal('fetch', h.fetchFn);
});

/** Stub the VLM HTTP response with a given JSON body string. */
function mockVlm(content: string) {
  h.fetchFn.mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] }),
  });
}

describe('POST /api/sitecam/validate', () => {
  it('resizes the judged photo via optimizeForVlm (1280×960) before the VLM call', async () => {
    const res = await run({ ...base });

    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData().data.pass).toBe(true);
    expect(h.optimizeForVlm).toHaveBeenCalledTimes(1);
    // The judged photo gets the larger budget so small step-deciding features
    // survive; gallery examples are downscaled separately in vlmGallery.ts.
    expect(h.optimizeForVlm).toHaveBeenCalledWith('RAWFULLRES', { maxWidth: 1280, maxHeight: 960 });
    // The VLM must receive the RESIZED image, never the raw full-res one.
    expect(h.optimizeForVlm.mock.invocationCallOrder[0])
      .toBeLessThan(h.fetchFn.mock.invocationCallOrder[0]);
  });

  it('short-circuits a duplicate photo before any VLM work (fraud check)', async () => {
    h.dbQuery.mockResolvedValueOnce({ rows: [{ id: 'dup-1' }] }); // isDuplicatePhoto → true

    const res = await run({ ...base });

    expect(res._getStatusCode()).toBe(200);
    const data = res._getJSONData().data;
    expect(data.pass).toBe(false);
    expect(data.fraudDetected).toBe('duplicate_hash');
    expect(h.optimizeForVlm).not.toHaveBeenCalled();
    expect(h.fetchFn).not.toHaveBeenCalled();
  });

  it('rejects an invalid siteId format (400)', async () => {
    const res = await run({ ...base, siteId: 'DR 123;DROP' });
    expect(res._getStatusCode()).toBe(400);
    expect(h.optimizeForVlm).not.toHaveBeenCalled();
  });

  describe('Step 7 power-meter dBm range (-18 to -24)', () => {
    it('passes a legible in-range reading and returns the dBm', async () => {
      mockVlm('{"passes":true,"dbm":-21.3,"fail_reason":null}');
      const res = await run({ ...base });
      const data = res._getJSONData().data;
      expect(data.pass).toBe(true);
      expect(data.powerMeterDbm).toBe(-21.3);
    });

    it('passes at the range boundaries (-18 and -24)', async () => {
      mockVlm('{"passes":true,"dbm":-18,"fail_reason":null}');
      expect((await run({ ...base }))._getJSONData().data.pass).toBe(true);
      mockVlm('{"passes":true,"dbm":-24,"fail_reason":null}');
      expect((await run({ ...base }))._getJSONData().data.pass).toBe(true);
    });

    it('fails a too-weak reading (below -24) even when legible', async () => {
      mockVlm('{"passes":true,"dbm":-30,"fail_reason":null}');
      const res = await run({ ...base });
      const data = res._getJSONData().data;
      expect(data.pass).toBe(false);
      expect(data.reasons[0]).toMatch(/Power levels are incorrect/);
      expect(data.reasons[0]).toMatch(/-30 dBm is outside/);
      expect(data.powerMeterDbm).toBe(-30);
    });

    it('fails a too-strong reading (above -18) even when legible', async () => {
      mockVlm('{"passes":true,"dbm":-10,"fail_reason":null}');
      const data = (await run({ ...base }))._getJSONData().data;
      expect(data.pass).toBe(false);
      expect(data.reasons[0]).toMatch(/outside the required -18 to -24/);
    });

    it('fails when the reading cannot be read (dbm null)', async () => {
      mockVlm('{"passes":true,"dbm":null,"fail_reason":null}');
      const data = (await run({ ...base }))._getJSONData().data;
      expect(data.pass).toBe(false);
      expect(data.reasons[0]).toMatch(/Could not read the dBm value/);
    });

    it('keeps the VLM failure when the meter itself is illegible', async () => {
      mockVlm('{"passes":false,"dbm":null,"fail_reason":"Display is too dark to read."}');
      const data = (await run({ ...base }))._getJSONData().data;
      expect(data.pass).toBe(false);
      expect(data.reasons[0]).toBe('Display is too dark to read.');
    });
  });
});
