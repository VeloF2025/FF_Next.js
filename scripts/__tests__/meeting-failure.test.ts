import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  markMeetingFailed,
  runMeetingStep,
  safeRemove,
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

describe('safeRemove', () => {
  const made: string[] = [];
  const locked: string[] = [];
  const tmp = (name: string) => {
    const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mf-')), name);
    made.push(path.dirname(p));
    return p;
  };
  afterEach(() => {
    // Restore write permission first — otherwise removing the temp root fails
    // with the very EACCES these tests deliberately provoke.
    locked.splice(0).forEach(d => fs.chmodSync(d, 0o700));
    made.splice(0).forEach(d => fs.rmSync(d, { recursive: true, force: true }));
  });

  it('removes both a file and a populated directory', () => {
    const file = tmp('audio.mp3');
    fs.writeFileSync(file, 'x');
    const dir = tmp('chunks');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'chunk_000.mp3'), 'x');

    safeRemove([file, dir]);

    expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('does not throw when a path is already gone (the concurrent-run race)', () => {
    const gone = tmp('never-created.mp3');
    const onError = vi.fn();

    expect(() => safeRemove([gone], onError)).not.toThrow();
    expect(onError).not.toHaveBeenCalled();
  });

  /** A file inside a non-writable directory cannot be unlinked — a real EACCES
   *  from the kernel, no mocking of `fs` involved. */
  function undeletableFile(): string {
    const dir = tmp('locked');
    fs.mkdirSync(dir);
    const file = path.join(dir, 'audio.mp3');
    fs.writeFileSync(file, 'x');
    fs.chmodSync(dir, 0o500);
    locked.push(dir);
    return file;
  }

  it('swallows a filesystem error so a `finally` cannot replace the real error', () => {
    const blocked = undeletableFile();
    const onError = vi.fn();

    expect(() => safeRemove([blocked], onError)).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(blocked)).toBe(true);
  });

  it('still removes later paths after an earlier one fails', () => {
    const blocked = undeletableFile();
    const second = tmp('second.mp3');
    fs.writeFileSync(second, 'x');
    const onError = vi.fn();

    safeRemove([blocked, second], onError);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(second)).toBe(false);
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
