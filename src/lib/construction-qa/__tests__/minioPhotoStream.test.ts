/**
 * Tests for the MinIO photo stream state machine.
 *
 * `spawn` is mocked so stdout/stderr chunks and exit codes can be driven
 * exactly; the assertions are on real behaviour of the module under test
 * (bytes written, outcome returned, whether the child was killed).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter, PassThrough, Writable } from 'stream';

const spawnMock = vi.fn();
const execFileMock = vi.fn();

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  const spawn = (...args: unknown[]) => spawnMock(...args);
  const execFile = (...args: unknown[]) => execFileMock(...args);
  return { ...actual, default: { ...actual, spawn, execFile }, spawn, execFile };
});

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { streamMinioObject, PHOTO_CONTENT_TYPES } from '../minioPhotoStream';

// Exact `mc cat` stderr strings, captured from the real mc binary inside
// qfieldcloud-minio-1 (see MC_AUTH_ERROR_RE comment in the module under test).
const MC_AUTH_STDERR = 'mc: <ERROR> Unable to read from `local/qfieldcloud-prod/x.jpg`. Requested path `/local/qfieldcloud-prod/x.jpg` not found.';
const MC_ABSENT_STDERR = 'mc: <ERROR> Unable to read from `local/qfieldcloud-prod/x.jpg`. Object does not exist.';

/** A fake child process whose stdout/stderr the test drives directly. */
function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough; stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>; killed: boolean;
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = vi.fn(() => { child.killed = true; return true; });
  return child;
}

/** Minimal stand-in for NextApiResponse that records what was written. */
function fakeRes() {
  const chunks: Buffer[] = [];
  const res = new Writable({
    write(chunk, _enc, cb) { chunks.push(Buffer.from(chunk)); cb(); },
  }) as Writable & {
    headers: Record<string, unknown>;
    setHeader: (k: string, v: unknown) => void;
    body: () => Buffer;
  };
  res.headers = {};
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.body = () => Buffer.concat(chunks);
  return res;
}

const flush = () => new Promise((r) => setImmediate(r));

