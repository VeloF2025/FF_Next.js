/**
 * Observability regression guard, added after the 2026-07-10 outage: production
 * logs were kept only in an in-memory buffer and written nowhere, so a 3-day
 * auto-QA outage produced no visible logs. warn/error MUST reach process.stderr
 * (captured by systemd/journald); info/debug reach stdout only under LOG_STDOUT.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
});
