/**
 * Ticket Report PDF generator — professional A4 report rendered with jsPDF.
 *
 * Consumes the shape built by `ticketReportService.buildTicketReportData`
 * and produces a Buffer suitable for streaming from an API route or
 * offering as a browser download.
 *
 * Layout:
 *   Page 1 (cover):
 *     • VF logo, company header, report title
 *     • Ticket metadata card (UID, status, priority, type, project, DR, zone)
 *     • Narrative description
 *   Per-step sections (one after another):
 *     • Step header with completion badge
 *     • Photos in a 2-column grid; each photo has an AI-generated caption
 *       (issue description for "before", resolution description for "after")
 *     • Free-text step notes when present
 *   Trailing sections:
 *     • General ticket-level photos (if any)
 *     • Note log (chronological)
 *     • Activity timeline (creation → status changes → resolution)
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createLogger } from '@/lib/logger';
import type { TicketReportData, ReportPhoto } from '../services/ticketReportService';
import { resolveStorageUrl } from '../services/reportCaptionService';

const logger = createLogger('noc:report-pdf');

// ─── Brand palette (matches snagCloseoutPdf) ──────────────────────────────────
const B = {
  navy: [30, 40, 70] as [number, number, number],
  accent: [91, 141, 239] as [number, number, number],
  dark: [30, 30, 30] as [number, number, number],
  mid: [80, 80, 80] as [number, number, number],
  light: [120, 120, 120] as [number, number, number],
  line: [200, 205, 215] as [number, number, number],
  bgLight: [245, 247, 250] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
  red: [220, 60, 60] as [number, number, number],
  orange: [220, 140, 40] as [number, number, number],
  green: [40, 160, 80] as [number, number, number],
  blue: [60, 120, 220] as [number, number, number],
};

const STATUS_COLORS: Record<string, [number, number, number]> = {
  open: B.red,
  assigned: B.orange,
  in_progress: B.orange,
  pending_qa: B.accent,
  resolved: B.blue,
  verified: B.green,
  closed: B.green,
  cancelled: B.light,
};

const PRIORITY_COLORS: Record<string, [number, number, number]> = {
  critical: B.red,
  urgent: B.red,
  high: B.orange,
  normal: B.mid,
  low: B.light,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-ZA', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-ZA', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Africa/Johannesburg',
    });
  } catch {
    return iso;
  }
}

function titleCase(value: string | null | undefined): string {
  if (!value) return '—';
  return value
    .split(/[_\s-]+/)
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1).toLowerCase() : ''))
    .join(' ');
}

async function loadLogoBase64(): Promise<string | null> {
  try {
    const p = path.join(process.cwd(), 'public/assets/vf/velocity-fibre-logo.jpg');
    const buf = await readFile(p);
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  } catch (err) {
    logger.warn('VF logo not found, skipping header logo', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function loadImageBase64(url: string): Promise<string | null> {
  if (!url) return null;
  const resolved = resolveStorageUrl(url);
  try {
    const res = await fetch(resolved);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const mime = res.headers.get('content-type') || 'image/jpeg';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch (err) {
    logger.warn('Failed to load report image', {
      url: resolved,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function detectImageFormat(dataUri: string): 'JPEG' | 'PNG' | 'WEBP' {
  if (dataUri.startsWith('data:image/png')) return 'PNG';
  if (dataUri.startsWith('data:image/webp')) return 'WEBP';
  return 'JPEG';
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function generateTicketReportPdf(data: TicketReportData): Promise<Buffer> {
  const { jsPDF } = await import('jspdf');

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const PW = doc.internal.pageSize.getWidth(); // 210
  const PH = doc.internal.pageSize.getHeight(); // 297
  const ML = 16;
  const MR = 16;
  const CW = PW - ML - MR;
  let y = 14;
  let pageNum = 1;

  const logoData = await loadLogoBase64();

  // Pre-load all photo base64 in parallel so rendering is fast and deterministic.
  const allPhotos: ReportPhoto[] = [
    ...data.steps.flatMap((s) => s.photos),
    ...data.generalPhotos,
  ];
  const uniqueUrls = Array.from(new Set(allPhotos.map((p) => p.url).filter(Boolean)));
  const photoBatch = await Promise.all(
    uniqueUrls.map(async (url) => [url, await loadImageBase64(url)] as const)
  );
  const photoByUrl = new Map<string, string>();
  for (const [url, b64] of photoBatch) {
    if (b64) photoByUrl.set(url, b64);
  }

  // ─── Footer ────────────────────────────────────────────────────────────────
  const drawFooter = () => {
    const fy = PH - 10;
    doc.setDrawColor(...B.line);
    doc.setLineWidth(0.3);
    doc.line(ML, fy - 2, PW - MR, fy - 2);
    doc.setFontSize(7);
    doc.setTextColor(...B.light);
    doc.setFont('helvetica', 'normal');
    doc.text(
      `FibreFlow Ticket Report — ${data.ticket.ticketUid} — generated ${fmtDate(data.generatedAt)}`,
      ML,
      fy
    );
    doc.text(`Page ${pageNum}`, PW - MR, fy, { align: 'right' });
    doc.text('CONFIDENTIAL', PW / 2, fy, { align: 'center' });
  };

  const newPage = () => {
    drawFooter();
    doc.addPage();
    pageNum++;
    y = 14;
  };

  const ensureSpace = (needed: number) => {
    if (y + needed > PH - 18) newPage();
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // HEADER BAND (runs on every page via drawHeader() — called at top of page)
  // ═══════════════════════════════════════════════════════════════════════════
  const drawHeader = () => {
    if (logoData) {
      doc.addImage(logoData, 'JPEG', ML, 10, 32, 16);
    }
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...B.mid);
    doc.text('Velocity Fibre (Pty) Ltd', PW - MR, 14, { align: 'right' });
    doc.setFontSize(7);
    doc.setTextColor(...B.light);
    doc.text('www.velocityfibre.co.za', PW - MR, 18, { align: 'right' });
    doc.text(`Ticket ${data.ticket.ticketUid}`, PW - MR, 22, { align: 'right' });

    // Accent divider
    doc.setDrawColor(...B.navy);
    doc.setLineWidth(0.8);
    doc.line(ML, 28, PW - MR, 28);
    y = 34;
  };

  drawHeader();

  // ═══════════════════════════════════════════════════════════════════════════
  // COVER — report title + metadata card
  // ═══════════════════════════════════════════════════════════════════════════

  // Title
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...B.navy);
  doc.text('TICKET RESOLUTION REPORT', PW / 2, y + 4, { align: 'center' });
  y += 14;

  doc.setFontSize(13);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...B.dark);
  const titleLines = doc.splitTextToSize(data.ticket.title, CW - 8);
  doc.text(titleLines, PW / 2, y, { align: 'center' });
  y += titleLines.length * 6 + 4;

  // Status + priority chips
  const statusColor = STATUS_COLORS[data.ticket.status.toLowerCase()] ?? B.mid;
  const priorityColor = PRIORITY_COLORS[data.ticket.priority.toLowerCase()] ?? B.mid;
  const chipY = y;
  const drawChip = (
    label: string,
    value: string,
    color: [number, number, number],
    x: number
  ) => {
    const pad = 3;
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    const fullText = `${label}: ${value}`;
    const textWidth = doc.getTextWidth(fullText);
    const w = textWidth + pad * 2;
    doc.setFillColor(...color);
    doc.roundedRect(x, chipY, w, 6, 1, 1, 'F');
    doc.setTextColor(...B.white);
    doc.text(fullText, x + pad, chipY + 4.2);
    return x + w + 3;
  };

  let _chipX = ML;
  _chipX = drawChip('Status', titleCase(data.ticket.status), statusColor, _chipX);
  _chipX = drawChip('Priority', titleCase(data.ticket.priority), priorityColor, _chipX);
  if (data.ticket.slaBreached) {
    _chipX = drawChip('SLA', 'Breached', B.red, _chipX);
  }
  void _chipX;
  y += 12;

  // Metadata card (two-column list). Skip rows with no real value so the
  // card stays tidy on tickets that haven't populated every field yet.
  const allMetaRows: Array<[string, string | null | undefined]> = [
    ['Ticket UID', data.ticket.ticketUid],
    ['Type', data.ticket.type ? titleCase(data.ticket.type) : null],
    ['Category', data.ticket.category ? titleCase(data.ticket.category) : null],
    ['Source', titleCase(data.ticket.source)],
    ['Project', data.ticket.projectName],
    ['DR Number', data.ticket.drNumber],
    [
      'Zone / PON',
      [data.ticket.zone, data.ticket.pon].filter(Boolean).join(' / ') || null,
    ],
    ['Address', data.ticket.address],
    ['Client', data.ticket.clientName],
    ['Client Contact', data.ticket.clientContact],
    [
      'Assigned To',
      data.ticket.assignedUserName ?? data.ticket.assignedTeamName ?? null,
    ],
    ['Created By', data.ticket.createdByName],
    ['Created', fmtDateTime(data.ticket.createdAt)],
    ['Resolved', data.ticket.resolvedAt ? fmtDateTime(data.ticket.resolvedAt) : null],
    ['Closed', data.ticket.closedAt ? fmtDateTime(data.ticket.closedAt) : null],
  ];
  const metaRows = allMetaRows
    .filter(([, v]) => v && String(v).trim())
    .map(([k, v]) => [k, String(v)] as [string, string]);

  doc.setFillColor(...B.bgLight);
  doc.setDrawColor(...B.line);
  doc.setLineWidth(0.3);
  const rowH = 9;
  const cardH = Math.ceil(metaRows.length / 2) * rowH + 6;
  doc.roundedRect(ML, y, CW, cardH, 2, 2, 'FD');

  const colW = CW / 2;
  for (let i = 0; i < metaRows.length; i++) {
    const row = metaRows[i]!;
    const col = i % 2;
    const rowIdx = Math.floor(i / 2);
    const rx = ML + 4 + col * colW;
    const ry = y + 6 + rowIdx * rowH;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...B.light);
    doc.text(row[0].toUpperCase(), rx, ry);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...B.dark);
    const cellTextMaxW = colW - 10;
    const text = doc.splitTextToSize(row[1], cellTextMaxW)[0] || '';
    doc.text(text, rx, ry + 4.5);
  }
  y += cardH + 6;

  // Narrative description
  if (data.ticket.description) {
    ensureSpace(30);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...B.navy);
    doc.text('Description', ML, y);
    y += 5;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...B.dark);
    const descLines = doc.splitTextToSize(data.ticket.description, CW);
    doc.text(descLines, ML, y);
    y += descLines.length * 4.5 + 4;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // VERIFICATION STEPS — one section per step, with photos and AI captions
  // ═══════════════════════════════════════════════════════════════════════════

  if (data.steps.length > 0) {
    ensureSpace(14);
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...B.navy);
    doc.text('Work Performed', ML, y);
    doc.setDrawColor(...B.accent);
    doc.setLineWidth(0.6);
    doc.line(ML, y + 2, ML + 40, y + 2);
    y += 10;
  }

  for (const step of data.steps) {
    ensureSpace(24);

    // Step header block
    const stepBlockH = step.stepDescription ? 18 : 12;
    const doneColor = step.isComplete ? B.green : B.light;

    doc.setFillColor(...B.bgLight);
    doc.setDrawColor(...B.line);
    doc.roundedRect(ML, y, CW, stepBlockH, 1.5, 1.5, 'FD');

    // Step badge
    doc.setFillColor(...doneColor);
    doc.circle(ML + 6, y + 6, 3.5, 'F');
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...B.white);
    doc.text(step.isComplete ? '✓' : String(step.stepNumber), ML + 6, y + 7.3, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...B.navy);
    doc.text(`Step ${step.stepNumber} — ${step.stepName}`, ML + 13, y + 7);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...B.mid);
    const statusLine = step.isComplete
      ? `Completed ${fmtDate(step.completedAt)}${step.completedByName ? ' by ' + step.completedByName : ''}`
      : 'Pending';
    doc.text(statusLine, PW - MR, y + 7, { align: 'right' });

    if (step.stepDescription) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8);
      doc.setTextColor(...B.mid);
      const dl = doc.splitTextToSize(step.stepDescription, CW - 18);
      doc.text(dl[0] || '', ML + 13, y + 12.5);
    }
    y += stepBlockH + 4;

    // AI step narrative — a 2-3 sentence summary of what was done across all
    // photos in this step, written after seeing the sequence. Renders as an
    // indented paragraph above the photo grid so the reader gets the workflow
    // at a glance before looking at individual photos.
    if (step.aiNarrative) {
      const narrativeLines = doc.splitTextToSize(step.aiNarrative, CW - 10);
      const paraH = narrativeLines.length * 4.6 + 7;
      ensureSpace(paraH + 4);

      // Left accent bar + label
      doc.setFillColor(...B.accent);
      doc.rect(ML, y, 2.5, paraH, 'F');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(...B.accent);
      doc.text(
        `AI WORKFLOW SUMMARY${step.aiNarrativeConfidence ? ` (${step.aiNarrativeConfidence})` : ''}`,
        ML + 6,
        y + 4
      );

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(...B.dark);
      doc.text(narrativeLines, ML + 6, y + 9);

      y += paraH + 4;
    }

    // Photos in a 2-column grid
    if (step.photos.length > 0) {
      renderPhotoGrid(step.photos, 'step');
    } else if (step.photoRequired) {
      doc.setFontSize(8);
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(...B.light);
      doc.text('(Photo evidence required — none uploaded)', ML + 2, y);
      y += 6;
    }

    // Step notes
    if (step.notes) {
      ensureSpace(10);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...B.mid);
      const nLines = doc.splitTextToSize(`Notes: ${step.notes}`, CW - 4);
      doc.text(nLines, ML + 2, y);
      y += nLines.length * 4 + 2;
    }

    y += 3;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GENERAL PHOTOS — ticket-level evidence not tied to a step
  // ═══════════════════════════════════════════════════════════════════════════

  if (data.generalPhotos.length > 0) {
    ensureSpace(18);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...B.navy);
    doc.text('Additional Evidence', ML, y);
    doc.setDrawColor(...B.accent);
    doc.line(ML, y + 2, ML + 35, y + 2);
    y += 8;
    renderPhotoGrid(data.generalPhotos, 'general');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NOTE LOG
  // ═══════════════════════════════════════════════════════════════════════════

  if (data.notes.length > 0) {
    ensureSpace(18);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...B.navy);
    doc.text('Notes', ML, y);
    doc.setDrawColor(...B.accent);
    doc.line(ML, y + 2, ML + 20, y + 2);
    y += 8;

    for (const note of data.notes) {
      ensureSpace(18);
      doc.setDrawColor(...B.line);
      doc.setLineWidth(0.3);
      doc.line(ML, y, PW - MR, y);

      const author = note.createdByName || 'System';
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(note.isResolution ? B.green[0] : B.dark[0], note.isResolution ? B.green[1] : B.dark[1], note.isResolution ? B.green[2] : B.dark[2]);
      doc.text(`${author}${note.isResolution ? ' (resolution)' : ''}`, ML, y + 5);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(...B.light);
      doc.text(fmtDateTime(note.createdAt), PW - MR, y + 5, { align: 'right' });

      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...B.dark);
      const lines = doc.splitTextToSize(note.content, CW);
      doc.text(lines, ML, y + 10);
      y += 10 + lines.length * 4.2 + 3;
    }
    y += 3;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ACTIVITY TIMELINE
  // ═══════════════════════════════════════════════════════════════════════════

  if (data.activity.length > 0) {
    ensureSpace(18);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...B.navy);
    doc.text('Activity Timeline', ML, y);
    doc.setDrawColor(...B.accent);
    doc.line(ML, y + 2, ML + 32, y + 2);
    y += 8;

    for (const act of data.activity) {
      ensureSpace(8);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...B.accent);
      doc.text(titleCase(act.activityType), ML, y);

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...B.light);
      doc.text(fmtDateTime(act.createdAt), PW - MR, y, { align: 'right' });

      if (act.description) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(...B.mid);
        const aLines = doc.splitTextToSize(act.description, CW - 8);
        doc.text(aLines, ML + 4, y + 4);
        y += 4 + aLines.length * 3.8;
      }
      y += 5;
    }
  }

  drawFooter();

  // ─── Done ────────────────────────────────────────────────────────────────
  const arrayBuffer = doc.output('arraybuffer');
  return Buffer.from(arrayBuffer);

  // ─── Photo grid helper (closure over doc/y/state) ────────────────────────
  function renderPhotoGrid(photos: ReportPhoto[], kind: 'step' | 'general') {
    const gap = 4;
    const photoW = (CW - gap) / 2;
    const photoH = photoW * 0.75;

    for (let i = 0; i < photos.length; i += 2) {
      const left = photos[i]!;
      const right = photos[i + 1];

      const captionPool = [left, right]
        .filter(Boolean)
        .map((p) => p!.aiCaption || '');
      // Reserve 5 lines max for caption so the row height is bounded.
      const maxCaptionLines = 5;
      const rowH = photoH + 4 + maxCaptionLines * 4;

      ensureSpace(rowH + 4);

      renderPhoto(left, ML, y, photoW, photoH, kind);
      if (right) {
        renderPhoto(right, ML + photoW + gap, y, photoW, photoH, kind);
      }

      // Captions under each column
      const captionY = y + photoH + 4;
      renderCaption(left, ML, captionY, photoW, maxCaptionLines);
      if (right) renderCaption(right, ML + photoW + gap, captionY, photoW, maxCaptionLines);

      y += rowH;
      void captionPool; // kept for future use
    }
  }

  function renderPhoto(
    photo: ReportPhoto,
    x: number,
    py: number,
    w: number,
    h: number,
    kind: 'step' | 'general'
  ) {
    // Frame
    doc.setDrawColor(...B.line);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, py, w, h, 1, 1, 'S');

    const dataUri = photoByUrl.get(photo.url);
    if (dataUri) {
      try {
        doc.addImage(dataUri, detectImageFormat(dataUri), x + 0.5, py + 0.5, w - 1, h - 1);
      } catch (err) {
        logger.warn('addImage failed, showing placeholder', {
          url: photo.url,
          error: err instanceof Error ? err.message : String(err),
        });
        drawImagePlaceholder(x, py, w, h, 'Render failed');
      }
    } else {
      drawImagePlaceholder(x, py, w, h, 'Unavailable');
    }

    // Context badge top-left
    const badgeLabel =
      photo.aiContext === 'before' ? 'BEFORE' : photo.aiContext === 'after' ? 'AFTER' : 'EVIDENCE';
    const badgeColor =
      photo.aiContext === 'before'
        ? B.red
        : photo.aiContext === 'after'
          ? B.green
          : B.accent;
    void kind;
    doc.setFillColor(...badgeColor);
    doc.rect(x + 0.5, py + 0.5, 16, 4.5, 'F');
    doc.setFontSize(6);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...B.white);
    doc.text(badgeLabel, x + 8.5, py + 3.5, { align: 'center' });
  }

  function drawImagePlaceholder(x: number, py: number, w: number, h: number, label: string) {
    doc.setFillColor(...B.bgLight);
    doc.rect(x + 0.5, py + 0.5, w - 1, h - 1, 'F');
    doc.setTextColor(...B.light);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'italic');
    doc.text(label, x + w / 2, py + h / 2 + 1, { align: 'center' });
  }

  function renderCaption(
    photo: ReportPhoto,
    x: number,
    py: number,
    w: number,
    maxLines: number
  ) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...B.dark);

    const labelTone =
      photo.aiContext === 'before'
        ? 'AI — Issue'
        : photo.aiContext === 'after'
          ? 'AI — Resolution'
          : 'AI — Description';
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...B.mid);
    doc.text(`${labelTone} (${photo.aiConfidence})`, x, py);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...B.dark);
    const lines = doc.splitTextToSize(photo.aiCaption, w).slice(0, maxLines);
    doc.text(lines, x, py + 3.5);
  }
}
