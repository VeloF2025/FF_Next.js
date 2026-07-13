// @vitest-environment node
//
// The project-default jsdom environment defines `window`, so Logger would take
// its browser branch and never touch process.stderr/stdout. This suite asserts
// the Node (server) emission path, which only runs when `window` is undefined.
/**
 * Observability regression guard, added after the 2026-07-10 outage: production
 * logs were kept only in an in-memory buffer and written nowhere, so a 3-day
 * auto-QA outage produced no visible logs. warn/error MUST reach process.stderr
 * (captured by systemd/journald); info/debug reach stdout only under LOG_STDOUT.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vitest.setup.ts registers a GLOBAL vi.mock('@/lib/logger') whose factory omits
// the Logger class (it exports only log/apiLogger/createLogger). Since '../logger'
// resolves to that same module, the global mock would make `new Logger()` throw
// ("No 'Logger' export"). Restore the real module for this suite so it genuinely
// exercises the stderr/stdout emission it is meant to guard.
vi.mock('../logger', async () => await vi.importActual<typeof import('../logger')>('../logger'));

import { Logger } from '../logger';

describe('Logger emits to process streams for journald visibility', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  const origLogStdout = process.env.LOG_STDOUT;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  });
  afterEach(() => {
    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
    if (origLogStdout === undefined) delete process.env.LOG_STDOUT;
    else process.env.LOG_STDOUT = origLogStdout;
  });

  it('writes warn to stderr with message, component and data', () => {
    new Logger({ level: 'debug' }).warn('quality check could not complete', { reason: 'timeout' }, 'AutoQA');
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const line = String(stderrSpy.mock.calls[0]![0]);
    expect(line).toContain('quality check could not complete');
    expect(line).toContain('[AutoQA]');
    expect(line).toContain('"reason":"timeout"');
  });

  it('writes error to stderr', () => {
    new Logger({ level: 'debug' }).error('boom');
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('does NOT write info to stdout by default (avoids flooding)', () => {
    delete process.env.LOG_STDOUT;
    new Logger({ level: 'debug' }).info('hello');
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('writes info to stdout when LOG_STDOUT=true', () => {
    process.env.LOG_STDOUT = 'true';
    new Logger({ level: 'debug' }).info('hello');
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
  });

  it('never throws on unserializable (circular) data', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => new Logger({ level: 'debug' }).warn('circ', circular)).not.toThrow();
    expect(String(stderrSpy.mock.calls[0]![0])).toContain('[unserializable data]');
  });

  it('collapses embedded newlines so a caller string cannot forge extra log lines', () => {
    // CWE-117: a user-controlled value (e.g. a logged email) containing a newline
    // must not become a second journald line impersonating another log entry.
    new Logger({ level: 'debug' }).warn('real\nFAKE [ERROR] forged privileged action', undefined, 'AutoQA');
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const line = String(stderrSpy.mock.calls[0]![0]);
    expect(line.endsWith('\n')).toBe(true);
    // Exactly one trailing newline; none embedded in the payload.
    expect(line.slice(0, -1)).not.toContain('\n');
    expect(line).toContain('real FAKE [ERROR] forged privileged action');
  });
});
