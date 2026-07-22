import type { NextApiRequest, NextApiResponse } from 'next';
import archiver from 'archiver';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth';
import { log } from '@/lib/logger';
import { vlmProxyKeyParam } from '@/lib/vlm/photoProxyAuth';
import { poleToZipEntries, safeSegment } from '@/modules/works-qa/utils/zip-entries';
import type { PoleQaPhoto } from '@/modules/works-qa/types/works-qa.types';

// Streamed response: disable Next's ~4 MB response cap and its "API resolved
// without sending a response" warning (we own the res lifecycle here).
export const config = { api: { responseLimit: false, externalResolver: true } };

const LOOPBACK_PORT = process.env.PORT ?? '3000';
const LOOPBACK_BASE = `http://127.0.0.1:${LOOPBACK_PORT}`;
const FETCH_CONCURRENCY = 8;     // parallel loopback photo fetches
const MAX_PENDING = 24;          // soft cap on appended-but-unwritten entries (may overshoot by <FETCH_CONCURRENCY)
const FETCH_TIMEOUT_MS = 30_000; // per-photo loopback fetch timeout

// Same prefix dispatch as pon-zip.ts / photo-url.ts: works-qa keys hit VF
// Storage via nginx; everything else goes through the photo-proxy, whose
// ?vlm=true path is authorised by the shared VLM_PROXY_SECRET (vlmProxyKeyParam),
// so this server-to-server call needs no session.
function photoUrl(key: string): string {
  if (key.startsWith('works-qa/')) return `${LOOPBACK_BASE}/storage/${key}`;
  const source = key.startsWith('projects/') ? 'qfield'
              : key.startsWith('sharepoint:') ? 'sharepoint'
              : 'local';
  return `${LOOPBACK_BASE}/api/construction-qa/photo-proxy?key=${encodeURIComponent(key)}&source=${source}${vlmProxyKeyParam()}`;
}

// Fetch a photo with a per-request timeout, also cancelling if the shared
// `parent` signal aborts (client disconnect / archiver error). Uses only
// AbortController + setTimeout so it works under Node and the jsdom test env.
async function fetchPhoto(url: string, cookie: string, parent: AbortSignal): Promise<Response> {
  const ctrl = new AbortController();
  const onParentAbort = () => ctrl.abort();
  parent.addEventListener('abort', onParentAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { headers: cookie ? { cookie } : {}, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
    parent.removeEventListener('abort', onParentAbort);
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method!, ['GET']);

  const { project_id, zone_no } = req.query;
  if (!project_id || typeof project_id !== 'string') return apiResponse.badRequest(res, 'project_id required');
  if (!zone_no || typeof zone_no !== 'string') return apiResponse.badRequest(res, 'zone_no required');
  if (!/^\d+$/.test(zone_no)) return apiResponse.badRequest(res, 'zone_no must be a number');
  const zoneNum = parseInt(zone_no, 10);

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
    // zoneNum is a validated int; pon_no is an int column — safeSegment is
    // defence-in-depth so the prefix can't traverse even if the schema changes.
    poleToZipEntries(pole, `Zone_${zoneNum}/PON_${safeSegment(String(pole.pon_no ?? 'unknown'))}`),
  );

  // --- stream the archive (headers before the first byte) ---
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="works-qa-${project_id.slice(0, 8)}-Zone_${zoneNum}.zip"`);
  res.setHeader('X-Accel-Buffering', 'no'); // stop nginx buffering a multi-GB body

  const archive = archiver('zip', { store: true }); // JPEGs are already compressed — no DEFLATE

  // Soft-bound the append backlog so archiver never queues the whole zone in RAM.
  let pending = 0;
  const drainWaiters: Array<() => void> = [];
  archive.on('entry', () => { pending--; drainWaiters.shift()?.(); });

  // Single teardown for client-disconnect OR archiver error: stop fetching,
  // cancel in-flight fetches, and wake every worker parked in waitForDrain so
  // the Promise.all below always settles (no lost-wakeup leak on abort).
  let aborted = false;
  const fetchAbort = new AbortController();
  const teardown = () => {
    if (aborted) return;
    aborted = true;
    fetchAbort.abort();
    drainWaiters.splice(0).forEach(wake => wake());
  };

  archive.on('warning', err => log.warn('zone-zip: archiver warning', { err: err.message }));
  archive.on('error', err => {
    log.error('zone-zip: archiver error', { err: err.message });
    teardown();
    if (!res.writableEnded && !res.destroyed) res.destroy(err);
  });
  res.on('close', () => { if (!res.writableEnded) teardown(); });
  archive.pipe(res);

  const waitForDrain = () =>
    pending < MAX_PENDING || aborted ? Promise.resolve() : new Promise<void>(resolve => drainWaiters.push(resolve));

  const skipped: string[] = [];
  let idx = 0;
  async function worker() {
    while (idx < entries.length && !aborted) {
      const entry = entries[idx++];
      if (!entry) continue;
      // Defence-in-depth: never fetch or archive a key that could traverse out
      // of its folder (Zip Slip on extract / storage-path escape on fetch).
      if (entry.storageKey.includes('..')) { skipped.push(entry.storageKey); continue; }
      try {
        const resp = await fetchPhoto(photoUrl(entry.storageKey), cookie, fetchAbort.signal);
        if (!resp.ok) { skipped.push(entry.storageKey); continue; }
        const buf = Buffer.from(await resp.arrayBuffer());
        await waitForDrain();
        if (aborted) return;
        pending++;
        archive.append(buf, { name: entry.path });
      } catch (err) {
        if (aborted) return; // fetch aborted by teardown — not a real skip
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
    if (aborted) return; // client gone / archiver errored — nothing to finalize
    if (skipped.length > 0) {
      archive.append(`Skipped ${skipped.length} missing photo(s):\n${skipped.join('\n')}\n`, { name: '_manifest.txt' });
    }
    await archive.finalize();
  } catch (err) {
    log.error('zone-zip: stream failed', { err: err instanceof Error ? err.message : String(err), project_id, zone_no });
    if (!res.writableEnded && !res.destroyed) res.destroy();
  }
}

export default withAuth(withPermission('construction-qa.works-qa.export', 'view')(handler));