describe('streamMinioObject', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    execFileMock.mockReset();
  });

  it('streams object bytes through to the response and reports "served"', async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const res = fakeRes();

    const promise = streamMinioObject('projects/a/photo.jpg', res);
    child.stdout.write(Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    child.stdout.write(Buffer.from('tail-bytes'));
    child.stdout.end();

    expect(await promise).toBe('served');
    await flush();

    expect(res.body().subarray(0, 4)).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    expect(res.body().subarray(4).toString()).toBe('tail-bytes');
    expect(res.headers['Content-Type']).toBe('image/jpeg');
    // Size is unknown ahead of streaming, so the response must be chunked.
    expect(res.headers['Content-Length']).toBeUndefined();
  });

  it('does not invoke a shell — docker is spawned with an argv array', async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const res = fakeRes();

    const promise = streamMinioObject("weird';name.jpg", res);
    child.stdout.write(Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    child.stdout.end();
    await promise;

    const [cmd, args, opts] = spawnMock.mock.calls[0]!;
    expect(cmd).toBe('docker');
    expect(Array.isArray(args)).toBe(true);
    expect(args).toContain("local/qfieldcloud-prod/weird';name.jpg");
    expect((opts as { shell?: boolean }).shell).toBeUndefined();
  });

  it('treats an `mc:` diagnostic on stdout as not-found and kills the child', async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const res = fakeRes();

    const promise = streamMinioObject('projects/a/missing.jpg', res);
    child.stdout.write(Buffer.from('mc: <ERROR> object does not exist'));
    child.stdout.end();

    expect(await promise).toBe('not-found');
    expect(res.body().length).toBe(0);
    expect(child.kill).toHaveBeenCalled();
  });

  it('reports not-found for an object shorter than the probe threshold', async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const res = fakeRes();

    const promise = streamMinioObject('projects/a/stub.jpg', res);
    child.stdout.write(Buffer.from([0x00, 0x01])); // 2 bytes — never a real image
    child.stdout.end();
    child.emit('close', 0);

    expect(await promise).toBe('not-found');
    expect(res.body().length).toBe(0);
  });

  it('reports not-found for a completely empty object', async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const res = fakeRes();

    const promise = streamMinioObject('projects/a/empty.jpg', res);
    child.stdout.end();
    child.emit('close', 0);

    expect(await promise).toBe('not-found');
    expect(res.body().length).toBe(0);
  });

  it('reports unavailable when the docker daemon is unreachable', async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const res = fakeRes();

    const promise = streamMinioObject('projects/a/photo.jpg', res);
    child.stderr.write(Buffer.from('Cannot connect to the Docker daemon at unix:///var/run/docker.sock'));
    child.stdout.end();
    await flush();
    child.emit('close', 1);

    expect(await promise).toBe('unavailable');
  });

  it('reports unavailable when spawn itself fails', async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const res = fakeRes();

    const promise = streamMinioObject('projects/a/photo.jpg', res);
    child.emit('error', new Error('ENOENT: docker not found'));

    expect(await promise).toBe('unavailable');
  });

  it('kills the child when the client disconnects mid-stream', async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const res = fakeRes();

    const promise = streamMinioObject('projects/a/big.jpg', res);
    child.stdout.write(Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    expect(await promise).toBe('served');
    await flush();

    // Client hangs up while bytes are still flowing — the disconnect guard must
    // still be attached, otherwise `mc cat` blocks forever on a full pipe.
    expect(child.kill).not.toHaveBeenCalled();
    res.emit('close');
    expect(child.kill).toHaveBeenCalled();
  });

  it('stops killing the child once the stream has completed', async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const res = fakeRes();

    const promise = streamMinioObject('projects/a/photo.jpg', res);
    child.stdout.write(Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    await promise;
    await flush();
    child.stdout.end();
    child.emit('close', 0); // clean exit detaches the guard

    res.emit('close');
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('does not crash the process when stdout emits an error', async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const res = fakeRes();

    const promise = streamMinioObject('projects/a/photo.jpg', res);
    child.stdout.write(Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    await promise;
    await flush();

    // An unhandled 'error' on the source stream would otherwise throw, since
    // pipe() does not forward source errors.
    expect(() => child.stdout.emit('error', new Error('EIO'))).not.toThrow();
  });

  it('maps extensions to content types, defaulting to jpeg', async () => {
    for (const [ext, expected] of [['png', 'image/png'], ['webp', 'image/webp'], ['xyz', 'image/jpeg']]) {
      const child = fakeChild();
      spawnMock.mockReturnValue(child);
      const res = fakeRes();

      const promise = streamMinioObject(`projects/a/photo.${ext}`, res);
      child.stdout.write(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      child.stdout.end();
      await promise;

      expect(res.headers['Content-Type']).toBe(expected);
    }
    expect(PHOTO_CONTENT_TYPES.heic).toBe('image/heic');
  });
});

/**
 * Self-heal path: when the `local` mc alias loses its credentials (container
 * recreate wipes /tmp/.mc), `mc cat` fails with an auth error on stderr. The
 * module must re-apply the alias and retry the SAME response once, rather than
 * masking a fixable outage as a 404. A fresh module instance per test resets the
 * heal cooldown/dedupe state.
 */
describe('streamMinioObject alias self-heal', () => {
  let streamMinioObject: typeof import('../minioPhotoStream').streamMinioObject;

  beforeEach(async () => {
    spawnMock.mockReset();
    execFileMock.mockReset();
    // promisify(execFile) → callback style; resolve the heal command by default.
    execFileMock.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (e: unknown, r: unknown) => void) =>
      cb(null, { stdout: '', stderr: '' }),
    );
    vi.resetModules();
    ({ streamMinioObject } = await import('../minioPhotoStream'));
  });

  const driveAuthError = (child: ReturnType<typeof fakeChild>) => {
    // `mc cat` reports a credential-less/missing alias as "Requested path ... not
    // found" on stderr (NOT "Access Denied" — that's mc ls); stdout stays empty.
    child.stderr.write(Buffer.from(MC_AUTH_STDERR));
    child.stdout.end();
  };

  it('re-applies the alias and retries once, then serves the object', async () => {
    const attempt1 = fakeChild();
    const attempt2 = fakeChild();
    spawnMock.mockReturnValueOnce(attempt1).mockReturnValueOnce(attempt2);
    const res = fakeRes();

    const promise = streamMinioObject('projects/a/photo.jpg', res);
    driveAuthError(attempt1);
    await flush();
    attempt1.emit('close', 1); // auth-error → heal + retry
    await flush();
    attempt2.stdout.write(Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    attempt2.stdout.end();

    expect(await promise).toBe('served');
    await flush();
    expect(res.body().subarray(0, 4)).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    expect(spawnMock).toHaveBeenCalledTimes(2);

    // The alias was re-set with a fixed command (no secret in argv — the shell
    // expands $MINIO_ROOT_USER/$MINIO_ROOT_PASSWORD inside the container).
    const healCall = execFileMock.mock.calls.find(
      (c) => Array.isArray(c[1]) && (c[1] as string[]).join(' ').includes('mc alias set local'),
    );
    expect(healCall).toBeTruthy();
    expect((healCall![1] as string[]).join(' ')).not.toContain('minioadmin');
  });

  it('collapses to not-found when the alias still fails after a heal', async () => {
    const attempt1 = fakeChild();
    const attempt2 = fakeChild();
    spawnMock.mockReturnValueOnce(attempt1).mockReturnValueOnce(attempt2);
    const res = fakeRes();

    const promise = streamMinioObject('projects/a/photo.jpg', res);
    driveAuthError(attempt1);
    await flush();
    attempt1.emit('close', 1);
    await flush();
    driveAuthError(attempt2);
    await flush();
    attempt2.emit('close', 1);

    expect(await promise).toBe('not-found');
    expect(res.body().length).toBe(0);
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it('does not heal or retry when the object is genuinely absent', async () => {
    const child = fakeChild();
    spawnMock.mockReturnValueOnce(child);
    const res = fakeRes();

    const promise = streamMinioObject('projects/a/missing.jpg', res);
    // Absent object with GOOD creds: "Object does not exist" — must NOT be read
    // as an auth failure, so no heal and no retry.
    child.stderr.write(Buffer.from(MC_ABSENT_STDERR));
    child.stdout.end();
    await flush();
    child.emit('close', 1);

    expect(await promise).toBe('not-found');
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const healCall = execFileMock.mock.calls.find(
      (c) => Array.isArray(c[1]) && (c[1] as string[]).join(' ').includes('mc alias set local'),
    );
    expect(healCall).toBeFalsy();
  });

  it('does not start a second attempt if the client disconnected during the heal', async () => {
    const attempt1 = fakeChild();
    spawnMock.mockReturnValueOnce(attempt1);
    const res = fakeRes();

    const promise = streamMinioObject('projects/a/photo.jpg', res);
    driveAuthError(attempt1);
    await flush();
    attempt1.emit('close', 1); // → auth-error, then await healMinioAlias()
    // Client hangs up while the heal is in flight.
    res.destroy();

    expect(await promise).toBe('not-found');
    // Only the first attempt ran — no write against the destroyed response.
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });
});

/**
 * resolveLatestVersion resolves an unversioned key to its newest version via
 * `mc ls`, and must self-heal the alias the same way when that ls hits an auth
 * failure (a container recreate breaks ls just like cat).
 */
describe('resolveLatestVersion alias self-heal', () => {
  let resolveLatestVersion: typeof import('../minioPhotoStream').resolveLatestVersion;

  const LS_LINE = '[2026-03-10 12:05:00 UTC] 0B v20260310120500-7bc5005f/\n';
  const authErr = () => Object.assign(new Error('mc failed'), { stderr: MC_AUTH_STDERR });

  beforeEach(async () => {
    spawnMock.mockReset();
    execFileMock.mockReset();
    vi.resetModules();
    ({ resolveLatestVersion } = await import('../minioPhotoStream'));
  });

  it('heals and retries the ls, returning the resolved version', async () => {
    let ls = 0;
    execFileMock.mockImplementation((_c: string, args: string[], _o: unknown, cb: (e: unknown, r?: unknown) => void) => {
      const isAlias = args.join(' ').includes('mc alias set local');
      if (isAlias) return cb(null, { stdout: '', stderr: '' });
      ls += 1;
      // First ls hits the broken alias; the post-heal ls succeeds.
      return ls === 1 ? cb(authErr()) : cb(null, { stdout: LS_LINE, stderr: '' });
    });

    const resolved = await resolveLatestVersion('projects/a/photo.jpg');
    expect(resolved).toBe('projects/a/photo.jpg/v20260310120500-7bc5005f');
    const healed = execFileMock.mock.calls.some(
      (c) => Array.isArray(c[1]) && (c[1] as string[]).join(' ').includes('mc alias set local'),
    );
    expect(healed).toBe(true);
  });

  it('returns null (no heal) for a normal non-auth ls failure', async () => {
    execFileMock.mockImplementation((_c: string, args: string[], _o: unknown, cb: (e: unknown, r?: unknown) => void) => {
      if (args.join(' ').includes('mc alias set local')) return cb(null, { stdout: '', stderr: '' });
      return cb(Object.assign(new Error('mc failed'), { stderr: MC_ABSENT_STDERR }));
    });

    expect(await resolveLatestVersion('projects/a/photo.jpg')).toBeNull();
    const healed = execFileMock.mock.calls.some(
      (c) => Array.isArray(c[1]) && (c[1] as string[]).join(' ').includes('mc alias set local'),
    );
    expect(healed).toBe(false);
  });
});
