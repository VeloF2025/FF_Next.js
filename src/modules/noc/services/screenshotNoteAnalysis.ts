/**
 * Pure (network-free) helpers for the 1map screenshot → note feature:
 * prompt building, VLM-response parsing, and note-body composition.
 */
import { stripThinkTags } from '@/lib/vlm';

export interface TicketCrossRef {
  dr_number: string | null;
  pole_number: string | null;
  pon_number: string | null;
  ont_serial: string | null;
}

export interface InstallScreenshotAnalysis {
  is_1map_screenshot: boolean;
  dr_number: string | null;
  status: string | null;
  status_interpretation: string | null;
  photos: { total: number; uploaded: number; missing: string[] } | null;
  serial: string | null;
  pole: string | null;
  pon: string | null;
  site: string | null;
  mismatches: string[];
  summary: string;
  confidence: 'high' | 'medium' | 'low';
}

export function buildInstallScreenshotPrompt(ctx: TicketCrossRef): string {
  const known = [
    ctx.dr_number ? `- DR / drop number: ${ctx.dr_number}` : null,
    ctx.pole_number ? `- Pole number: ${ctx.pole_number}` : null,
    ctx.pon_number ? `- PON: ${ctx.pon_number}` : null,
    ctx.ont_serial ? `- ONT serial: ${ctx.ont_serial}` : null,
  ].filter(Boolean).join('\n') || '- (no cross-reference data on this ticket)';

  return `You are analysing one or more screenshots from "1map" — the GIS system that tracks fibre "fibertime Installation" records. A technician wants to know the install state of a drop.

This ticket's known FibreFlow details — cross-check the screenshot against these:
${known}

Return ONLY a JSON object (no markdown fences, no commentary) with EXACTLY this shape:
{
  "is_1map_screenshot": true,
  "dr_number": "the DR/drop number visible in the screenshot, or null",
  "status": "the value of the Status field, verbatim, or null",
  "status_interpretation": "plain-English meaning of that status, or null",
  "photos": { "total": 0, "uploaded": 0, "missing": ["column headers that show NO IMAGE"] },
  "serial": "ONT barcode / serial visible, or null",
  "pole": "pole number visible, or null",
  "pon": "PON visible, or null",
  "site": "site code visible, or null",
  "mismatches": ["differences between the screenshot and the ticket details above"],
  "summary": "1-3 plain sentences a technician would write",
  "confidence": "high"
}

Rules:
- A photo cell reading "NO IMAGE" (or blank) is NOT uploaded; a visible thumbnail IS uploaded.
- "photos.total" = number of photo columns shown; "photos.uploaded" = how many show an image; "photos.missing" = the headers that show NO IMAGE.
- Read the "Status" field verbatim. Example: "Pole Permission: Approved" means the drop is still at the pole-permission stage and the home installation has NOT been recorded.
- Put any disagreement with the ticket details (e.g. a different DR number, or a status earlier than a completed home installation) into "mismatches".
- "summary" example: "No photos uploaded; drop still at Pole Permission, home installation not yet recorded."
- "confidence" is one of "high", "medium", "low".
- If the image is NOT a 1map installation screenshot, set "is_1map_screenshot": false, set photos to null, and just describe what you see in "summary".`;
}

export function parseInstallScreenshotResponse(raw: string): InstallScreenshotAnalysis {
  const cleaned = stripThinkTags(raw)
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('VLM response contained no JSON object');

  const obj = JSON.parse(match[0]) as Record<string, unknown>;

  const confRaw = String(obj.confidence ?? 'low').toLowerCase();
  const confidence = (['high', 'medium', 'low'].includes(confRaw) ? confRaw : 'low') as 'high' | 'medium' | 'low';

  const p = obj.photos as { total?: unknown; uploaded?: unknown; missing?: unknown } | null | undefined;
  const photos = p && typeof p === 'object'
    ? {
        total: Number(p.total ?? 0) || 0,
        uploaded: Number(p.uploaded ?? 0) || 0,
        missing: Array.isArray(p.missing) ? p.missing.map(String) : [],
      }
    : null;

  const str = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));

  return {
    is_1map_screenshot: obj.is_1map_screenshot === true,
    dr_number: str(obj.dr_number),
    status: str(obj.status),
    status_interpretation: str(obj.status_interpretation),
    photos,
    serial: str(obj.serial),
    pole: str(obj.pole),
    pon: str(obj.pon),
    site: str(obj.site),
    mismatches: Array.isArray(obj.mismatches) ? obj.mismatches.map(String) : [],
    summary: str(obj.summary) ?? 'Screenshot analysed; no summary returned.',
    confidence,
  };
}

export function composeNoteBody(a: InstallScreenshotAnalysis, ctx: TicketCrossRef): string {
  const lines: string[] = ['🤖 AI screenshot analysis', '', a.summary.trim()];

  if (a.is_1map_screenshot) {
    const checks: string[] = [];
    if (a.photos) {
      let line = `Photos: ${a.photos.uploaded}/${a.photos.total} uploaded`;
      if (a.photos.missing.length > 0) line += ` · missing: ${a.photos.missing.join(', ')}`;
      checks.push(line);
    }
    if (a.status) {
      checks.push(`Status: ${a.status}${a.status_interpretation ? ` — ${a.status_interpretation}` : ''}`);
    }
    if (a.dr_number) {
      const matches = ctx.dr_number && a.dr_number.toUpperCase() === ctx.dr_number.toUpperCase();
      const verdict = matches
        ? '✓ matches ticket'
        : ctx.dr_number ? `✗ ticket DR is ${ctx.dr_number}` : '(no ticket DR to compare)';
      checks.push(`DR: ${a.dr_number} ${verdict}`);
    }
    if (a.serial) checks.push(`Serial: ${a.serial}`);

    if (checks.length > 0) {
      lines.push('', checks.join('\n'));
    }
    for (const m of a.mismatches) lines.push(`⚠ ${m}`);
  }

  lines.push('', `(confidence: ${a.confidence})`);
  return lines.join('\n');
}
