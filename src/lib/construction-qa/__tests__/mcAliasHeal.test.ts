/**
 * Tests for the mc `local` alias self-heal — focused on the dedupe + cooldown
 * concurrency controls (the stream integration tests cover the trigger path).
 *
 * `execFile` is mocked so the alias-set exec can be driven exactly. A fresh
 * module instance per test resets the module-level `healInFlight`/`lastHealAt`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const execFileMock = vi.fn();

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  const execFile = (...args: unknown[]) => execFileMock(...args);
  return { ...actual, default: { ...actual, execFile }, execFile };
});

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

type ExecCb = (err: unknown, result?: { stdout: string; stderr: string }) => void;

describe('healMinioAlias', () => {
  let healMinioAlias: typeof import('../mcAliasHeal').healMinioAlias;
  let MC_AUTH_ERROR_RE: RegExp;

  beforeEach(async () => {
    execFileMock.mockReset();
    vi.resetModules();
    const mod = await import('../mcAliasHeal');
    healMinioAlias = mod.healMinioAlias;
    MC_AUTH_ERROR_RE = mod.MC_AUTH_ERROR_RE;
  });

  it('re-applies the alias with a fixed argv command carrying no secret', async () => {
    execFileMock.mockImplementation((_c: string, _a: string[], _o: unknown, cb: ExecCb) => cb(null, { stdout: '', stderr: '' }));
    await healMinioAlias();

    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [cmd, args] = execFileMock.mock.calls[0]!;
    expect(cmd).toBe('docker');
    const joined = (args as string[]).join(' ');
    expect(joined).toContain('mc alias set local');
    // Credentials are shell-expanded inside the container, never in argv.
    expect(joined).toContain('$MINIO_ROOT_USER');
    expect(joined).toContain('$MINIO_ROOT_PASSWORD');
  });

  it('dedupes concurrent heals into a single alias-set exec', async () => {
    let release: ExecCb = () => {};
    execFileMock.mockImplementation((_c: string, _a: string[], _o: unknown, cb: ExecCb) => {
      // Hold the exec open so the first heal stays in-flight.
      release = cb;
    });

    const p1 = healMinioAlias();
    const p2 = healMinioAlias(); // in-flight → must return the same promise, no 2nd exec

    expect(execFileMock).toHaveBeenCalledTimes(1);
    expect(p2).toBe(p1);

    release(null, { stdout: '', stderr: '' });
    await Promise.all([p1, p2]);
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });

  it('skips re-healing within the cooldown window', async () => {
    execFileMock.mockImplementation((_c: string, _a: string[], _o: unknown, cb: ExecCb) => cb(null, { stdout: '', stderr: '' }));

    await healMinioAlias(); // completes, stamps lastHealAt
    await healMinioAlias(); // within cooldown → no-op

    expect(execFileMock).toHaveBeenCalledTimes(1);
  });

  it('never rejects even when the alias-set exec fails', async () => {
    execFileMock.mockImplementation((_c: string, _a: string[], _o: unknown, cb: ExecCb) => cb(new Error('docker daemon down')));
    await expect(healMinioAlias()).resolves.toBeUndefined();
  });

  it('matches the real broken-alias stderr and excludes genuine misses', () => {
    expect(MC_AUTH_ERROR_RE.test('Unable to read from `x`. Requested path `/x` not found.')).toBe(true);
    expect(MC_AUTH_ERROR_RE.test('Unable to read from `x`. Object does not exist.')).toBe(false);
    expect(MC_AUTH_ERROR_RE.test('Unable to read from `x`. Bucket `b` does not exist.')).toBe(false);
  });
});
