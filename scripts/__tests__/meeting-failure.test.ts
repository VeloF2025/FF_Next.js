import { describe, expect, it, vi } from 'vitest';

import {
  markMeetingFailed,
  runMeetingStep,
  toErrorMessage,
} from '../lib/meeting-failure';

/** Capture tagged-template calls as a flat SQL string plus its bound params. */
function recordingSql() {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  const sql = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join('?').replace(/\s+/g, ' ').trim(), params: values });
    return Promise.resolve([]);
  });
  return { sql, calls };
}

describe('markMeetingFailed', () => {
  it('writes failed status and binds the message and id as parameters', async () => {
    const { sql, calls } = recordingSql();

    await markMeetingFailed(sql, 251591, new Error('transcription did not run'));

    expect(calls).toHaveLength(1);
    expect(calls[0]!.text).toContain("processing_status = 'failed'");
    expect(calls[0]!.text).toContain('processing_error');
    // id and message must be bound, never interpolated into the SQL text
    expect(calls[0]!.params).toEqual(['transcription did not run', 251591]);
  });

  it('records a non-Error throw rather than persisting "[object Object]"', async () => {
    const { sql, calls } = recordingSql();

    await markMeetingFailed(sql, 7, 'ECONNRESET');

    expect(calls[0]!.params[0]).toBe('ECONNRESET');
  });
});

describe('toErrorMessage', () => {
  it('caps a runaway message so one bad row cannot bloat every read', () => {
    const msg = toErrorMessage(new Error('x'.repeat(5000)));
    expect(msg.length).toBeLessThanOrEqual(2001);
    expect(msg.endsWith('…')).toBe(true);
  });

  it('falls back to a usable string for an empty message', () => {
    expect(toErrorMessage(new Error('   '))).toBe('Unknown error');
  });
});

describe('runMeetingStep', () => {
  it('persists failed when the work throws — the defect this module fixes', async () => {
    const { sql, calls } = recordingSql();

    const result = await runMeetingStep(sql, 42, () => {
      throw new Error('Meeting 42 has a recording but no transcript');
    });

    expect(result).toEqual({
      ok: false,
      error: 'Meeting 42 has a recording but no transcript',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.text).toContain("processing_status = 'failed'");
    expect(calls[0]!.params[1]).toBe(42);
  });

  it('writes nothing when the work succeeds', async () => {
    const { sql, calls } = recordingSql();

    const result = await runMeetingStep(sql, 42, async () => 'summary');

    expect(result).toEqual({ ok: true, value: 'summary' });
    expect(calls).toHaveLength(0);
  });

  it('surfaces the original error even when persisting the failure also fails', async () => {
    const sql = vi.fn(() => Promise.reject(new Error('db is down')));
    const onPersistError = vi.fn();

    const result = await runMeetingStep(
      sql,
      42,
      () => {
        throw new Error('whisper timed out');
      },
      onPersistError,
    );

    // The operator needs the transcription error, not the bookkeeping error.
    expect(result).toEqual({ ok: false, error: 'whisper timed out' });
    expect(onPersistError).toHaveBeenCalledTimes(1);
  });

  it('does not swallow a rejected promise returned by the work', async () => {
    const { sql, calls } = recordingSql();

    const result = await runMeetingStep(sql, 9, () =>
      Promise.reject(new Error('async boom')),
    );

    expect(result).toEqual({ ok: false, error: 'async boom' });
    expect(calls).toHaveLength(1);
  });
});
