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

vi.mock('fs', () => {
  const mod = { existsSync: vi.fn(() => true), statSync: vi.fn(() => ({ size: 1234 })) };
  return { ...mod, default: mod };
});

import { scrapeOneDriveRecordings } from './onedrive-recordings';

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
});
