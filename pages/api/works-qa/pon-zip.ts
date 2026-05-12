import type { NextApiRequest, NextApiResponse } from 'next';
import JSZip from 'jszip';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { SLOT_META } from '@/modules/works-qa/utils/slot-keys';
import type { PoleQaPhoto } from '@/modules/works-qa/types/works-qa.types';

const STORAGE_BASE = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.fibreflow.app';

function photoUrl(key: string): string {
  return `${STORAGE_BASE}/storage/${key}`;
}

function slotFilename(stepNumber: number, label: string): string {
  return `${String(stepNumber).padStart(2, '0')}_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.jpg`;
}

async function fetchPhoto(url: string): Promise<Buffer | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
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

    const result = await pool.query<PoleQaPhoto>(
      `SELECT * FROM pole_qa_photos
       WHERE project_id = $1::uuid
         AND approved_at IS NOT NULL
         ${ponFilter}
       ORDER BY pole_label ASC`,
      params,
    );

    if (result.rows.length === 0) {
      return apiResponse.notFound(res, 'Approved poles', project_id);
    }

    const ponLabel = ponNum !== undefined ? `PON_${ponNum}` : 'works-qa';
    const zip = new JSZip();

    const civilSlots = SLOT_META.filter(s => s.discipline === 'civil');
    const opticalSlots = SLOT_META.filter(s => s.discipline === 'dome' || s.discipline === 'joint');

    for (const pole of result.rows) {
      const civilFolder = zip.folder(`${ponLabel}/${pole.pole_label}/civil`);
      const opticalFolder = zip.folder(`${ponLabel}/${pole.pole_label}/optical`);

      if (!civilFolder || !opticalFolder) continue;

      // Civil slots
      const civilPromises = civilSlots.map(async slot => {
        const key = pole[slot.dbColumn as keyof PoleQaPhoto] as string | null;
        if (!key) return;
        const buf = await fetchPhoto(photoUrl(key));
        if (buf) civilFolder.file(slotFilename(slot.stepNumber, slot.label), buf);
      });

      // Optical (dome + joint) slots
      const opticalPromises = opticalSlots.map(async slot => {
        const key = pole[slot.dbColumn as keyof PoleQaPhoto] as string | null;
        if (!key) return;
        const buf = await fetchPhoto(photoUrl(key));
        if (buf) opticalFolder.file(slotFilename(slot.stepNumber, slot.label), buf);
      });

      // Tray photos — must await before generateAsync
      const trayKeys: string[] = Array.isArray(pole.optical_joint_tray_keys)
        ? pole.optical_joint_tray_keys
        : [];
      const trayPromises = trayKeys.map(async (trayKey, i) => {
        const buf = await fetchPhoto(photoUrl(trayKey));
        if (buf) opticalFolder.file(`tray_${String(i + 1).padStart(2, '0')}.jpg`, buf);
      });

      await Promise.all([...civilPromises, ...opticalPromises, ...trayPromises]);
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

export default withAuth(handler);
