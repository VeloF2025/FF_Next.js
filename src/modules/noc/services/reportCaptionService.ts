/**
 * reportCaptionService — VLM-generated photo captions for the NOC ticket
 * report PDF.
 *
 * Each attachment gets at most one caption, cached on the attachment row
 * (`ai_caption`, `ai_caption_context`, `ai_caption_confidence`). Regenerating
 * the report is near-instant after the first run.
 *
 * Context (`before` | `after` | `general`) comes from the verification step
 * name — `Assess Snag` / `Before` photos describe the defect, `Perform
 * Rectification` / `After` photos describe what was done. General photos
 * attached at ticket level get a neutral description.
 */

import { query, queryOne } from '../utils/db';
import { createLogger } from '@/lib/logger';
import { VLM_CHAT_ENDPOINT, VLM_MODEL, VLM_TIMEOUT_DEFAULT } from '@/lib/vlm';

const logger = createLogger('noc:report-captions');

export type CaptionContext = 'before' | 'after' | 'general';

export interface CaptionResult {
  attachmentId: string;
  caption: string;
  context: CaptionContext;
  confidence: 'high' | 'medium' | 'low';
  cached: boolean;
}

export interface TicketCaptionContext {
  /** Ticket title — one-liner on what the problem was. */
  title: string;
  /** Ticket description (reporter narrative) — optional longer context. */
  description?: string | null;
  /** Discipline (civils / optical / activations / …) — sets domain vocabulary. */
  ticketType?: string | null;
  /**
   * Ground-truth resolution notes written by a human — takes precedence
   * over photo inference and over the title (which may be a short, imprecise
   * summary of the original report). If any is_resolution=true note exists,
   * the VLM is instructed to prefer it over its own visual interpretation.
   */
  resolutionNotes?: Array<{ content: string; author: string | null }>;
  /** Any other non-resolution notes attached to the ticket, oldest first. */
  otherNotes?: Array<{ content: string; author: string | null }>;
}

function renderNotesSection(ticket: TicketCaptionContext): string {
  const resolution = (ticket.resolutionNotes ?? []).filter((n) => n.content?.trim());
  const other = (ticket.otherNotes ?? []).filter((n) => n.content?.trim());
  if (resolution.length === 0 && other.length === 0) return '';

  const lines: string[] = ['', 'GROUND-TRUTH NOTES (written by humans — trust these over your own visual inference):'];
  for (const n of resolution) {
    lines.push(`• [RESOLUTION] ${n.content}${n.author ? ` — ${n.author}` : ''}`);
  }
  for (const n of other) {
    lines.push(`• ${n.content}${n.author ? ` — ${n.author}` : ''}`);
  }
  return lines.join('\n');
}

/**
 * Build a caption prompt for a single photo. The report is retrospective:
 * the work is already complete. Hence strict past-tense, and framing in
 * terms of the issue-or-rectification rather than the photo's contents.
 */
