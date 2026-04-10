/**
 * NOC Ticket Attachment Upload API
 *
 * POST /api/noc/ticket-attachment
 *
 * Accepts a multipart upload with:
 *   - file       — image/document file
 *   - ticket_id  — UUID of the ticket
 *   - description — optional description
 *   - is_evidence — 'true' for verification step evidence
 *   - step_number — optional, links to a verification step
 *
 * Uploads to VF Storage under noc/tickets/<ticket_uid>/, inserts a
 * maintenance_attachments record, and optionally sets the photo_url
 * on the corresponding verification step.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import fs from 'fs';
import formidable from 'formidable';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, getAuthUser } from '@/lib/auth';

export const config = {
  api: {
    bodyParser: false,
  },
};

const sql = neon(process.env.DATABASE_URL!);

async function uploadToVfStorage(
  buffer: Buffer,
  filename: string,
  mimeType: string,
  ticketUid: string
): Promise<string> {
  const VF_STORAGE_BASE = process.env.VF_STORAGE_URL ?? 'http://100.96.203.105:8091';

  const formData = new FormData();
  formData.append(
    'file',
    new Blob([buffer as unknown as BlobPart], { type: mimeType }),
    filename
  );

  const storagePath = `noc/tickets/${ticketUid}`;
  const response = await fetch(`${VF_STORAGE_BASE}/upload/${storagePath}`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`VF Storage upload failed (${response.status}): ${text}`);
  }

  const result = (await response.json()) as { path?: string; filename?: string };
  const fullPath = result.path ?? `${storagePath}/${result.filename ?? filename}`;
  return `https://vf.fibreflow.app/storage/${fullPath}`;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'Unknown', ['POST']);
  }

  const user = getAuthUser(req);

  try {
    const form = formidable({ maxFileSize: 20 * 1024 * 1024, keepExtensions: true });
    const [fields, files] = await form.parse(req);

    const ticketId = fields.ticket_id?.[0];
    const description = fields.description?.[0] ?? '';
    const isEvidence = fields.is_evidence?.[0] === 'true';
    const stepNumber = fields.step_number?.[0] ? parseInt(fields.step_number[0], 10) : null;
    const file = files.file?.[0];

    if (!ticketId) {
      return apiResponse.badRequest(res, 'ticket_id is required');
    }

    if (!file) {
      return apiResponse.badRequest(res, 'file is required');
    }

    // Verify ticket exists and get ticket_uid
    const ticket = (await sql`
      SELECT id, ticket_uid FROM maintenance_tickets WHERE id = ${ticketId}
    `)[0];

    if (!ticket) {
      return apiResponse.notFound(res, 'Ticket', ticketId);
    }

    // Read file and upload to VF Storage
    const buffer = fs.readFileSync(file.filepath);
    const filename = file.originalFilename ?? `attachment-${Date.now()}.png`;
    const mimeType = file.mimetype ?? 'image/png';

    const fileUrl = await uploadToVfStorage(buffer, filename, mimeType, ticket.ticket_uid);

    // Insert attachment record
    const attachment = (await sql`
      INSERT INTO maintenance_attachments (
        ticket_id, filename, file_url, file_type, file_size,
        uploaded_by, description, mime_type, storage_url, is_evidence
      )
      VALUES (
        ${ticketId}, ${filename}, ${fileUrl}, ${mimeType.split('/')[1]},
        ${file.size}, ${user?.id ?? ticketId}, ${description},
        ${mimeType}, ${fileUrl}, ${isEvidence}
      )
      RETURNING id, ticket_id, filename, file_url, is_evidence, uploaded_at
    `)[0];

    // Update attachments_count on ticket
    await sql`
      UPDATE maintenance_tickets
      SET attachments_count = attachments_count + 1, updated_at = NOW()
      WHERE id = ${ticketId}
    `;

    // If step_number provided, set photo_url on the verification step
    if (stepNumber) {
      await sql`
        UPDATE maintenance_verification_steps
        SET photo_url = ${fileUrl}, photo_verified = true
        WHERE ticket_id = ${ticketId} AND step_number = ${stepNumber}
      `;
      log.info('Linked attachment to verification step', { ticketId, stepNumber, fileUrl });
    }

    // Clean up temp file
    fs.unlinkSync(file.filepath);

    log.info('Ticket attachment uploaded', {
      ticketId,
      ticketUid: ticket.ticket_uid,
      filename,
      isEvidence,
      stepNumber,
    });

    return apiResponse.success(res, attachment);
  } catch (error) {
    log.error('Failed to upload ticket attachment', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
