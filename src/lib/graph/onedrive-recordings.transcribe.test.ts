/**
 * The OneDrive scraper must transcribe before it summarises.
 *
 * This path downloads a recording and sets recording_path, but never fetched a
 * transcript by any means — no Teams VTT, no Whisper. Every meeting it created
 * could therefore only ever summarise to "No transcript available for
 * analysis.", and once onedrive_item_id was stamped the item was skipped by all
 * future scrapes ("already scraped"), so nothing ever revisited it.
 *
 * Guards that ordering: transcribe first, summarise second, and only when the
 * meeting has no transcript yet.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Read at module scope by onedrive-recordings, so it must be set before import.
vi.hoisted(() => {
  process.env.WHISPER_TEAMS_RECORDINGS = 'true';
});

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const graphFetch = vi.fn();
vi.mock('./auth', () => ({ graphFetch: (...a: unknown[]) => graphFetch(...a) }));

const getInternalUsers = vi.fn();
vi.mock('./auto-recording', () => ({ getInternalUsers: () => getInternalUsers() }));

const calls: string[] = [];
vi.mock('@/lib/llm/meeting-processor', () => ({
  processWithLLM: vi.fn(async () => { calls.push('summarise'); }),
}));
vi.mock('./meeting-processor', () => ({
  transcribeStoredRecordingWithWhisper: vi.fn(async () => { calls.push('transcribe'); }),
}));
import { transcribeStoredRecordingWithWhisper } from './meeting-processor';

vi.mock('fs', () => {
  const mod = { existsSync: vi.fn(() => true), statSync: vi.fn(() => ({ size: 1234 })) };
  return { ...mod, default: mod };
});

import { scrapeOneDriveRecordings, resolveTranscribeBudgetMs } from './onedrive-recordings';

/** Drives listUserRecordings: root children, then the Recordings folder's children. */
function primeGraph(itemIso: string) {
  graphFetch.mockReset();
  graphFetch
    .mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ value: [{ id: 'folder-1', name: 'Recordings', folder: {} }] }),
    })
    .mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({
        value: [{ id: 'item-1', name: 'Exec Session.mp4', createdDateTime: itemIso, size: 5_000_000 }],
      }),
    });
}

/** Fake neon tagged-template that routes on query text. */
function makeSql(transcriptLen: number) {
  return (strings: TemplateStringsArray) => {
    const q = (strings as unknown as string[]).join(' ? ');
    if (/SELECT id FROM meetings WHERE onedrive_item_id/i.test(q)) return Promise.resolve([]);
    if (/FROM meetings\s+WHERE source = 'teams'/i.test(q)) return Promise.resolve([]); // no match → create
    if (/INSERT INTO meetings/i.test(q)) return Promise.resolve([{ id: 42 }]);
    if (/SELECT processing_status FROM meetings/i.test(q)) {
      return Promise.resolve([{ processing_status: 'fetching' }]);
    }
    if (/length\(raw_transcript\)/i.test(q)) return Promise.resolve([{ len: transcriptLen }]);
    return Promise.resolve([]);
  };
}

describe('scrapeOneDriveRecordings — transcribes before summarising', () => {
  beforeEach(() => {
    calls.length = 0;
    vi.clearAllMocks();
    getInternalUsers.mockResolvedValue([
      { id: 'u1', mail: 'lew@velocityfibre.co.za', displayName: 'Lew' },
    ]);
    primeGraph(new Date().toISOString());
  });

  it('transcribes first, then summarises, when the meeting has no transcript', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await scrapeOneDriveRecordings(makeSql(0) as any);

    expect(calls).toEqual(['transcribe', 'summarise']);
  });

  it('skips transcription when a transcript is already present', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await scrapeOneDriveRecordings(makeSql(12_425) as any);

    expect(calls).toEqual(['summarise']);
  });

  it('gives up on an item whose transcription outruns the budget, and marks it failed', async () => {
    // The documented Mac Mini failure is "accepts the connection, never answers",
    // so the call neither resolves nor rejects — exactly what the budget is for.
    vi.mocked(transcribeStoredRecordingWithWhisper).mockImplementation(
      () => new Promise(() => { /* never settles */ }),
    );
    process.env.ONEDRIVE_TRANSCRIBE_BUDGET_MS = '50';
    vi.resetModules();
    const { scrapeOneDriveRecordings: scrape } = await import('./onedrive-recordings');

    const statuses: string[] = [];
    const sql = (strings: TemplateStringsArray) => {
      const q = (strings as unknown as string[]).join(' ? ');
      if (/SELECT id FROM meetings WHERE onedrive_item_id/i.test(q)) return Promise.resolve([]);
      if (/FROM meetings\s+WHERE source = 'teams'/i.test(q)) return Promise.resolve([]);
      if (/INSERT INTO meetings/i.test(q)) return Promise.resolve([{ id: 42 }]);
      if (/SELECT processing_status FROM meetings/i.test(q)) {
        return Promise.resolve([{ processing_status: 'fetching' }]);
      }
      if (/length\(raw_transcript\)/i.test(q)) return Promise.resolve([{ len: 0 }]);
      if (/processing_status = 'failed'/i.test(q)) { statuses.push('failed'); return Promise.resolve([]); }
      return Promise.resolve([]);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await scrape(sql as any);

    expect(calls).not.toContain('summarise');   // never reached past the stuck call
    expect(statuses).toContain('failed');        // item recorded as failed, not silently dropped
    expect(result.failed).toBeGreaterThan(0);    // and the run returned rather than hanging

    delete process.env.ONEDRIVE_TRANSCRIBE_BUDGET_MS;
  });
});

describe('resolveTranscribeBudgetMs', () => {
  it('defaults to 45 minutes when unset or invalid', () => {
    expect(resolveTranscribeBudgetMs(undefined)).toBe(2_700_000);
    expect(resolveTranscribeBudgetMs('')).toBe(2_700_000);
    expect(resolveTranscribeBudgetMs('nonsense')).toBe(2_700_000);
    expect(resolveTranscribeBudgetMs('0')).toBe(2_700_000);
    expect(resolveTranscribeBudgetMs('-5')).toBe(2_700_000);
  });

  it('honours a valid override', () => {
    expect(resolveTranscribeBudgetMs('120000')).toBe(120_000);
  });

  it('leaves headroom for the longest recordings actually seen', () => {
    // Measured worst case: 8.3x realtime. The backlog's longest recording is
    // 2h24m. A default that cannot absorb that would mark a real meeting failed
    // — the inverse of the stall this budget exists to prevent.
    const longestAudioSec = 2 * 3600 + 24 * 60;
    const slowestRate = 8.3;
    const needMs = (longestAudioSec / slowestRate) * 1000;

    expect(resolveTranscribeBudgetMs(undefined)).toBeGreaterThan(needMs * 2);
  });
});
