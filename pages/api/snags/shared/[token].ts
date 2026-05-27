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
import { createHash } from 'crypto';
import { neon } from '@neondatabase/serverless';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import rateLimiter from '@/lib/rateLimiter';
import {
  getStepsForCategoryAndDiscipline,
  type PhotoSlot,
} from '@/modules/noc/constants/verificationSteps';

export const config = {
  api: { bodyParser: false },
};

const sql = neon(process.env.DATABASE_URL!);

/** Statuses where the subcontractor can interact */
const INTERACTIVE_STATUSES = new Set(['assigned', 'in_progress']);

/** Cap JSON body reads on this public endpoint to protect against OOM. */
const MAX_BODY_BYTES = 64 * 1024;

/** Server-side max lengths — second line of defence behind DB CHECKs. */
const MAX_NAME_LEN = 200;
const MAX_PHONE_LEN = 50;
const MAX_COMPANY_LEN = 200;
const MAX_FINGERPRINT_LEN = 128;

/** SHA256 of the raw share token. The actors table never stores raw tokens. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Read JSON body with a hard size cap. */
async function readJsonBody(req: NextApiRequest): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.from(chunk);
    total += buf.length;
    if (total > MAX_BODY_BYTES) return null;
    chunks.push(buf);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
  } catch {
    return null;
  }
}

/** Best-effort client IP for rate-limit keys. */
function clientIp(req: NextApiRequest): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0]!.trim();
  return req.socket.remoteAddress ?? 'unknown';
}

/**
 * Verify an actor row belongs to the given share token. Prevents an attacker
 * from registering on one link and using the resulting actor_id to stamp
 * activity on a different link.
 */
async function actorBelongsToToken(actorId: string, token: string): Promise<boolean> {
  const tokenHash = hashToken(token);
  const rows = await sql`
    SELECT 1 FROM share_session_actors
    WHERE id = ${actorId} AND token_hash = ${tokenHash}
    LIMIT 1
  ` as Array<unknown>;
  return rows.length > 0;
}

/**
 * Fetch a verification step and confirm it belongs to the given ticket.
 * Prevents an actor on Ticket A from injecting maintenance_step_photos
 * rows for a step on Ticket B. Returns is_complete so callers can block
 * post-completion replacement (evidence-tampering guard on this public endpoint).
 */
async function getStepForTicket(
  stepId: string,
  ticketId: string,
): Promise<{ step_number: number; is_complete: boolean } | null> {
  const rows = await sql`
    SELECT step_number, is_complete FROM maintenance_verification_steps
    WHERE id = ${stepId} AND ticket_id = ${ticketId}
    LIMIT 1
  ` as Array<{ step_number: number; is_complete: boolean }>;
  return rows[0] ?? null;
}

/**
 * Resolve a slot definition from the ticket's step template. Returns null if
 * the slot key isn't declared in the template — which means the upload should
 * be rejected, not written with guessed metadata.
 */
function resolveSlotFromTemplate(
  ticketCategory: string | null,
  ticketDiscipline: string,
  stepNumber: number,
  slotKey: string,
): PhotoSlot | null {
  const template = getStepsForCategoryAndDiscipline(ticketCategory, ticketDiscipline);
  const step = template.find((s) => s.step_number === stepNumber);
  return step?.photo_slots?.find((slot) => slot.key === slotKey) ?? null;
}

