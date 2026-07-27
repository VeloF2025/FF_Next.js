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
      // Stop consuming. Destroying the request prevents the sender from continuing to
      // stream into a socket we have already given up on.
      req.destroy();
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

  await new Promise<void>((resolve, reject) => {
    nodeStream.on('error', reject);
    res.on('close', resolve);
    nodeStream.pipe(res).on('finish', resolve).on('error', reject);
  });
}
