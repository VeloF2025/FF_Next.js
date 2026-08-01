/**
 * Bounded body reading and response streaming for the MCP edge proxies.
 *
 * These proxies are PUBLIC and UNAUTHENTICATED by design — the upstream MCP service runs
 * its own OAuth 2.1 authorization server and must issue its own 401 challenge, so the
 * edge cannot gate them. That makes unbounded buffering a direct denial-of-service on the
 * whole Next.js process, not just on one endpoint: `bodyParser: false` plus
 * `responseLimit: false` plus a full `Buffer.concat` of the request and a full
 * `arrayBuffer()` of the response means one caller can pin arbitrary memory.
 *
 * Extracted rather than copied. The flaw existed in `cortex-remote-mcp` and was
 * faithfully reproduced when that file was cloned for a second proxy — which is the
 * argument for one implementation with one place to fix.
 */
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Largest request body forwarded upstream.
 *
 * MCP traffic is JSON-RPC — requests are kilobytes. 4 MiB is far above any legitimate
 * message while still bounding what a single caller can make the process hold.
 */
export const MAX_PROXY_BODY_BYTES = 4 * 1024 * 1024;

/** Sentinel returned when the caller exceeded the cap. */
export const BODY_TOO_LARGE = Symbol('BODY_TOO_LARGE');

/**
 * Read the request body, refusing anything over `maxBytes`.
 *
 * Counts as it goes and abandons the read the moment the cap is passed, so an attacker
 * streaming an endless body is stopped at the limit rather than after it has been
 * buffered. GET/HEAD carry no body and return undefined.
 */
export async function readCappedBody(
  req: NextApiRequest,
  maxBytes: number = MAX_PROXY_BODY_BYTES,
): Promise<Buffer | undefined | typeof BODY_TOO_LARGE> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;

  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      // pause(), NOT destroy(). Measured directly: req.destroy() tears down the socket
      // SHARED with the response, so the caller receives ECONNRESET and never sees the
      // 413 — the error we carefully build is unreachable. pause() stops us reading, TCP
      // backpressure stalls the sender, and the 413 is delivered (verified: 413 in 37ms
      // having read 65 KB of an 8 MB body).
      req.pause();
      return BODY_TOO_LARGE;
    }
    chunks.push(buf);
  }

  return Buffer.concat(chunks);
}

/**
 * Send the upstream response to the client without buffering it.
 *
 * The previous implementation did `Buffer.from(await upstream.arrayBuffer())`, holding the
 * entire response in the heap before writing a byte. Piping keeps memory proportional to
 * one chunk regardless of response size, which matters because `responseLimit: false`
 * removes Next's own ceiling.
 *
 * Falls back to a buffered send only when the upstream produced no stream (an empty body),
 * where there is nothing to bound.
 */
export async function pipeUpstreamResponse(
  upstream: { body: ReadableStream<Uint8Array> | null; arrayBuffer(): Promise<ArrayBuffer> },
  res: NextApiResponse,
): Promise<void> {
  if (!upstream.body) {
    res.send(Buffer.from(await upstream.arrayBuffer()));
    return;
  }

  const nodeStream = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]);
  const iterator = nodeStream[Symbol.asyncIterator]();
  let clientClosed = false;
  const cancelBeforeFirstByte = () => {
    clientClosed = true;
    nodeStream.destroy();
  };
  res.once('close', cancelBeforeFirstByte);

  let first: IteratorResult<unknown>;
  try {
    first = await iterator.next();
  } catch (error) {
    if (clientClosed) return;
    throw error;
  } finally {
    res.off('close', cancelBeforeFirstByte);
  }

  if (clientClosed || res.destroyed) {
    nodeStream.destroy();
    return;
  }
  if (first.done) {
    res.end();
    return;
  }

  const stagedStream = Readable.from(
    (async function* streamFromFirstByte() {
      try {
        yield first.value;
        while (true) {
          const next = await iterator.next();
          if (next.done) return;
          yield next.value;
        }
      } finally {
        nodeStream.destroy();
      }
    })(),
    { objectMode: false },
  );
  stagedStream.once('error', (error) => nodeStream.destroy(error));

  try {
    // pipeline(), not pipe(). A bare .pipe() does NOT tear down the source when the
    // destination goes away: measured directly, after the client socket was destroyed the
    // upstream stream kept being pulled and was still `destroyed === false`. On a public
    // unauthenticated proxy that is its own denial of service — open many requests, hang
    // up immediately, and each one goes on draining a large upstream response into a dead
    // socket. That would have undone most of the cap this function exists to provide.
    await pipeline(stagedStream, res);
  } catch (err) {
    // The client hanging up mid-response is normal traffic, not a failure: pipeline has
    // already destroyed both streams, which is the whole point of using it.
    if ((err as NodeJS.ErrnoException)?.code === 'ERR_STREAM_PREMATURE_CLOSE') {
      nodeStream.destroy(err as Error);
      if (!nodeStream.closed) {
        await new Promise<void>((resolve) => nodeStream.once('close', resolve));
      }
      return;
    }
    throw err;
  }
}
