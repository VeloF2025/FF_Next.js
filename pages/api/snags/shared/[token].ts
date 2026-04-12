/**
 * Shared Snag Ticket API (public — no auth required)
 *
 * GET  /api/snags/shared/[token] — Get ticket data for the public resolve page
 * POST /api/snags/shared/[token] — Perform an action (start_work, submit_for_qa, complete_step)
 *
 * Actions are gated by ticket status:
 *   - start_work:     only when status = 'assigned'
 *   - submit_for_qa:  only when status = 'in_progress'
 *   - complete_step:  only when status = 'in_progress'
 *
 * When status is not assigned/in_progress, the page is read-only.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

export const config = {
  api: { bodyParser: false },
};

const sql = neon(process.env.DATABASE_URL!);

/** Statuses where the subcontractor can interact */
const INTERACTIVE_STATUSES = new Set(['assigned', 'in_progress']);

async function resolveToken(token: string) {
  const rows = await sql`
    SELECT st.ticket_id, st.is_active, st.created_at as shared_at,
           mt.id, mt.ticket_uid, mt.status, mt.title, mt.description, mt.priority,
           mt.type, mt.source,
           (u.first_name || ' ' || u.last_name) AS assigned_to_name,
           p.project_name
    FROM snag_share_tokens st
    JOIN maintenance_tickets mt ON mt.id = st.ticket_id
    LEFT JOIN users u ON u.id = mt.assigned_to
    LEFT JOIN snags s ON s.noc_ticket_id = mt.id
    LEFT JOIN projects p ON p.id = COALESCE(s.project_id, mt.project_id)
    WHERE st.token = ${token}
    LIMIT 1
  ` as Array<Record<string, unknown>>;

  if (rows.length === 0) return null;
  return rows[0]!;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { token } = req.query;
  if (!token || typeof token !== 'string') {
    return apiResponse.error(res, 400 as never, 'Token is required');
  }

  const ticketData = await resolveToken(token);
  if (!ticketData || !ticketData.is_active) {
    return apiResponse.error(res, 404 as never, 'Invalid or expired share link');
  }

  const ticketId = ticketData.ticket_id as string;
  const status = ticketData.status as string;
  const canInteract = INTERACTIVE_STATUSES.has(status);

  if (req.method === 'GET') {
    // Fetch verification steps — initialize if missing (for pre-existing tickets)
    let steps = await sql`
      SELECT id, step_number, step_name, step_description, is_complete, completed_at,
             photo_required, photo_url, photo_verified, notes
      FROM maintenance_verification_steps
      WHERE ticket_id = ${ticketId}
      ORDER BY step_number ASC
    ` as Array<Record<string, unknown>>;

    if (steps.length === 0) {
      // Auto-initialize verification steps from ticket type
      const ticketType = ticketData.type as string;
      try {
        const { initializeVerificationSteps } = await import('@/modules/noc/services/verificationService');
        const created = await initializeVerificationSteps(ticketId, ticketType);
        steps = created.map(s => ({ ...s }));
        log.info('Auto-initialized verification steps for shared ticket', { ticketId, ticketType, count: steps.length });
      } catch (err) {
        log.error('Failed to initialize verification steps for shared ticket', { ticketId, error: err instanceof Error ? err.message : 'Unknown' });
      }
    }

    // Fetch before photos — check snag_photos (for snags) AND maintenance_attachments (for all types)
    const snagPhotos = await sql`
      SELECT sp.photo_url, sp.thumbnail_url, sp.phase
      FROM snag_photos sp
      JOIN snags s ON s.id = sp.snag_id
      WHERE s.noc_ticket_id = ${ticketId}
        AND sp.phase = 'before'
      ORDER BY sp.created_at ASC
      LIMIT 3
    ` as Array<Record<string, unknown>>;

    const attachmentPhotos = await sql`
      SELECT file_url AS photo_url, file_url AS thumbnail_url, 'before' AS phase
      FROM maintenance_attachments
      WHERE ticket_id = ${ticketId} AND is_evidence = true
      ORDER BY uploaded_at ASC
      LIMIT 3
    ` as Array<Record<string, unknown>>;

    // Merge: snag_photos first, then attachments (deduplicated)
    const beforePhotos = snagPhotos.length > 0 ? snagPhotos : attachmentPhotos;

    // Fetch ticket attachments (after photos uploaded by subcontractor)
    const attachments = await sql`
      SELECT id, filename, storage_url, file_type, uploaded_at
      FROM maintenance_attachments
      WHERE ticket_id = ${ticketId}
      ORDER BY uploaded_at ASC
    ` as Array<Record<string, unknown>>;

    return apiResponse.success(res, {
      ticket: {
        id: ticketId,
        ticket_uid: ticketData.ticket_uid,
        status,
        title: ticketData.title,
        description: ticketData.description,
        priority: ticketData.priority,
        assigned_to_name: ticketData.assigned_to_name,
        project_name: ticketData.project_name,
      },
      canInteract,
      canStartWork: status === 'assigned',
      canSubmit: status === 'in_progress',
      steps,
      beforePhotos,
      attachments,
    });
  }

  if (req.method === 'POST') {
    // Check if this is a multipart upload (photo) or JSON action
    const contentType = req.headers['content-type'] ?? '';
    if (contentType.includes('multipart/form-data')) {
      // Photo upload via formidable
      if (status !== 'in_progress') {
        return apiResponse.error(res, 400 as never, 'Ticket must be In Progress to upload photos');
      }
      try {
        const formidable = (await import('formidable')).default;
        const fs = await import('fs');
        const form = formidable({ maxFileSize: 20 * 1024 * 1024, keepExtensions: true });
        const [fields, files] = await form.parse(req);
        const file = files.file?.[0];
        const stepIdField = fields.stepId?.[0];
        if (!file) return apiResponse.error(res, 400 as never, 'file is required');

        // Upload to VF Storage
        const buffer = fs.readFileSync(file.filepath);
        const filename = file.originalFilename ?? `photo-${Date.now()}.jpg`;
        const VF_STORAGE_BASE = process.env.VF_STORAGE_URL ?? 'http://100.96.203.105:8091';
        const formData = new FormData();
        formData.append('file', new Blob([buffer as unknown as BlobPart], { type: file.mimetype ?? 'image/jpeg' }), filename);
        const uploadRes = await fetch(`${VF_STORAGE_BASE}/upload/noc/tickets`, { method: 'POST', body: formData });
        if (!uploadRes.ok) throw new Error('VF Storage upload failed');
        const uploadResult = await uploadRes.json() as { path?: string; filename?: string };
        const storagePath = uploadResult.path ?? `noc/tickets/${uploadResult.filename ?? filename}`;
        const fileUrl = `/api/uploads/${storagePath}`;

        // Insert attachment
        await sql`
          INSERT INTO maintenance_attachments (ticket_id, filename, file_url, file_type, file_size, uploaded_by, description, mime_type, storage_url, is_evidence)
          VALUES (${ticketId}, ${filename}, ${fileUrl}, 'photo', ${file.size}, ${ticketId}, 'Uploaded by field technician', ${file.mimetype ?? 'image/jpeg'}, ${fileUrl}, true)
        `;
        await sql`UPDATE maintenance_tickets SET attachments_count = attachments_count + 1, updated_at = NOW() WHERE id = ${ticketId}`;

        // Link to verification step and mark complete
        if (stepIdField) {
          await sql`UPDATE maintenance_verification_steps SET photo_url = ${fileUrl}, photo_verified = true, is_complete = true, completed_at = NOW() WHERE id = ${stepIdField} AND ticket_id = ${ticketId}`;
        }

        fs.unlinkSync(file.filepath);
        log.info('Shared ticket: photo uploaded', { ticketId, filename, stepId: stepIdField });
        return apiResponse.success(res, { uploaded: true, url: fileUrl });
      } catch (err) {
        log.error('Shared ticket: photo upload failed', { ticketId, error: err instanceof Error ? err.message : 'Unknown' });
        return apiResponse.error(res, 500 as never, 'Photo upload failed');
      }
    }

    // Parse JSON body manually (bodyParser disabled for multipart support)
    let body: Record<string, unknown> = {};
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    } catch {
      return apiResponse.error(res, 400 as never, 'Invalid JSON body');
    }
    const { action, stepId, notes } = body as {
      action: 'start_work' | 'submit_for_qa' | 'complete_step';
      stepId?: string;
      notes?: string;
    };

    if (!action) {
      return apiResponse.error(res, 400 as never, 'action is required');
    }

    try {
      if (action === 'start_work') {
        if (status !== 'assigned') {
          return apiResponse.error(res, 400 as never, 'Ticket must be in Assigned status to start work');
        }
        await sql`UPDATE maintenance_tickets SET status = 'in_progress', updated_at = NOW() WHERE id = ${ticketId}`;
        // Mirror status on linked snag row (civils tickets). No-op for other discipline types.
        await sql`UPDATE snags SET status = 'in_progress', updated_at = NOW() WHERE noc_ticket_id = ${ticketId}`;
        log.info('Shared ticket: start work', { ticketId, token: token.substring(0, 8) });
        return apiResponse.success(res, { newStatus: 'in_progress' });
      }

      if (action === 'submit_for_qa') {
        if (status !== 'in_progress') {
          return apiResponse.error(res, 400 as never, 'Ticket must be In Progress to submit for QA');
        }
        await sql`UPDATE maintenance_tickets SET status = 'pending_qa', updated_at = NOW() WHERE id = ${ticketId}`;
        // Mirror status on linked snag row (civils tickets). No-op for other discipline types.
        await sql`UPDATE snags SET status = 'pending_qa', updated_at = NOW(), fixed_at = NOW() WHERE noc_ticket_id = ${ticketId}`;
        log.info('Shared ticket: submitted for QA', { ticketId, token: token.substring(0, 8) });
        return apiResponse.success(res, { newStatus: 'pending_qa' });
      }

      if (action === 'complete_step') {
        if (status !== 'in_progress') {
          return apiResponse.error(res, 400 as never, 'Ticket must be In Progress to complete steps');
        }
        if (!stepId) {
          return apiResponse.error(res, 400 as never, 'stepId is required');
        }
        await sql`
          UPDATE maintenance_verification_steps
          SET is_complete = true, completed_at = NOW(), notes = COALESCE(${notes ?? null}, notes)
          WHERE id = ${stepId} AND ticket_id = ${ticketId}
        `;
        log.info('Shared ticket: step completed', { ticketId, stepId, token: token.substring(0, 8) });
        return apiResponse.success(res, { completed: true });
      }

      return apiResponse.error(res, 400 as never, 'Invalid action');
    } catch (error) {
      log.error('Shared ticket action error', { error, ticketId, action });
      return apiResponse.internalError(res, error);
    }
  }

  return apiResponse.methodNotAllowed(res, req.method ?? 'Unknown', ['GET', 'POST']);
}

// No withAuth — this is a public endpoint
export default handler;
