import { describe, it, expect, vi, beforeEach } from 'vitest';

// Spy-able logger so we can assert the 0-import WARN fires. vi.hoisted lets the
// hoisted vi.mock factory reference these spies without a TDZ error.
const { info, warn, error } = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock('@/lib/logger', () => {
  const l = { info, warn, error, debug: vi.fn() };
  return { createLogger: () => l, log: l };
});

// The tests inject `syncOne`, so the real per-site sync chain (DB + Excel parser
// + import/post-import services) is never exercised. Mock those heavy modules so
// importing the service under test doesn't pull their transitive deps into vitest.
vi.mock('@/lib/db', () => ({ pool: { query: vi.fn() } }));
vi.mock('@/modules/activate/services/oes/oesExcelParser', () => ({ parseOESExcel: vi.fn() }));
vi.mock('@/modules/activate/services/oes/oesImportService', () => ({
  createImportBatch: vi.fn(),
  upsertActivations: vi.fn(),
  importPPData: vi.fn(),
}));
vi.mock('@/modules/activate/services/oes/oesUnifiedRecordsService', () => ({
  loadExistingUnifiedSet: vi.fn(),
  processUnifiedRecords: vi.fn(),
}));
vi.mock('@/modules/activate/services/oes/oesPostImportService', () => ({
  triggerQFieldSync: vi.fn(),
  triggerSharePointSync: vi.fn(),
  triggerOltAutoDetect: vi.fn(() => Promise.resolve()),
  triggerSerialVerificationRecompute: vi.fn(),
  triggerVlmLearning: vi.fn(),
  triggerPpActivationCheck: vi.fn(),
  triggerOntSwapConfirmation: vi.fn(),
}));

import { runOesSync, ACTIVE_SITES, type Site, type SiteResult } from '../fibertime-oes-sync';
import { FibertimeAuthExpiredError } from '@/lib/sharepoint/fibertime-sp-client';

const DATE = '20260714';

/**
 * A syncOne stub that returns a scripted status per site per call.
 * `script[site]` is a status sequence indexed by call count (last entry repeats);
 * sites without a script use `fallback`.
 */
function scriptedSyncOne(
  script: Partial<Record<Site, SiteResult['status'][]>>,
  fallback: SiteResult['status'] = 'imported'
) {
  const calls: Record<string, number> = {};
  const fn = vi.fn(async (site: Site): Promise<SiteResult> => {
    const n = calls[site] ?? 0;
    calls[site] = n + 1;
    const seq = script[site];
    const status = (seq ? (seq[n] ?? seq[seq.length - 1]) : fallback) as SiteResult['status'];
    return { site, status };
  });
  return { fn, calls: () => calls };
}

beforeEach(() => {
  warn.mockClear();
  info.mockClear();
  error.mockClear();
});

