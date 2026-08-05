// 🟢 WORKING: shared streaming download helper for Graph/OneDrive media
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
 * Writes to `<destPath>.part` and renames on success, so an interrupted download
 * can never leave a truncated file at destPath that a later run treats as
 * complete. The partial is removed on failure.
 *
 * @returns bytes written
 */
export async function streamResponseToFile(
  response: { body: ReadableStream<Uint8Array> | null },
  destPath: string,
): Promise<number> {
  if (!response.body) {
    throw new Error('Download failed: response had no body');
  }

  fs.mkdirSync(path.dirname(destPath), { recursive: true });

  const partPath = `${destPath}.part`;
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
