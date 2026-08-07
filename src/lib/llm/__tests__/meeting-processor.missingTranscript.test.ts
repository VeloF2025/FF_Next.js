/**
 * A recording with no transcript is a FAILURE, not an empty meeting.
 *
 * Regression guard for the silent-skip bug: processWithLLM used to write a
 * "No transcript available for analysis." summary whenever raw_transcript was
 * empty. Because writeSummary() sets processing_status='completed'
 * unconditionally, such meetings looked successfully processed with nothing to
 * say. 405 recordings on disk — 39GB, including two Executive Sessions and a
 * 2h24m project meeting — were hidden that way, with no processing_error to
 * show anything had gone wrong.
 *
 * The distinction that matters:
 *   recording_path set   → transcription failed  → throw, so callers mark failed
 *   recording_path null  → nothing was recorded  → placeholder summary is honest
 *
 * Throwing (rather than marking failed in-place) is deliberate: graph/meeting-processor
 * and graph/onedrive-recordings both force processing_status='completed' on the
 * line after processWithLLM returns, so an in-place status write would be clobbered.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbState = {
  meetingRow: null as Record<string, unknown> | null,
  updates: [] as string[],
};

vi.mock('@/lib/db-neon', () => ({
  neon: () =>
    ((strings: TemplateStringsArray) => {
      const q = (strings as unknown as string[]).join(' ? ');
      if (/SELECT id, title, meeting_date/i.test(q)) {
        // Project only what the query actually asks for. Returning the whole row
        // regardless would mean dropping recording_path from the production
        // SELECT still passed these tests — the guard depends on that column
        // being fetched, so the mock has to be able to withhold it.
        if (!dbState.meetingRow) return Promise.resolve([]);
        const projected: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(dbState.meetingRow)) {
          if (new RegExp(`\\b${k}\\b`).test(q)) projected[k] = v;
        }
        return Promise.resolve([projected]);
      }
      if (/FROM meeting_transcripts/i.test(q)) {
        return Promise.resolve([]); // no fallback transcript
      }
      if (/UPDATE meetings/i.test(q)) {
        dbState.updates.push(q);
        return Promise.resolve([{ id: 42 }]);
      }
      return Promise.resolve([]);
    }),
}));

// Fail loudly if the LLM is reached — neither branch under test should call it.
vi.mock('@/lib/llm/client', () => ({
  getOpenAIClient: vi.fn(() => {
    throw new Error('LLM must not be called when there is no transcript');
  }),
}));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { processWithLLM, TranscriptMissingError } from '@/lib/llm/meeting-processor';

function meeting(over: Record<string, unknown> = {}) {
  return {
    id: 42,
    title: 'Executive Session Weekly',
    meeting_date: '2026-08-04T10:00:00Z',
    participants: [],
    raw_transcript: null,
    organizer_name: 'Someone',
    recording_path: null,
    ...over,
  };
}

describe('processWithLLM — recording present but no transcript', () => {
  beforeEach(() => {
    dbState.meetingRow = null;
    dbState.updates = [];
    vi.clearAllMocks();
  });

  it('throws instead of writing a placeholder summary when a recording exists', async () => {
    dbState.meetingRow = meeting({
      recording_path: '/home/velo/meeting-recordings/2026/08/249269.mp4',
    });

    await expect(processWithLLM(42)).rejects.toThrow(TranscriptMissingError);
  });

  it('does not mark the meeting completed when a recording exists', async () => {
    dbState.meetingRow = meeting({
      recording_path: '/home/velo/meeting-recordings/2026/08/249269.mp4',
    });

    await expect(processWithLLM(42)).rejects.toThrow();

    // The whole bug was the row silently reaching processing_status='completed'.
    expect(dbState.updates).toHaveLength(0);
  });

  it('names the recording in the error so processing_error is actionable', async () => {
    dbState.meetingRow = meeting({
      recording_path: '/home/velo/meeting-recordings/2026/08/249269.mp4',
    });

    await expect(processWithLLM(42)).rejects.toThrow(/249269\.mp4/);
  });

  it('still writes the placeholder summary when nothing was ever recorded', async () => {
    dbState.meetingRow = meeting({ recording_path: null });

    const result = await processWithLLM(42);

    expect(result.overview).toBe('No transcript available for analysis.');
    expect(dbState.updates).toHaveLength(1);
    expect(dbState.updates[0]).toMatch(/UPDATE meetings/i);
  });
});
