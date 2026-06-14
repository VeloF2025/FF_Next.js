/**
 * meeting-helpers.test.ts
 * Unit tests for occurrence-aware transcript/recording selection.
 *
 * Regression guard for the recurring-meeting contamination bug:
 * a recurring onlineMeeting's /transcripts and /recordings endpoints return
 * artifacts for EVERY occurrence (the onlineMeetingId is the shared thread id,
 * not the occurrence id). Selecting `[0]` attached ONE occurrence's transcript
 * and recording to every sibling occurrence (the 75-way / 125-row duplication).
 * Selection must instead match the artifact whose createdDateTime is closest to
 * the occurrence start, and fail closed (attach nothing) when none match.
 */

// ---------------------------------------------------------------------------
// Mocks — defined before imports. vi.hoisted ensures the mock fns exist before
// vi.mock factories run (which vitest hoists above the import statements).
// ---------------------------------------------------------------------------
const {
  mockSql,
  mockListTranscripts,
  mockDownloadTranscriptContent,
  mockListRecordings,
  mockDownloadRecordingToDisk,
} = vi.hoisted(() => ({
  mockSql: vi.fn(),
  mockListTranscripts: vi.fn(),
  mockDownloadTranscriptContent: vi.fn(),
  mockListRecordings: vi.fn(),
  mockDownloadRecordingToDisk: vi.fn(),
}));

vi.mock('@/lib/db-neon', () => ({ neon: vi.fn(() => mockSql) }));
vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('./transcripts', () => ({
  listTranscripts: mockListTranscripts,
  downloadTranscriptContent: mockDownloadTranscriptContent,
  parseVttSpeakers: vi.fn(() => []),
  fetchOnlineMeetingInfo: vi.fn(),
}));
vi.mock('./recordings', () => ({
  listRecordings: mockListRecordings,
  downloadRecordingToDisk: mockDownloadRecordingToDisk,
}));
vi.mock('./onedrive-recordings', () => ({
  listUserRecordings: vi.fn(),
  downloadDriveItem: vi.fn(),
  parseRecordingFilename: vi.fn(),
}));

import {
  selectArtifactForOccurrence,
  fetchAndStoreTranscript,
  fetchAndStoreRecording,
} from './meeting-helpers';

const ORG = 'organizer-user-id';
const THREAD = 'recurring-thread-onlinemeeting-id';

beforeEach(() => {
  mockSql.mockReset().mockResolvedValue([]);
  mockListTranscripts.mockReset();
  mockDownloadTranscriptContent.mockReset().mockResolvedValue('WEBVTT\n\nhello');
  mockListRecordings.mockReset();
  mockDownloadRecordingToDisk.mockReset().mockResolvedValue({
    filePath: '/tmp/rec.mp4',
    sizeBytes: 123,
  });
});

