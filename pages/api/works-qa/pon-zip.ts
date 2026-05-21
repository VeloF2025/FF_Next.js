import type { NextApiRequest, NextApiResponse } from 'next';
import JSZip from 'jszip';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth';
import { log } from '@/lib/logger';
import { SLOT_META } from '@/modules/works-qa/utils/slot-keys';
import type { PoleQaPhoto } from '@/modules/works-qa/types/works-qa.types';

// Loopback so the server-to-server call lands on the local Next.js process and the
// photo-proxy's localhost-bypass (`?vlm=true`) accepts it without a session cookie.
// Falls back to the user's cookie for non-loopback paths if PORT is unknown.
const LOOPBACK_PORT = process.env.PORT ?? '3000';
const LOOPBACK_BASE = `http://127.0.0.1:${LOOPBACK_PORT}`;

function photoUrl(key: string): string {
  // See src/modules/works-qa/utils/photo-url.ts for the dispatch rationale.
  if (key.startsWith('works-qa/')) return `${LOOPBACK_BASE}/storage/${key}`;
  const source = key.startsWith('projects/')   ? 'qfield'
              : key.startsWith('sharepoint:') ? 'sharepoint'
              :                                 'local';
  return `${LOOPBACK_BASE}/api/construction-qa/photo-proxy?key=${encodeURIComponent(key)}&source=${source}&vlm=true`;
}

function slotFilename(stepNumber: number, label: string): string {
  return `${String(stepNumber).padStart(2, '0')}_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.jpg`;
}

async function fetchPhoto(url: string, cookie: string): Promise<Buffer | null> {
  try {
    const resp = await fetch(url, { headers: cookie ? { cookie } : {} });
    if (!resp.ok) {
      log.warn('pon-zip: fetchPhoto non-OK', { url, status: resp.status });
      return null;
    }
    return Buffer.from(await resp.arrayBuffer());
  } catch (err) {
    log.error('pon-zip: fetchPhoto failed', { url, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method!, ['GET']);

  const { project_id, pon_no } = req.query;
  if (!project_id || typeof project_id !== 'string') {
    return apiResponse.badRequest(res, 'project_id required');
  }

  try {
    const params: (string | number)[] = [project_id];
    let ponFilter = '';
    let ponNum: number | undefined;

    if (pon_no && typeof pon_no === 'string') {
      ponNum = parseInt(pon_no, 10);
      if (isNaN(ponNum)) return apiResponse.badRequest(res, 'pon_no must be a number');
      params.push(ponNum);
      ponFilter = `AND pon_no = $${params.length}`;
    }

    // Default ships only approved poles (backward compat). include_unapproved=true
    // lets Johan ZIP a PON mid-sweep so he can re-distribute uncategorised photos.
    const includeUnapproved = req.query.include_unapproved === 'true';
    const approvedFilter = includeUnapproved ? '' : 'AND approved_at IS NOT NULL';

    const result = await pool.query<PoleQaPhoto>(
      `SELECT * FROM pole_qa_photos
       WHERE project_id = $1::uuid
         ${approvedFilter}
         ${ponFilter}
       ORDER BY pole_label ASC`,
      params,
    );

    if (result.rows.length === 0) {
      return apiResponse.notFound(res, 'Approved poles', project_id);
    }

    const ponLabel = ponNum !== undefined ? `PON_${ponNum}` : 'works-qa';
    const zip = new JSZip();
    // Forward the caller's cookie so the loopback fetch authenticates as the same
    // user when localhost-bypass doesn't apply (e.g. cookie-auth photo proxies).
    const cookie = req.headers.cookie ?? '';

    const civilSlots = SLOT_META.filter(s => s.discipline === 'civil');
    const opticalSlots = SLOT_META.filter(s => s.discipline === 'dome' || s.discipline === 'main_joint');

    for (const pole of result.rows) {
      const civilFolder = zip.folder(`${ponLabel}/${pole.pole_label}/civil`);
      const opticalFolder = zip.folder(`${ponLabel}/${pole.pole_label}/optical`);

      if (!civilFolder || !opticalFolder) continue;

      // Civil slots
      const civilPromises = civilSlots.map(async slot => {
        const key = pole[slot.dbColumn as keyof PoleQaPhoto] as string | null;
        if (!key) return;
        const buf = await fetchPhoto(photoUrl(key), cookie);
        if (buf) civilFolder.file(slotFilename(slot.stepNumber, slot.label), buf);
      });

      // Optical (dome + joint) slots
      const opticalPromises = opticalSlots.map(async slot => {
        const key = pole[slot.dbColumn as keyof PoleQaPhoto] as string | null;
        if (!key) return;
        const buf = await fetchPhoto(photoUrl(key), cookie);
        if (buf) opticalFolder.file(slotFilename(slot.stepNumber, slot.label), buf);
      });

      // Tray photos — must await before generateAsync
      const trayKeys: string[] = Array.isArray(pole.main_joint_tray_keys)
        ? pole.main_joint_tray_keys
        : [];
      const trayPromises = trayKeys.map(async (trayKey, i) => {
        const buf = await fetchPhoto(photoUrl(trayKey), cookie);
        if (buf) opticalFolder.file(`tray_${String(i + 1).padStart(2, '0')}.jpg`, buf);
      });

      // Unassigned bucket — photos that came in via QField sync or bulk upload
      // but haven't been placed in a slot yet. Ship them in their own folder.
      const unassignedKeys: string[] = Array.isArray(pole.unassigned_photo_keys)
        ? pole.unassigned_photo_keys
        : [];
      const unassignedFolder = zip.folder(`${ponLabel}/${pole.pole_label}/unassigned`);
      const unassignedPromises = unassignedFolder ? unassignedKeys.map(async (key, i) => {
        const buf = await fetchPhoto(photoUrl(key), cookie);
        if (buf) unassignedFolder.file(`photo_${String(i + 1).padStart(2, '0')}.jpg`, buf);
      }) : [];

      await Promise.all([...civilPromises, ...opticalPromises, ...trayPromises, ...unassignedPromises]);
    }

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

    const filename = ponNum !== undefined
      ? `works-qa-PON_${ponNum}.zip`
      : `works-qa-${project_id.slice(0, 8)}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', zipBuffer.length);
    res.status(200).end(zipBuffer);
  } catch (err) {
    log.error('pon-zip: failed to generate ZIP', { err, project_id, pon_no });
    return apiResponse.internalError(res, 'Failed to generate ZIP');
  }
}

export default withAuth(withPermission('construction-qa.works-qa.export', 'view')(handler));
