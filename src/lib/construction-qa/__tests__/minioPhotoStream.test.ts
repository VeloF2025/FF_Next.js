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