// ---------------------------------------------------------------------------
// selectArtifactForOccurrence — pure selector
// ---------------------------------------------------------------------------
describe('selectArtifactForOccurrence', () => {
  test('picks the artifact whose createdDateTime is closest to the occurrence start', () => {
    const artifacts = [
      { id: 'far-earlier', createdDateTime: '2026-06-02T10:00:00Z' },
      { id: 'closest', createdDateTime: '2026-06-09T10:05:00Z' },
      { id: 'also-close', createdDateTime: '2026-06-09T10:40:00Z' },
    ];
    const picked = selectArtifactForOccurrence(artifacts, '2026-06-09T10:00:00Z');
    expect(picked?.id).toBe('closest');
  });

  test('matches an artifact created slightly before the occurrence start (negative delta)', () => {
    const artifacts = [
      { id: 'just-before', createdDateTime: '2026-06-09T09:58:00Z' },
      { id: 'later', createdDateTime: '2026-06-09T10:30:00Z' },
    ];
    expect(selectArtifactForOccurrence(artifacts, '2026-06-09T10:00:00Z')?.id).toBe('just-before');
  });

  test('returns null when no artifact falls within the match window (fail closed)', () => {
    const artifacts = [
      { id: 'a', createdDateTime: '2026-06-02T10:00:00Z' },
      { id: 'b', createdDateTime: '2026-06-16T10:00:00Z' },
    ];
    // Occurrence 7 days from either artifact — both well outside the 2h window.
    expect(selectArtifactForOccurrence(artifacts, '2026-06-09T10:00:00Z')).toBeNull();
  });

  test('returns the single artifact for a non-recurring meeting within the window', () => {
    const artifacts = [{ id: 'solo', createdDateTime: '2026-06-09T10:03:00Z' }];
    expect(selectArtifactForOccurrence(artifacts, '2026-06-09T10:00:00Z')?.id).toBe('solo');
  });

  test('returns null for an invalid occurrence start', () => {
    const artifacts = [{ id: 'a', createdDateTime: '2026-06-09T10:00:00Z' }];
    expect(selectArtifactForOccurrence(artifacts, 'not-a-date')).toBeNull();
  });

  test('ignores artifacts with an unparseable createdDateTime', () => {
    const artifacts = [
      { id: 'bad', createdDateTime: 'garbage' },
      { id: 'good', createdDateTime: '2026-06-09T10:01:00Z' },
    ];
    expect(selectArtifactForOccurrence(artifacts, '2026-06-09T10:00:00Z')?.id).toBe('good');
  });

  test('returns null for an empty artifact list', () => {
    expect(selectArtifactForOccurrence([], '2026-06-09T10:00:00Z')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// fetchAndStoreTranscript — occurrence-aware
// ---------------------------------------------------------------------------
describe('fetchAndStoreTranscript', () => {
  test('downloads the occurrence transcript and persists ITS content, not transcripts[0]', async () => {
    // The sibling occurrence's transcript is FIRST in the Graph list (the [0] trap).
    mockListTranscripts.mockResolvedValue([
      { id: 'sibling-tx', createdDateTime: '2026-06-02T10:00:00Z' },
      { id: 'this-occurrence-tx', createdDateTime: '2026-06-09T10:02:00Z' },
    ]);
    // Key the content by transcript id so the DB-write assertion proves the
    // SELECTED occurrence's content reaches the meetings row — not the sibling's.
    mockDownloadTranscriptContent.mockImplementation((_org, _mtg, txId) =>
      Promise.resolve(`VTT-FOR-${txId}`)
    );

    await fetchAndStoreTranscript(42, ORG, THREAD, '2026-06-09T10:00:00Z');

    expect(mockDownloadTranscriptContent).toHaveBeenCalledTimes(1);
    expect(mockDownloadTranscriptContent).toHaveBeenCalledWith(ORG, THREAD, 'this-occurrence-tx');
    // The inline-store path is `UPDATE meetings SET raw_transcript = ${vtt} ... WHERE id = ${meetingId}`,
    // so the matched occurrence's content + meetingId are the interpolated values.
    expect(mockSql).toHaveBeenCalledWith(expect.anything(), 'VTT-FOR-this-occurrence-tx', 42);
  });

  test('does not download or write when no transcript matches the occurrence window', async () => {
    mockListTranscripts.mockResolvedValue([
      { id: 'sibling-tx', createdDateTime: '2026-06-02T10:00:00Z' },
    ]);

    await fetchAndStoreTranscript(42, ORG, THREAD, '2026-06-09T10:00:00Z');

    expect(mockDownloadTranscriptContent).not.toHaveBeenCalled();
    expect(mockSql).not.toHaveBeenCalled();
  });

  test('no-ops when the meeting has no transcripts at all', async () => {
    mockListTranscripts.mockResolvedValue([]);
    await fetchAndStoreTranscript(42, ORG, THREAD, '2026-06-09T10:00:00Z');
    expect(mockDownloadTranscriptContent).not.toHaveBeenCalled();
    expect(mockSql).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// fetchAndStoreRecording — occurrence-aware
// ---------------------------------------------------------------------------
describe('fetchAndStoreRecording', () => {
  test('downloads the recording matching the occurrence, not recordings[0]', async () => {
    mockListRecordings.mockResolvedValue([
      { id: 'sibling-rec', createdDateTime: '2026-06-02T10:00:00Z' },
      { id: 'this-occurrence-rec', createdDateTime: '2026-06-09T10:01:00Z' },
    ]);

    const stored = await fetchAndStoreRecording(42, ORG, THREAD, '2026-06-09T10:00:00Z');

    expect(stored).toBe(true);
    expect(mockDownloadRecordingToDisk).toHaveBeenCalledTimes(1);
    expect(mockDownloadRecordingToDisk).toHaveBeenCalledWith(ORG, THREAD, 'this-occurrence-rec', 42);
  });

  test('returns false and downloads nothing when no recording matches the occurrence window', async () => {
    mockListRecordings.mockResolvedValue([
      { id: 'sibling-rec', createdDateTime: '2026-06-02T10:00:00Z' },
    ]);

    const stored = await fetchAndStoreRecording(42, ORG, THREAD, '2026-06-09T10:00:00Z');

    expect(stored).toBe(false);
    expect(mockDownloadRecordingToDisk).not.toHaveBeenCalled();
    expect(mockSql).not.toHaveBeenCalled();
  });

  test('returns false when the meeting has no recordings at all', async () => {
    mockListRecordings.mockResolvedValue([]);
    const stored = await fetchAndStoreRecording(42, ORG, THREAD, '2026-06-09T10:00:00Z');
    expect(stored).toBe(false);
    expect(mockDownloadRecordingToDisk).not.toHaveBeenCalled();
  });
});
