/**
 * The MCP edge proxies are PUBLIC and UNAUTHENTICATED by design — the upstream runs its
 * own OAuth server and must issue its own 401 challenge, so the edge cannot gate them.
 * With `bodyParser: false` and `responseLimit: false`, buffering either direction in full
 * lets one caller pin arbitrary memory and take down the whole Next.js process.
 *
 * These tests assert the bound holds, and — for the request side — that it holds by
 * ABANDONING the read rather than by checking a length after the fact. A cap that
 * buffers first and rejects afterwards is not a cap.
 */
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { PassThrough } from 'node:stream';
import { BODY_TOO_LARGE, MAX_PROXY_BODY_BYTES, pipeUpstreamResponse, readCappedBody } from '@/lib/mcp/proxyStream';

/** A body that never ends, counting how much was actually pulled from it. */
function endlessBody(method = 'POST') {
  const CHUNK = Buffer.alloc(64 * 1024, 0x61);
  const state = { pulled: 0, paused: false };
  const stream = new Readable({
    read() {
      state.pulled += CHUNK.length;
      this.push(CHUNK);
    },
  });
  const req = Object.assign(stream, {
    method,
    pause() {
      state.paused = true;
      return Readable.prototype.pause.call(stream);
    },
  });
  return { req: req as never, state };
}

function bodyOf(bytes: number, method = 'POST') {
  const stream = Readable.from([Buffer.alloc(bytes, 0x62)]);
  return Object.assign(stream, { method }) as never;
}

describe('readCappedBody', () => {
  it('passes a normal MCP payload through unchanged', async () => {
    const body = await readCappedBody(bodyOf(2048));
    expect(Buffer.isBuffer(body)).toBe(true);
    expect((body as Buffer).length).toBe(2048);
  });

  it('reads no body at all for GET and HEAD', async () => {
    expect(await readCappedBody(bodyOf(1024, 'GET'))).toBeUndefined();
    expect(await readCappedBody(bodyOf(1024, 'HEAD'))).toBeUndefined();
  });

  it('refuses a body over the cap', async () => {
    const result = await readCappedBody(bodyOf(64 * 1024), 32 * 1024);
    expect(result).toBe(BODY_TOO_LARGE);
  });

  it('stops pulling from an endless body instead of buffering it', async () => {
    // The property that matters. Without an incremental cap this never returns and the
    // heap grows without limit; a naive "check length afterwards" cap never returns either.
    const cap = 256 * 1024;
    const { req, state } = endlessBody();

    const result = await readCappedBody(req, cap);

    expect(result).toBe(BODY_TOO_LARGE);
    // paused, NOT destroyed: destroying the request tears down the socket shared with
    // the response, so the caller would get ECONNRESET instead of the 413.
    expect(state.paused).toBe(true);
    // Bounded by the cap plus at most one chunk of overshoot — not unbounded.
    expect(state.pulled).toBeLessThanOrEqual(cap + 64 * 1024);
  });

  it('defaults to a cap far above real MCP traffic but well below "unbounded"', () => {
    expect(MAX_PROXY_BODY_BYTES).toBe(4 * 1024 * 1024);
  });
});

/** A web ReadableStream emitting the given chunks, like fetch's `upstream.body`. */
function webStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(chunks[i++]!);
      else controller.close();
    },
  });
}

/** A PassThrough standing in for NextApiResponse, collecting what was written. */
function collectingRes() {
  const sink = new PassThrough();
  const received: Buffer[] = [];
  sink.on('data', (c) => received.push(Buffer.from(c)));
  return { res: sink as never, received, sink };
}

describe('pipeUpstreamResponse', () => {
  it('streams the upstream body through without buffering it whole', async () => {
    const chunks = [Buffer.from('hello '), Buffer.from('world')].map((b) => new Uint8Array(b));
    const { res, received } = collectingRes();

    await pipeUpstreamResponse({ body: webStream(chunks), arrayBuffer: async () => new ArrayBuffer(0) }, res);

    expect(Buffer.concat(received).toString()).toBe('hello world');
  });

  it('settles rather than hanging when the upstream body is empty', async () => {
    // The promise must always settle — a pending promise here hangs the request handler.
    const { res, received } = collectingRes();

    await pipeUpstreamResponse({ body: webStream([]), arrayBuffer: async () => new ArrayBuffer(0) }, res);

    expect(Buffer.concat(received).length).toBe(0);
  });

  it('falls back to a buffered send when there is no stream at all', async () => {
    const payload = new TextEncoder().encode('{"ok":true}');
    const received: Buffer[] = [];
    const res = { send: (b: Buffer) => { received.push(b); } } as never;

    await pipeUpstreamResponse({ body: null, arrayBuffer: async () => payload.buffer }, res);

    expect(Buffer.concat(received).toString()).toBe('{"ok":true}');
  });

  it('rejects instead of hanging when the upstream stream errors mid-flight', async () => {
    const failing = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(Buffer.from('partial')));
        controller.error(new Error('upstream exploded'));
      },
    });
    const { res } = collectingRes();

    await expect(
      pipeUpstreamResponse({ body: failing, arrayBuffer: async () => new ArrayBuffer(0) }, res),
    ).rejects.toThrow(/upstream exploded/);
  });

  it('leaves the downstream writable when upstream fails before its first body byte', async () => {
    const failing = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('upstream failed before body'));
      },
    });
    const { res, sink } = collectingRes();

    await expect(
      pipeUpstreamResponse({ body: failing, arrayBuffer: async () => new ArrayBuffer(0) }, res),
    ).rejects.toThrow(/before body/);

    expect(sink.destroyed).toBe(false);
    expect(sink.writableEnded).toBe(false);
    sink.destroy();
  });

  it('cancels a stalled upstream when the client disconnects before the first byte', async () => {
    let cancelled = false;
    const stalled = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const { res, sink } = collectingRes();

    const done = pipeUpstreamResponse(
      { body: stalled, arrayBuffer: async () => new ArrayBuffer(0) },
      res,
    );
    sink.destroy();

    await expect(done).resolves.toBeUndefined();
    expect(cancelled).toBe(true);
  });

  it('cancels the upstream source when the client disconnects early', async () => {
    // Wait for a real first chunk instead of sleeping and hoping CI load does not move
    // the stream across the first-byte boundary. The security property is cancellation;
    // Node may supply different internal destroy reasons for equivalent teardown paths.
    //
    // The property under test: with a bare .pipe() the source is NOT torn down when the
    // destination dies — measured at destroyed === false and still being pulled. On a
    // public unauthenticated proxy that is its own DoS: hang up immediately and leave a
    // large response draining.
    const notCancelled = Symbol('not-cancelled');
    let cancelReason: unknown = notCancelled;
    let sent = false;
    const stalled = new Promise<void>(() => undefined);
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!sent) {
          sent = true;
          controller.enqueue(new Uint8Array(1024));
          return;
        }
        return stalled;
      },
      cancel(reason) {
        cancelReason = reason;
      },
    });
    const { res, sink } = collectingRes();
    const firstDownstreamByte = new Promise<void>((resolve) => {
      sink.once('data', () => resolve());
    });

    const done = pipeUpstreamResponse({ body: endless, arrayBuffer: async () => new ArrayBuffer(0) }, res);
    await firstDownstreamByte;
    sink.destroy(); // client goes away

    // Must settle, and must not treat an ordinary hang-up as an error.
    await expect(done).resolves.toBeUndefined();

    expect(cancelReason, 'upstream source was never cancelled — it is still draining').not.toBe(notCancelled);
  });
});