async function resolveToken(token: string) {
  const rows = await sql`
    SELECT st.ticket_id, st.is_active, st.created_at as shared_at,
           mt.id, mt.ticket_uid, mt.status, mt.title, mt.description, mt.priority,
           mt.type, mt.source, mt.ticket_category,
           (u.first_name || ' ' || u.last_name) AS assigned_to_name,
           p.project_name
    FROM snag_share_tokens st
    JOIN maintenance_tickets mt ON mt.id = st.ticket_id
    LEFT JOIN users u ON u.id = mt.assigned_to
    LEFT JOIN snags s ON s.noc_ticket_id = mt.id
    LEFT JOIN projects p ON p.id = s.project_id
    WHERE st.token = ${token}
    LIMIT 1
  ` as Array<Record<string, unknown>>;

  if (rows.length === 0) return null;
  return rows[0]!;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { token } = req.query;
  if (!token || typeof token !== 'string') {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Token is required');
  }

  let ticketData: Record<string, unknown> | null;
  try {
    ticketData = await resolveToken(token);
  } catch (err) {
    log.error('Failed to resolve share token', { error: err instanceof Error ? err.message : 'Unknown', token: token.substring(0, 8) });
    return apiResponse.internalError(res, err, 'Failed to load ticket details');
  }
  if (!ticketData || !ticketData.is_active) {
    return apiResponse.error(res, ErrorCode.NOT_FOUND, 'Invalid or expired share link');
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

    // Fetch per-step photo slots (slot-aware steps only). Returned alongside
    // each step so the resolve page can render slot tiles. Steps with no
    // photo_slots in their template have no rows here and fall back to the
    // legacy single-photo flow.
    const stepIds = steps.map((s) => s.id).filter((id): id is string => typeof id === 'string');
    const stepPhotos = stepIds.length > 0
      ? (await sql`
          SELECT id, step_id, slot_key, slot_label, source_mode, is_required,
                 photo_url, uploaded_by_actor_id, uploaded_at
          FROM maintenance_step_photos
          WHERE step_id = ANY(${stepIds}::uuid[])
          ORDER BY step_id, slot_key
        `) as Array<Record<string, unknown>>
      : [];

    // Group photos by step_id for the response shape.
    const photosByStep = new Map<string, Array<Record<string, unknown>>>();
    for (const photo of stepPhotos) {
      const sid = photo.step_id as string;
      const list = photosByStep.get(sid) ?? [];
      list.push(photo);
      photosByStep.set(sid, list);
    }
    const stepsWithPhotos = steps.map((s) => ({
      ...s,
      photo_slots: photosByStep.get(s.id as string) ?? [],
    }));

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
      steps: stepsWithPhotos,
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
        return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Ticket must be In Progress to upload photos');
      }
      try {
        const formidable = (await import('formidable')).default;
        const fs = await import('fs');
        const form = formidable({ maxFileSize: 20 * 1024 * 1024, keepExtensions: true });
        const [fields, files] = await form.parse(req);
        const file = files.file?.[0];
        const stepIdField = fields.stepId?.[0];
        const slotKeyRaw = fields.slotKey?.[0] ?? null;
        const slotKeyField = slotKeyRaw?.trim() || null;
        const actorIdField = fields.actorId?.[0] ?? null;
        if (!file) return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'file is required');
        if (!actorIdField) {
          return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'actorId is required — refresh and identify yourself before uploading');
        }
        // Verify the actor belongs to THIS token.
        if (!(await actorBelongsToToken(actorIdField, token))) {
          return apiResponse.error(res, ErrorCode.FORBIDDEN, 'actor session does not match this share link');
        }
        // Slot keys must match the table's regex (lowercase alphanumeric + underscore, ≤64).
        if (slotKeyField && !/^[a-z0-9_]{1,64}$/.test(slotKeyField)) {
          return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'slotKey is malformed');
        }

        // Verify the step belongs to THIS ticket before any write — prevents
        // an attacker from injecting maintenance_step_photos rows for a step
        // on a different ticket.
        let stepNumber: number | null = null;
        if (stepIdField) {
          const step = await getStepForTicket(stepIdField, ticketId);
          if (!step) {
            return apiResponse.error(res, ErrorCode.FORBIDDEN, 'step does not belong to this ticket');
          }
          // Block uploads to a step that's already been marked complete (by
          // a prior all-required-slots-filled gate firing or by the legacy
          // single-photo path). Allows QA to treat completed-step evidence
          // as immutable on this public endpoint.
          if (step.is_complete) {
            return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'step is already complete — uploads are locked');
          }
          stepNumber = step.step_number;
        }

        // Slot uploads must reference a slot declared by the step's template.
        // Resolves slot_label / source_mode / is_required from the template so
        // we never trust client-supplied or guessed metadata.
        let resolvedSlot: PhotoSlot | null = null;
        if (slotKeyField) {
          if (!stepIdField || stepNumber === null) {
            return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'slotKey requires stepId');
          }
          const ticketCategory = (ticketData.ticket_category as string | null) ?? null;
          const ticketDiscipline = (ticketData.type as string | null) ?? 'unspecified';
          resolvedSlot = resolveSlotFromTemplate(ticketCategory, ticketDiscipline, stepNumber, slotKeyField);
          if (!resolvedSlot) {
            return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'slotKey is not defined on this step template');
          }
        }

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

        // Insert attachment, stamping the actor who uploaded it (NULL if no
        // actor session was established yet — backwards compat).
        await sql`
          INSERT INTO maintenance_attachments (ticket_id, filename, file_url, file_type, file_size, uploaded_by, description, mime_type, storage_url, is_evidence, uploaded_by_actor_id)
          VALUES (${ticketId}, ${filename}, ${fileUrl}, 'photo', ${file.size}, ${ticketId}, 'Uploaded by field technician', ${file.mimetype ?? 'image/jpeg'}, ${fileUrl}, true, ${actorIdField})
        `;
        await sql`UPDATE maintenance_tickets SET attachments_count = attachments_count + 1, updated_at = NOW() WHERE id = ${ticketId}`;

        // Slot-aware path: when slotKey is provided AND template declares it.
        if (stepIdField && slotKeyField && resolvedSlot) {
          // Slot metadata (label, source_mode, is_required) is authoritative
          // from the template. UPSERT covers both the pre-seeded NULL row
          // (created at step init) and the legacy case where a slot row
          // never got pre-seeded.
          await sql`
            INSERT INTO maintenance_step_photos (step_id, slot_key, slot_label, source_mode, is_required, photo_url, uploaded_by_actor_id, uploaded_at)
            VALUES (${stepIdField}, ${slotKeyField}, ${resolvedSlot.label}, ${resolvedSlot.source_mode}, ${resolvedSlot.is_required}, ${fileUrl}, ${actorIdField}, NOW())
            ON CONFLICT (step_id, slot_key)
            DO UPDATE SET photo_url = EXCLUDED.photo_url,
                          slot_label = EXCLUDED.slot_label,
                          source_mode = EXCLUDED.source_mode,
                          is_required = EXCLUDED.is_required,
                          uploaded_by_actor_id = EXCLUDED.uploaded_by_actor_id,
                          uploaded_at = NOW(),
                          updated_at = NOW()
          `;
          // Completion gate (atomic): a slot-aware step is complete only
          // when every is_required slot row has a non-null photo_url AND at
          // least one such slot exists. We fold the gate check into a single
          // conditional UPDATE so concurrent uploads can't both miss the
          // gate. Postgres takes a row lock on the target step and
          // re-evaluates the WHERE clause after lock acquisition — only the
          // first concurrent UPDATE that sees the row not-yet-complete fires;
          // subsequent ones match zero rows. Optional slots (is_required=false)
          // are deliberately excluded from the gate.
          await sql`
            UPDATE maintenance_verification_steps mvs
            SET is_complete = true,
                completed_at = NOW(),
                completed_by_actor_id = ${actorIdField},
                photo_verified = true,
                updated_at = NOW()
            WHERE mvs.id = ${stepIdField}
              AND mvs.ticket_id = ${ticketId}
              AND mvs.is_complete = false
              AND EXISTS (
                SELECT 1 FROM maintenance_step_photos
                WHERE step_id = ${stepIdField} AND is_required = true
              )
              AND NOT EXISTS (
                SELECT 1 FROM maintenance_step_photos
                WHERE step_id = ${stepIdField} AND is_required = true AND photo_url IS NULL
              )
          `;
        } else if (stepIdField) {
          // Legacy single-photo path — unchanged from PR2.
          await sql`UPDATE maintenance_verification_steps SET photo_url = ${fileUrl}, photo_verified = true, is_complete = true, completed_at = NOW(), completed_by_actor_id = ${actorIdField} WHERE id = ${stepIdField} AND ticket_id = ${ticketId}`;
        }

        fs.unlinkSync(file.filepath);
        log.info('Shared ticket: photo uploaded', { ticketId, filename, stepId: stepIdField, slotKey: slotKeyField, actorId: actorIdField });
        return apiResponse.success(res, { uploaded: true, url: fileUrl, slotKey: slotKeyField });
      } catch (err) {
        log.error('Shared ticket: photo upload failed', { ticketId, error: err instanceof Error ? err.message : 'Unknown' });
        return apiResponse.internalError(res, err, 'Photo upload failed');
      }
    }

    // Parse JSON body manually (bodyParser disabled for multipart support).
    // Hard byte cap protects this public endpoint from OOM payloads.
    const parsed = await readJsonBody(req);
    if (parsed === null) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Invalid or oversized JSON body');
    }
    const body = parsed;
    const { action, stepId, notes, actorId, name, phone, company, browserFingerprint } = body as {
      action: 'start_work' | 'submit_for_qa' | 'complete_step' | 'register_actor';
      stepId?: string;
      notes?: string;
      actorId?: string;
      // register_actor fields
      name?: string;
      phone?: string;
      company?: string;
      browserFingerprint?: string;
    };

    if (!action) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'action is required');
    }

    try {
      if (action === 'register_actor') {
        // Rate-limit per (token + IP) so a leaked link can't be used to spam
        // unbounded actor rows. 10 registrations / minute / source — plenty
        // for a real technician on a flaky connection, well under attack rate.
        const rlKey = `register_actor:${token.substring(0, 16)}:${clientIp(req)}`;
        const rl = rateLimiter.check(rlKey, 10, 60 * 1000);
        if (!rl.success) {
          return apiResponse.error(res, ErrorCode.RATE_LIMIT, 'Too many registration attempts — try again later');
        }

        const trimmedName = (name ?? '').trim();
        const trimmedPhone = (phone ?? '').trim();
        const trimmedCompany = company?.trim() ?? '';
        const fingerprint = (browserFingerprint ?? '').trim();

        if (!trimmedName) return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'name is required');
        if (!trimmedPhone) return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'phone is required');
        if (!fingerprint) return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'browserFingerprint is required');

        if (trimmedName.length > MAX_NAME_LEN) return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'name is too long');
        if (trimmedPhone.length > MAX_PHONE_LEN) return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'phone is too long');
        if (trimmedCompany.length > MAX_COMPANY_LEN) return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'company is too long');
        if (fingerprint.length > MAX_FINGERPRINT_LEN) return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'browserFingerprint is too long');

        const tokenHash = hashToken(token);
        const companyValue = trimmedCompany || null;

        // UPSERT semantics: returning device keeps its actor_id and updates
        // last_seen_at. Only overwrite name/phone/company when they actually
        // changed, and log when they do — that's a likely impersonation /
        // hand-off event worth flagging.
        const rows = await sql`
          INSERT INTO share_session_actors (token_hash, browser_fingerprint, name, phone, company)
          VALUES (${tokenHash}, ${fingerprint}, ${trimmedName}, ${trimmedPhone}, ${companyValue})
          ON CONFLICT (token_hash, browser_fingerprint)
          DO UPDATE SET
            name = EXCLUDED.name,
            phone = EXCLUDED.phone,
            company = EXCLUDED.company,
            last_seen_at = NOW()
          RETURNING id, name, phone, company,
            (xmax::text::int > 0) AS was_update
        ` as Array<{ id: string; name: string; phone: string; company: string | null; was_update: boolean }>;

        const actor = rows[0];
        if (!actor) return apiResponse.internalError(res, new Error('Failed to register actor'), 'Could not register your identity — please try again');

        if (actor.was_update) {
          log.info('Shared ticket: actor session refreshed (possible identity change)', {
            ticketId,
            actorId: actor.id,
            tokenPrefix: token.substring(0, 8),
          });
        } else {
          log.info('Shared ticket: actor registered', {
            ticketId,
            actorId: actor.id,
            tokenPrefix: token.substring(0, 8),
          });
        }

        return apiResponse.success(res, {
          actor: { id: actor.id, name: actor.name, phone: actor.phone, company: actor.company },
        });
      }

      if (action === 'start_work') {
        if (status !== 'assigned') {
          return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Ticket must be in Assigned status to start work');
        }
        await sql`UPDATE maintenance_tickets SET status = 'in_progress', updated_at = NOW() WHERE id = ${ticketId}`;
        // Mirror status on linked snag row (civils tickets). No-op for other discipline types.
        await sql`UPDATE snags SET status = 'in_progress', updated_at = NOW() WHERE noc_ticket_id = ${ticketId}`;
        log.info('Shared ticket: start work', { ticketId, actorId: actorId ?? null, token: token.substring(0, 8) });
        return apiResponse.success(res, { newStatus: 'in_progress' });
      }

      if (action === 'submit_for_qa') {
        if (status !== 'in_progress') {
          return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Ticket must be In Progress to submit for QA');
        }
        await sql`UPDATE maintenance_tickets SET status = 'pending_qa', updated_at = NOW() WHERE id = ${ticketId}`;
        // Mirror status on linked snag row (civils tickets). No-op for other discipline types.
        await sql`UPDATE snags SET status = 'pending_qa', updated_at = NOW(), fixed_at = NOW() WHERE noc_ticket_id = ${ticketId}`;
        log.info('Shared ticket: submitted for QA', { ticketId, token: token.substring(0, 8) });
        return apiResponse.success(res, { newStatus: 'pending_qa' });
      }

      if (action === 'complete_step') {
        if (status !== 'in_progress') {
          return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Ticket must be In Progress to complete steps');
        }
        if (!stepId) {
          return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'stepId is required');
        }
        if (!actorId) {
          return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'actorId is required — refresh and identify yourself before completing steps');
        }
        // Verify the actor belongs to THIS token (prevents cross-token actor reuse).
        const actorOwnsToken = await actorBelongsToToken(actorId, token);
        if (!actorOwnsToken) {
          return apiResponse.error(res, ErrorCode.FORBIDDEN, 'actor session does not match this share link');
        }
        await sql`
          UPDATE maintenance_verification_steps
          SET is_complete = true,
              completed_at = NOW(),
              notes = COALESCE(${notes ?? null}, notes),
              completed_by_actor_id = ${actorId}
          WHERE id = ${stepId} AND ticket_id = ${ticketId}
        `;
        log.info('Shared ticket: step completed', { ticketId, stepId, actorId, tokenPrefix: token.substring(0, 8) });
        return apiResponse.success(res, { completed: true });
      }

      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Invalid action');
    } catch (error) {
      log.error('Shared ticket action error', { error, ticketId, action });
      return apiResponse.internalError(res, error, 'Action failed — please try again');
    }
  }

  return apiResponse.methodNotAllowed(res, req.method ?? 'Unknown', ['GET', 'POST']);
}

// No withAuth — this is a public endpoint
export default handler;
