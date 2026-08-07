// 🟢 WORKING: shared streaming download helper for Graph/OneDrive media
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { log } from '@/lib/logger';

const LOGGER = 'StreamToFile';

/**
 * Stream an HTTP response body straight to disk.
 *
 * Buffering these first (`Buffer.from(await response.arrayBuffer())`) held each
 * ENTIRE file in memory — recordings run 100 MB+, and on 2026-08-05 concurrent
 * downloads stalling against a slow Graph endpoint exhausted production's 16 GB
 * cgroup. Streaming keeps memory proportional to one chunk regardless of size.
 *
 * Writes to `<destPath>.<pid>.<rand>.part` and renames on success, so an
 * interrupted download can never leave a truncated file at destPath that a later
 * run treats as complete. The partial is removed on failure.
 *
 * The scratch name is unique per download rather than per destination — see the
 * comment at partPath. One consequence: where a shared `<dest>.part` was
 * self-limiting (a later attempt reused and overwrote the same orphan), unique
 * names accumulate if the process is killed mid-stream, so stale partials for
 * this destination are swept before writing.
 *
 * @returns bytes written
 */
/** Orphaned partials older than this are assumed dead, not in flight. */
export const STALE_PARTIAL_MS = 6 * 60 * 60 * 1000;

/**
 * Delete leftover `<destPath>.<pid>.<rand>.part` files older than STALE_PARTIAL_MS.
 *
 * Best-effort and never throws: a failed sweep must not fail the download it was
 * about to make room for.
 */
export function sweepStalePartials(destPath: string, now = Date.now()): number {
  const dir = path.dirname(destPath);
  const prefix = `${path.basename(destPath)}.`;
  let removed = 0;
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!name.startsWith(prefix) || !name.endsWith('.part')) continue;
      const full = path.join(dir, name);
      try {
        if (now - fs.statSync(full).mtimeMs > STALE_PARTIAL_MS) {
          fs.unlinkSync(full);
          removed++;
        }
      } catch {
        // Raced with another sweep or a live writer — skip it.
      }
    }
    if (removed > 0) log.info('Swept stale partial downloads', { dir, removed }, LOGGER);
  } catch (err) {
    log.warn(
      'Could not sweep stale partials',
      { dir, err: err instanceof Error ? err.message : String(err) },
      LOGGER,
    );
  }
  return removed;
}

export async function streamResponseToFile(
  response: { body: ReadableStream<Uint8Array> | null },
  destPath: string,
): Promise<number> {
  if (!response.body) {
    throw new Error('Download failed: response had no body');
  }

  fs.mkdirSync(path.dirname(destPath), { recursive: true });

  // The scratch name must be unique per download, not just per destination.
  // Two downloads racing for the same meeting (webhook + OneDrive scraper both
  // claiming it) previously shared one `<dest>.part`: the first rename moved it
  // away, and the second failed with
  //   ENOENT: rename '<dest>.part' -> '<dest>'
  // after having overwritten the first's bytes mid-flight. Meeting 251591 was
  // left recorded as 2.4MB against a 51MB file on disk, and was transcribed from
  // the truncated fragment.
  const partPath = `${destPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.part`;

  // A SIGKILL/OOM mid-stream leaves the scratch file behind. With the old shared
  // name that self-corrected (the next attempt reused it); unique names would
  // instead pile up one orphan per crash, on the volume that holds 104GB of
  // recordings. Sweep this destination's stale partials first — bounded to
  // siblings of destPath, and never touching a file younger than the cutoff so a
  // concurrent download in flight is left alone.
  sweepStalePartials(destPath);
  try {
    await pipeline(
      Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
      fs.createWriteStream(partPath),
    );
    fs.renameSync(partPath, destPath);
  } catch (err) {
    // Best-effort cleanup. ENOENT is expected (pipeline may have failed before
    // the file existed); anything else is logged rather than swallowed, so an
    // orphaned .part on a full or read-only disk is still observable.
    try {
      fs.unlinkSync(partPath);
    } catch (unlinkErr) {
      const code = (unlinkErr as NodeJS.ErrnoException)?.code;
      if (code !== 'ENOENT') {
        log.warn(
          'Failed to remove partial download',
          { partPath, err: unlinkErr instanceof Error ? unlinkErr.message : String(unlinkErr) },
          LOGGER,
        );
      }
    }
    throw err;
  }

  return fs.statSync(destPath).size;
}
