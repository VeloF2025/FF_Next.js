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

import { BODY_TOO_LARGE, MAX_PROXY_BODY_BYTES, readCappedBody } from '@/lib/mcp/proxyStream';

/** A body that never ends, counting how much was actually pulled from it. */
function endlessBody(method = 'POST') {
  const CHUNK = Buffer.alloc(64 * 1024, 0x61);
  const state = { pulled: 0, destroyed: false };
  const stream = new Readable({
    read() {
      state.pulled += CHUNK.length;
      this.push(CHUNK);
    },
  });
  const req = Object.assign(stream, {
    method,
    destroy() {
      state.destroyed = true;
      Readable.prototype.destroy.call(stream);
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
    expect(state.destroyed).toBe(true);
    // Bounded by the cap plus at most one chunk of overshoot — not unbounded.
    expect(state.pulled).toBeLessThanOrEqual(cap + 64 * 1024);
  });

  it('defaults to a cap far above real MCP traffic but well below "unbounded"', () => {
    expect(MAX_PROXY_BODY_BYTES).toBe(4 * 1024 * 1024);
  });
});