describe('runOesSync — retry self-heal', () => {
  it('imports on pass 1 with no retry when every site is available', async () => {
    const s = scriptedSyncOne({}, 'imported');
    const report = await runOesSync(DATE, { syncOne: s.fn, retryDelayMs: 0 });

    expect(report.summary.imported).toBe(ACTIVE_SITES.length);
    expect(report.summary.retryPasses).toBe(0);
    expect(s.fn).toHaveBeenCalledTimes(ACTIVE_SITES.length); // exactly one pass
    expect(warn).not.toHaveBeenCalled();
  });

  it('self-heals a late upload: not_available on pass 1 → imported on retry', async () => {
    const s = scriptedSyncOne({ LAW: ['not_available', 'imported'] }, 'imported');
    const report = await runOesSync(DATE, { syncOne: s.fn, retryDelayMs: 0, maxRetryPasses: 2 });

    expect(report.sites.find(r => r.site === 'LAW')?.status).toBe('imported');
    expect(report.summary.imported).toBe(ACTIVE_SITES.length);
    expect(report.summary.notAvailable).toBe(0);
    expect(report.summary.retryPasses).toBe(1);
    // retry re-checks ONLY the pending site, not the whole set
    expect(s.calls()['LAW']).toBe(2);
    expect(s.calls()['MAM']).toBe(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('gives up after maxRetryPasses and reports the site not_available', async () => {
    const s = scriptedSyncOne({ LAW: ['not_available'] }, 'imported'); // LAW never arrives
    const report = await runOesSync(DATE, { syncOne: s.fn, retryDelayMs: 0, maxRetryPasses: 2 });

    expect(report.sites.find(r => r.site === 'LAW')?.status).toBe('not_available');
    expect(report.summary.retryPasses).toBe(2);
    expect(s.calls()['LAW']).toBe(3); // 1 initial + 2 retries
    expect(warn).not.toHaveBeenCalled(); // other sites imported → not a 0-import night
  });

  it('stops retrying without sleeping past the wall-clock budget', async () => {
    const s = scriptedSyncOne({ LAW: ['not_available'] }, 'imported'); // LAW never arrives
    // Huge per-pass delay + tiny budget → the deadline guard must skip the retry
    // (and its sleep) entirely rather than blow the cron's curl -m 300 timeout.
    const report = await runOesSync(DATE, {
      syncOne: s.fn,
      retryDelayMs: 100_000,
      maxTotalMs: 1,
      maxRetryPasses: 2,
    });

    expect(report.summary.retryPasses).toBe(0); // no retry pass ran
    expect(s.calls()['LAW']).toBe(1); // checked once on pass 1, never re-checked
    expect(report.sites.find(r => r.site === 'LAW')?.status).toBe('not_available');
  });
});

describe('runOesSync — 0-import detection', () => {
  it('WARNs when a run imports 0 sites (all not_available across every pass)', async () => {
    const s = scriptedSyncOne({}, 'not_available');
    const report = await runOesSync(DATE, { syncOne: s.fn, retryDelayMs: 0, maxRetryPasses: 1 });

    expect(report.summary.imported).toBe(0);
    expect(report.summary.notAvailable).toBe(ACTIVE_SITES.length);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/imported 0 sites/i);
  });

  it('does NOT warn when the day was already imported earlier (all skipped)', async () => {
    const s = scriptedSyncOne({}, 'skipped');
    const report = await runOesSync(DATE, { syncOne: s.fn, retryDelayMs: 0 });

    expect(report.summary.imported).toBe(0);
    expect(report.summary.skipped).toBe(ACTIVE_SITES.length);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('runOesSync — auth-expiry abort rule', () => {
  it('throws when the session is fully expired (every folder 401s)', async () => {
    const fn = vi.fn(async (): Promise<SiteResult> => {
      throw new FibertimeAuthExpiredError();
    });
    await expect(runOesSync(DATE, { syncOne: fn, retryDelayMs: 0 })).rejects.toBeInstanceOf(
      FibertimeAuthExpiredError
    );
  });

  it('does NOT abort on a single-folder 403 while others succeed (permission gap)', async () => {
    const fn = vi.fn(async (site: Site): Promise<SiteResult> => {
      if (site === 'ETW-1') throw new FibertimeAuthExpiredError();
      return { site, status: 'imported' };
    });
    const report = await runOesSync(DATE, { syncOne: fn, retryDelayMs: 0 });

    expect(report.sites.find(r => r.site === 'ETW-1')?.status).toBe('error');
    expect(report.summary.imported).toBe(ACTIVE_SITES.length - 1);
  });

  it('keeps pass-1 results when the session expires during a retry pass', async () => {
    let lawCalls = 0;
    const fn = vi.fn(async (site: Site): Promise<SiteResult> => {
      if (site === 'LAW') {
        lawCalls += 1;
        if (lawCalls === 1) return { site, status: 'not_available' };
        throw new FibertimeAuthExpiredError(); // session dies before LAW's file lands
      }
      return { site, status: 'imported' };
    });
    // Must NOT throw: the 6 pass-1 imports survive; LAW keeps its pass-1 status.
    const report = await runOesSync(DATE, { syncOne: fn, retryDelayMs: 0, maxRetryPasses: 2 });

    expect(report.summary.imported).toBe(ACTIVE_SITES.length - 1);
    expect(report.sites.find(r => r.site === 'LAW')?.status).toBe('not_available');
  });
});