function buildPrompt(
  context: CaptionContext,
  stepName: string | null | undefined,
  ticket: TicketCaptionContext
): string {
  const ticketSummary = [
    `Ticket title: "${ticket.title}"`,
    ticket.ticketType ? `Discipline: ${ticket.ticketType}` : null,
    ticket.description ? `Field-reporter description: "${ticket.description}"` : null,
    stepName ? `Verification step this photo is attached to: "${stepName}"` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const common = [
    'You are writing caption copy for a formal rectification / resolution report on a fibre-network site visit.',
    'The report is RETROSPECTIVE — the work is already complete. Write in the past tense only ("The pole was repositioned…", "A new drop cable was installed…"). Do NOT use present tense ("The worker is digging…") and never refer to the image as a photo/image ("A photo of…", "The image shows…").',
    'Focus on the network-infrastructure facts that matter to QA: what was wrong versus the installation standard, or what was done to bring the site into compliance. Do not describe people, clothing, tools, or scenery unless directly relevant to the fault or the fix.',
    'If anything is uncertain, lower the confidence rather than guessing.',
  ].join(' ');

  const perContext: Record<CaptionContext, string> = {
    before: [
      'This entry documents the ORIGINAL ISSUE the ticket was raised for. In 1–2 past-tense sentences, describe what the defect was and why it did not meet installation standards.',
      'Start with "The initial issue was…" or "The installation was found to be…" or similar retrospective phrasing.',
    ].join(' '),
    after: [
      'This entry documents ONE SPECIFIC MOMENT of the RECTIFICATION workflow. In 1–2 past-tense sentences, describe WHAT WAS BEING DONE IN THIS SPECIFIC SHOT within the broader rectification — the digging, the pole-planting, the cable-transfer, the final verification, or whichever stage it is.',
      'Do NOT restate the entire resolution from the notes — the step-level summary already covers the overall rectification. This caption should differentiate THIS photo from the others. Look at the visual detail (foundation hole, vertical level, cable clamp, final clearance check) to decide which stage the photo captures.',
      'Start with "At this stage…" or "Here the…" (using past-tense verbs) or similar phrasing that situates the photo within the sequence.',
    ].join(' '),
    general: [
      'This entry documents supporting evidence for the rectification. In 1–2 past-tense sentences, describe the relevant network-infrastructure fact captured at site.',
      'Start with "As supporting evidence…" or "The site condition recorded was…" or similar retrospective phrasing.',
    ].join(' '),
  };

  return [
    common,
    '',
    'TICKET CONTEXT (use this to ground the caption in the actual issue):',
    ticketSummary,
    renderNotesSection(ticket),
    '',
    'YOUR TASK FOR THIS PHOTO:',
    perContext[context],
    '',
    'Respond with JSON only, on a single line:',
    '{"description": "<caption in past tense>", "confidence": "high|medium|low"}',
  ]
    .filter((line) => line !== '')
    .concat('')
    .join('\n');
}

/** Step names whose photos describe the original issue. */
const BEFORE_STEP_PATTERNS = [/assess/i, /before/i, /initial/i];
/** Step names whose photos describe the resolution. */
const AFTER_STEP_PATTERNS = [
  /rectif/i,
  /after/i,
  /proof/i,
  /fix/i,
  /complete/i,
  /quality check/i,
];

/**
 * Decide which prompt to use for a photo based on the verification step it's
 * attached to. Falls back to 'general' for ticket-level attachments.
 */
export function resolveCaptionContext(stepName: string | null | undefined): CaptionContext {
  if (!stepName) return 'general';
  if (AFTER_STEP_PATTERNS.some((p) => p.test(stepName))) return 'after';
  if (BEFORE_STEP_PATTERNS.some((p) => p.test(stepName))) return 'before';
  return 'general';
}

interface AttachmentRow {
  id: string;
  storage_url: string | null;
  file_url: string | null;
  mime_type: string | null;
  ai_caption: string | null;
  ai_caption_context: string | null;
  ai_caption_confidence: string | null;
  verification_step_id: string | null;
  step_name: string | null;
}

/**
 * Storage URLs can be absolute (https://…/storage/…) or relative
 * (/storage/maintenance/…). Node fetch rejects the relative form so we
 * prepend an app-scoped base that can serve the /storage/* proxy.
 */
export function resolveStorageUrl(url: string): string {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url;
  const base =
    process.env.FF_APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXTAUTH_URL ||
    'https://dev.fibreflow.app';
  return `${base.replace(/\/$/, '')}${url.startsWith('/') ? url : '/' + url}`;
}

async function fetchImageAsBase64(url: string): Promise<string | null> {
  const resolved = resolveStorageUrl(url);
  try {
    const res = await fetch(resolved);
    if (!res.ok) {
      logger.warn('Image fetch returned non-2xx', { url: resolved, status: res.status });
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.toString('base64');
  } catch (err) {
    logger.warn('Failed to fetch image for captioning', {
      url: resolved,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

interface VlmCaptionResponse {
  description?: string;
  confidence?: string;
}

interface VlmImage {
  base64: string;
  mimeType: string;
}

/**
 * Low-level VLM chat call that accepts one or more images. Returns the raw
 * string content (typically JSON) the caller is expected to parse. Timeout
 * scales with the number of images so multi-image step narratives don't get
 * aborted prematurely.
 */
async function callVlmRaw(
  prompt: string,
  images: VlmImage[],
  opts: { maxTokens?: number; temperature?: number; timeoutMs?: number } = {}
): Promise<string | null> {
  if (images.length === 0) return null;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? VLM_TIMEOUT_DEFAULT + images.length * 15_000
  );

  try {
    const content: Array<Record<string, unknown>> = [{ type: 'text', text: prompt }];
    for (const img of images) {
      content.push({
        type: 'image_url',
        image_url: {
          url: `data:${img.mimeType || 'image/jpeg'};base64,${img.base64}`,
        },
      });
    }

    const res = await fetch(VLM_CHAT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: VLM_MODEL,
        messages: [{ role: 'user', content }],
        max_tokens: opts.maxTokens ?? 250,
        temperature: opts.temperature ?? 0.2,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`VLM ${res.status}: ${await res.text().catch(() => '')}`);
    }

    const body = await res.json();
    return body.choices?.[0]?.message?.content ?? null;
  } catch (err) {
    logger.warn('VLM call failed', {
      images: images.length,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function parseJsonLoose<T>(text: string | null): T | null {
  if (!text) return null;
  const match =
    text.match(/```json\n([\s\S]*?)\n```/) ||
    text.match(/```\n([\s\S]*?)\n```/) ||
    [null, text];
  try {
    return JSON.parse(match[1] || text) as T;
  } catch {
    return null;
  }
}

async function callVlmForCaption(
  base64: string,
  prompt: string,
  mimeType: string
): Promise<VlmCaptionResponse | null> {
  const raw = await callVlmRaw(prompt, [{ base64, mimeType }], { maxTokens: 250 });
  return parseJsonLoose<VlmCaptionResponse>(raw);
}

export interface GenerateCaptionsOptions {
  /** Ticket-level context woven into every prompt so captions stay on-narrative. */
  ticket: TicketCaptionContext;
  /** When true, clear any cached caption on this ticket and re-run the VLM. */
  regenerate?: boolean;
}

/**
 * Generate captions for every attachment on a ticket that doesn't already
 * have one cached. Returns a map keyed by attachment id. Photos the VLM can't
 * caption (fetch failed, malformed response) get a short placeholder so the
 * report still renders.
 */
export async function generateCaptionsForTicket(
  ticketId: string,
  options: GenerateCaptionsOptions
): Promise<Map<string, CaptionResult>> {
  if (options.regenerate) {
    await query(
      `UPDATE maintenance_attachments
         SET ai_caption = NULL,
             ai_caption_context = NULL,
             ai_caption_confidence = NULL,
             ai_caption_generated_at = NULL
       WHERE ticket_id = $1 AND is_evidence = true`,
      [ticketId]
    );
  }

  const attachments = await query<AttachmentRow>(
    `
    SELECT a.id,
           a.storage_url,
           a.file_url,
           a.mime_type,
           a.ai_caption,
           a.ai_caption_context,
           a.ai_caption_confidence,
           a.verification_step_id,
           s.step_name
    FROM maintenance_attachments a
    LEFT JOIN maintenance_verification_steps s ON s.id = a.verification_step_id
    WHERE a.ticket_id = $1
      AND a.is_evidence = true
      AND COALESCE(a.mime_type, '') LIKE 'image/%'
    ORDER BY a.uploaded_at ASC
    `,
    [ticketId]
  );

  const results = new Map<string, CaptionResult>();

  // Cached captions — reuse as-is.
  const toGenerate: AttachmentRow[] = [];
  for (const a of attachments) {
    if (a.ai_caption && a.ai_caption_context) {
      results.set(a.id, {
        attachmentId: a.id,
        caption: a.ai_caption,
        context: a.ai_caption_context as CaptionContext,
        confidence: (a.ai_caption_confidence as CaptionResult['confidence']) || 'medium',
        cached: true,
      });
    } else {
      toGenerate.push(a);
    }
  }

  if (toGenerate.length === 0) return results;

  logger.info('Generating VLM captions', {
    ticketId,
    needed: toGenerate.length,
    cached: results.size,
  });

  // VLM calls in parallel with a concurrency cap so we don't flood the server.
  const CONCURRENCY = 3;
  for (let i = 0; i < toGenerate.length; i += CONCURRENCY) {
    const batch = toGenerate.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (att) => {
        const context = resolveCaptionContext(att.step_name);
        const url = att.storage_url || att.file_url;
        if (!url) {
          results.set(att.id, {
            attachmentId: att.id,
            caption: 'Photo unavailable for AI description.',
            context,
            confidence: 'low',
            cached: false,
          });
          return;
        }

        const base64 = await fetchImageAsBase64(url);
        if (!base64) {
          results.set(att.id, {
            attachmentId: att.id,
            caption: 'Photo could not be loaded for AI description.',
            context,
            confidence: 'low',
            cached: false,
          });
          return;
        }

        const prompt = buildPrompt(context, att.step_name, options.ticket);
        const vlm = await callVlmForCaption(base64, prompt, att.mime_type || 'image/jpeg');
        const caption = (vlm?.description || '').trim();
        const confidence = normaliseConfidence(vlm?.confidence);

        const finalCaption =
          caption || 'AI description unavailable — reviewer should describe manually.';

        results.set(att.id, {
          attachmentId: att.id,
          caption: finalCaption,
          context,
          confidence,
          cached: false,
        });

        // Persist caption so the next report generation skips the VLM call.
        if (caption) {
          try {
            await queryOne(
              `UPDATE maintenance_attachments
                 SET ai_caption = $1,
                     ai_caption_context = $2,
                     ai_caption_confidence = $3,
                     ai_caption_generated_at = NOW()
               WHERE id = $4
               RETURNING id`,
              [finalCaption, context, confidence, att.id]
            );
          } catch (err) {
            logger.warn('Failed to persist caption', {
              attachmentId: att.id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      })
    );
  }

  return results;
}

function normaliseConfidence(value: string | undefined): 'high' | 'medium' | 'low' {
  const v = (value || '').toLowerCase();
  if (v === 'high' || v === 'medium' || v === 'low') return v;
  return 'medium';
}

// ─── Step-level narrative ─────────────────────────────────────────────────────
// A single VLM call per step that sees all photos from that step in
// chronological order, so the model can describe the workflow as a sequence
// (e.g. "a new pole was planted, cable strung, and drops re-terminated") rather
// than describing each photo in isolation. Cached on
// maintenance_verification_steps.ai_narrative.

export interface StepNarrativeResult {
  stepId: string;
  narrative: string;
  confidence: 'high' | 'medium' | 'low';
  cached: boolean;
}

export interface GenerateStepNarrativesOptions {
  ticket: TicketCaptionContext;
  /** Clear cached narratives and re-run the VLM. */
  regenerate?: boolean;
}

interface StepPhotoForNarrative {
  stepId: string;
  stepName: string;
  stepDescription: string | null;
  cachedNarrative: string | null;
  photos: Array<{
    storageUrl: string | null;
    fileUrl: string | null;
    mimeType: string | null;
    uploadedAt: string;
  }>;
}

/**
 * Build one narrative per verification step for a ticket. Steps with 0-1
 * photos are skipped (per-photo caption is sufficient). Steps with 2+ photos
 * get one multi-image VLM call.
 */
export async function generateStepNarrativesForTicket(
  ticketId: string,
  options: GenerateStepNarrativesOptions
): Promise<Map<string, StepNarrativeResult>> {
  const results = new Map<string, StepNarrativeResult>();

  if (options.regenerate) {
    await query(
      `UPDATE maintenance_verification_steps
         SET ai_narrative = NULL,
             ai_narrative_generated_at = NULL
       WHERE ticket_id = $1`,
      [ticketId]
    );
  }

  // Fetch per-step photo lists in chronological order.
  const rows = await query<{
    step_id: string;
    step_name: string;
    step_description: string | null;
    ai_narrative: string | null;
    attachment_id: string | null;
    storage_url: string | null;
    file_url: string | null;
    mime_type: string | null;
    uploaded_at: string | null;
  }>(
    `
    SELECT s.id AS step_id,
           s.step_name,
           s.step_description,
           s.ai_narrative,
           a.id AS attachment_id,
           a.storage_url,
           a.file_url,
           a.mime_type,
           a.uploaded_at
    FROM maintenance_verification_steps s
    LEFT JOIN maintenance_attachments a
      ON a.verification_step_id = s.id
     AND a.is_evidence = true
     AND COALESCE(a.mime_type, '') LIKE 'image/%'
    WHERE s.ticket_id = $1
    ORDER BY s.step_number ASC, a.uploaded_at ASC NULLS LAST
    `,
    [ticketId]
  );

  // Group into one entry per step.
  const byStep = new Map<string, StepPhotoForNarrative>();
  for (const row of rows) {
    let step = byStep.get(row.step_id);
    if (!step) {
      step = {
        stepId: row.step_id,
        stepName: row.step_name,
        stepDescription: row.step_description,
        cachedNarrative: row.ai_narrative,
        photos: [],
      };
      byStep.set(row.step_id, step);
    }
    if (row.attachment_id) {
      step.photos.push({
        storageUrl: row.storage_url,
        fileUrl: row.file_url,
        mimeType: row.mime_type,
        uploadedAt: row.uploaded_at || '',
      });
    }
  }

  for (const step of byStep.values()) {
    // Reuse cached narrative unless a regenerate was requested (already
    // cleared) or the step now has a different photo count.
    if (step.cachedNarrative) {
      results.set(step.stepId, {
        stepId: step.stepId,
        narrative: step.cachedNarrative,
        confidence: 'medium',
        cached: true,
      });
      continue;
    }
    // Per-photo captions cover single-photo steps; skip the extra VLM call.
    if (step.photos.length < 2) continue;

    const images: VlmImage[] = [];
    for (const p of step.photos) {
      const base64 = await fetchImageAsBase64(p.storageUrl || p.fileUrl || '');
      if (base64) images.push({ base64, mimeType: p.mimeType || 'image/jpeg' });
    }
    if (images.length < 2) continue;

    const prompt = buildStepNarrativePrompt(
      step.stepName,
      step.stepDescription,
      images.length,
      options.ticket
    );
    const raw = await callVlmRaw(prompt, images, {
      maxTokens: 300,
      temperature: 0.25,
      timeoutMs: VLM_TIMEOUT_DEFAULT + images.length * 15_000,
    });
    const parsed = parseJsonLoose<{ narrative?: string; confidence?: string }>(raw);
    const narrative = (parsed?.narrative || '').trim();
    if (!narrative) continue;

    const confidence = normaliseConfidence(parsed?.confidence);
    results.set(step.stepId, {
      stepId: step.stepId,
      narrative,
      confidence,
      cached: false,
    });

    try {
      await queryOne(
        `UPDATE maintenance_verification_steps
           SET ai_narrative = $1,
               ai_narrative_generated_at = NOW()
         WHERE id = $2
         RETURNING id`,
        [narrative, step.stepId]
      );
    } catch (err) {
      logger.warn('Failed to persist step narrative', {
        stepId: step.stepId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}

function buildStepNarrativePrompt(
  stepName: string,
  stepDescription: string | null,
  photoCount: number,
  ticket: TicketCaptionContext
): string {
  const notesBlock = renderNotesSection(ticket);
  const lines = [
    'You are summarising what a technician DID during one step of a fibre-network rectification visit.',
    `You will receive ${photoCount} photos from this step, shown to you in the order they were taken. Read them as a SEQUENCE — each photo is a later moment in the same workflow.`,
    'Write 2–3 plain past-tense sentences describing the overall corrective action that the sequence documents. Focus on the work: what was built, replaced, dug, planted, strung, connected, or secured. Do not describe individual photos, clothing, tools, or scenery — describe the workflow as one paragraph.',
    'Never use the words "photo" or "image". Never write in present tense. If the photos do not actually show a coherent workflow, say so in the narrative and lower the confidence.',
    'IF GROUND-TRUTH NOTES ARE PROVIDED BELOW, THEY OVERRIDE YOUR VISUAL INTERPRETATION. The ticket title is a short summary that may be imprecise — always prefer the notes when they conflict.',
    '',
    'TICKET CONTEXT:',
    `Title: "${ticket.title}"`,
    ticket.ticketType ? `Discipline: ${ticket.ticketType}` : null,
    ticket.description ? `Field-reporter description: "${ticket.description}"` : null,
    `Verification step: "${stepName}"`,
    stepDescription ? `Step definition: "${stepDescription}"` : null,
    notesBlock || null,
    '',
    'Respond with JSON only, on a single line:',
    '{"narrative": "<2-3 past-tense sentences describing the workflow>", "confidence": "high|medium|low"}',
  ].filter(Boolean);
  return lines.join('\n');
}
