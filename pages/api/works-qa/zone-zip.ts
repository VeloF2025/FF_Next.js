import type { NextApiRequest, NextApiResponse } from 'next';
import archiver from 'archiver';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth';
import { log } from '@/lib/logger';
import { poleToZipEntries } from '@/modules/works-qa/utils/zip-entries';
import type { PoleQaPhoto } from '@/modules/works-qa/types/works-qa.types';

// Streamed response: disable Next's ~4 MB response cap and its "API resolved
// without sending a response" warning (we own the res lifecycle here).
export const config = { api: { responseLimit: false, externalResolver: true } };

const LOOPBACK_PORT = process.env.PORT ?? '3000';
const LOOPBACK_BASE = `http://127.0.0.1:${LOOPBACK_PORT}`;
const FETCH_CONCURRENCY = 8; // parallel loopback photo fetches
const MAX_PENDING = 24;      // appended-but-unwritten entries (~24 * ~350KB ≈ 8 MB ceiling)

// Same prefix dispatch as pon-zip.ts / photo-url.ts: works-qa keys hit VF
// Storage via nginx; everything else goes through the photo-proxy with a
// localhost bypass (?vlm=true) so this server-to-server call needs no session.
function photoUrl(key: string): string {
  if (key.startsWith('works-qa/')) return `${LOOPBACK_BASE}/storage/${key}`;
  const source = key.startsWith('projects/') ? 'qfield'
              : key.startsWith('sharepoint:') ? 'sharepoint'
              : 'local';
  return `${LOOPBACK_BASE}/api/construction-qa/photo-proxy?key=${encodeURIComponent(key)}&source=${source}&vlm=true`;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method!, ['GET']);

  const { project_id, zone_no } = req.query;
  if (!project_id || typeof project_id !== 'string') return apiResponse.badRequest(res, 'project_id required');
  if (!zone_no || typeof zone_no !== 'string') return apiResponse.badRequest(res, 'zone_no required');
  const zoneNum = parseInt(zone_no, 10);
  if (isNaN(zoneNum)) return apiResponse.badRequest(res, 'zone_no must be a number');

  // Default ships only approved poles (matches pon-zip). include_unapproved=true
  // ZIPs the whole zone mid-sweep, including unassigned photos.
  const includeUnapproved = req.query.include_unapproved === 'true';
  const approvedFilter = includeUnapproved ? '' : 'AND approved_at IS NOT NULL';

  let rows: PoleQaPhoto[];
  try {
    const result = await pool.query<PoleQaPhoto>(
      `SELECT * FROM pole_qa_photos
        WHERE project_id = $1::uuid AND zone_no = $2
          ${approvedFilter}
        ORDER BY pon_no ASC, pole_label ASC`,
      [project_id, zoneNum],
    );
    rows = result.rows;
  } catch (err) {
    log.error('zone-zip: query failed', { err, project_id, zone_no });
    return apiResponse.internalError(res, 'Failed to query zone photos');
  }

  if (rows.length === 0) {
    return apiResponse.notFound(res, includeUnapproved ? 'Poles' : 'Approved poles', `${project_id} zone ${zoneNum}`);
  }

  const cookie = req.headers.cookie ?? '';
  const entries = rows.flatMap(pole =>
    poleToZipEntries(pole, `Zone_${zoneNum}/PON_${pole.pon_no ?? 'unknown'}`),
  );

  // --- stream the archive (headers before the first byte) ---
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="works-qa-${project_id.slice(0, 8)}-Zone_${zoneNum}.zip"`);
  res.setHeader('X-Accel-Buffering', 'no'); // stop nginx buffering a multi-GB body

  const archive = archiver('zip', { store: true }); // JPEGs are already compressed — no DEFLATE
  archive.on('warning', err => log.warn('zone-zip: archiver warning', { err: err.message }));
  archive.on('error', err => { log.error('zone-zip: archiver error', { err: err.message }); res.destroy(err); });
  archive.pipe(res);

  // Bound the append backlog so archiver never queues the whole zone in RAM.
  let pending = 0;
  const drainWaiters: Array<() => void> = [];
  archive.on('entry', () => { pending--; drainWaiters.shift()?.(); });
  const waitForDrain = () =>
    pending < MAX_PENDING ? Promise.resolve() : new Promise<void>(resolve => drainWaiters.push(resolve));

  // Stop fetching if the client cancels the download mid-stream.
  let aborted = false;
  res.on('close', () => { if (!res.writableEnded) { aborted = true; archive.abort(); } });

  const skipped: string[] = [];
  let idx = 0;
  async function worker() {
    while (idx < entries.length && !aborted) {
      const entry = entries[idx++];
      if (!entry) continue;
      try {
        const resp = await fetch(photoUrl(entry.storageKey), { headers: cookie ? { cookie } : {} });
        if (!resp.ok) { skipped.push(entry.storageKey); continue; }
        const buf = Buffer.from(await resp.arrayBuffer());
        await waitForDrain();
        if (aborted) return;
        pending++;
        archive.append(buf, { name: entry.path });
      } catch (err) {
        skipped.push(entry.storageKey);
        log.warn('zone-zip: photo fetch failed', {
          key: entry.storageKey,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  try {
    await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, () => worker()));
    if (!aborted && skipped.length > 0) {
      archive.append(`Skipped ${skipped.length} missing photo(s):\n${skipped.join('\n')}\n`, { name: '_manifest.txt' });
    }
    if (!aborted) await archive.finalize();
  } catch (err) {
    log.error('zone-zip: stream failed', { err: err instanceof Error ? err.message : String(err), project_id, zone_no });
    if (!res.writableEnded) res.destroy();
  }
}

export default withAuth(withPermission('construction-qa.works-qa.export', 'view')(handler));
