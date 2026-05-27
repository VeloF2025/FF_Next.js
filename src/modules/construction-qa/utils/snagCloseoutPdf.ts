/**
 * Snag Closeout Report PDF Generator
 *
 * Produces a professional A4 portrait PDF with:
 *   - VF logo + company header
 *   - Cover page with project info and summary stats
 *   - Per-snag detail pages: before/after photos, description, notes, timeline
 *   - Footer with page numbers and generation date
 *
 * Uses jsPDF + jspdf-autotable (dynamic imports).
 */

// Types inlined to avoid importing from pages/api (not resolvable from src/)
interface CloseoutPhoto {
  id: string;
  phase: string;
  photo_url: string;
  thumbnail_url: string | null;
  caption: string | null;
}

interface CloseoutNote {
  content: string;
  note_type: string;
  created_by_name: string | null;
  created_at: string;
}

interface CloseoutSnag {
  id: string;
  snag_number: number;
  description: string;
  category: string;
  severity: string;
  status: string;
  pole_references: string[] | null;
  assigned_to_name: string | null;
  verification_notes: string | null;
  created_at: string;
  assigned_at: string | null;
  fixed_at: string | null;
  verified_at: string | null;
  closed_at: string | null;
  report_number: string | null;
  audit_date: string | null;
  zone_no: number | null;
  pon_no: number | null;
  noc_ticket_id: string | null;
  noc_ticket_uid: string | null;
  noc_ticket_status?: string | null;
  photos: CloseoutPhoto[];
  notes: CloseoutNote[];
}

export interface CloseoutReportSubmitter {
  /** Full name of the Velocity Fibre person submitting the report */
  name: string;
  /** Job title shown under the name (e.g. "Civil Site Manager") */
  title?: string | null;
  /** Optional data URL (image/png or image/jpeg) of the submitter's signature */
  signature_data_url?: string | null;
}

export interface CloseoutReportData {
  project_name: string;
  project_id: string;
  generated_at: string;
  filters: { status?: string; zone_no?: number; pon_no?: number };
  summary: {
    total: number;
    open: number;
    assigned: number;
    in_progress: number;
    pending_qa: number;
    resolved: number;
    verified: number;
    closed: number;
  };
  snags: CloseoutSnag[];
  /** Populated from the logged-in user when the report is generated. */
  submitter?: CloseoutReportSubmitter | null;
}
import { log } from '@/lib/logger';

// ─── Brand ───────────────────────────────────────────────────────────────────

const B = {
  navy:      [30, 40, 70]      as [number, number, number],
  accent:    [91, 141, 239]    as [number, number, number],
  dark:      [30, 30, 30]      as [number, number, number],
  mid:       [80, 80, 80]      as [number, number, number],
  light:     [120, 120, 120]   as [number, number, number],
  line:      [200, 205, 215]   as [number, number, number],
  bgLight:   [245, 247, 250]   as [number, number, number],
  white:     [255, 255, 255]   as [number, number, number],
  red:       [220, 60, 60]     as [number, number, number],
  orange:    [220, 140, 40]    as [number, number, number],
  green:     [40, 160, 80]     as [number, number, number],
  blue:      [60, 120, 220]    as [number, number, number],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmtDate = (d: string | null): string => {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return d; }
};

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');

async function loadLogoAsBase64(): Promise<string | null> {
  try {
    const res = await fetch('/assets/vf/velocity-fibre-logo.jpg');
    if (!res.ok) return null;
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch { return null; }
}

/**
 * Image loaded with its EXIF orientation normalised out (pixels rotated/flipped
 * to match the orientation tag). Width/height are the *post-orientation*
 * dimensions so aspect-preserving layout can use them directly.
 */
interface LoadedImage {
  dataUrl: string;
  width: number;
  height: number;
}

/**
 * Load an image URL and return it already oriented upright, with its
 * *post-orientation* dimensions so callers can letterbox-fit into a slot.
 *
 * Strategy (primary path): `createImageBitmap(blob, { imageOrientation: 'from-image' })`.
 * This is the only reliable cross-browser way to apply EXIF orientation when
 * drawing via canvas — the plain `<img>` element auto-rotates in some
 * browser/version combos and doesn't in others, which caused the previous
 * attempt to double-rotate already-corrected images.
 *
 * Supported: Chrome 79+, Edge 79+, Firefox 77+, Safari 15.4+.
 *
 * Fallback (older browsers): decode via `<img>` and draw as-is. This drops
 * orientation correction but is better than crashing — modern browsers will
 * hit the primary path 99% of the time.
 */
async function loadOrientedImage(url: string): Promise<LoadedImage | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();

    let source: CanvasImageSource;
    let sourceW: number;
    let sourceH: number;

    // Primary: createImageBitmap applies EXIF when { imageOrientation: 'from-image' }
    // is honoured. Browsers that don't support the option still resolve with the
    // raw orientation — which is better than the previous manual-rotation path
    // that double-rotated images <img> had already auto-corrected.
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      source = bitmap;
      sourceW = bitmap.width;
      sourceH = bitmap.height;
    } else {
      // Fallback for environments without createImageBitmap (very old browsers)
      const blobUrl = URL.createObjectURL(blob);
      try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const el = new Image();
          el.onload = () => resolve(el);
          el.onerror = () => reject(new Error('image load failed'));
          el.src = blobUrl;
        });
        source = img;
        sourceW = img.naturalWidth;
        sourceH = img.naturalHeight;
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
    }

    if (!sourceW || !sourceH) return null;

    const canvas = document.createElement('canvas');
    canvas.width = sourceW;
    canvas.height = sourceH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0);
    if ('close' in source && typeof source.close === 'function') {
      source.close();
    }

    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    return { dataUrl, width: canvas.width, height: canvas.height };
  } catch { return null; }
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function generateSnagCloseoutPdf(data: CloseoutReportData): Promise<Blob> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const PW = doc.internal.pageSize.getWidth();  // 210
  const PH = doc.internal.pageSize.getHeight(); // 297
  const ML = 16;
  const MR = 16;
  const CW = PW - ML - MR;
  let y = 14;
  let pageNum = 1;

  const logoData = await loadLogoAsBase64();

  // ── Footer helper ──────────────────────────────────────────────────────────
  const drawFooter = () => {
    const fy = PH - 10;
    doc.setDrawColor(...B.line);
    doc.setLineWidth(0.3);
    doc.line(ML, fy - 2, PW - MR, fy - 2);
    doc.setFontSize(7);
    doc.setTextColor(...B.light);
    doc.setFont('helvetica', 'normal');
    doc.text(`Generated by FibreFlow — ${fmtDate(data.generated_at)}`, ML, fy);
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

  // ══════════════════════════════════════════════════════════════════════════
  // COVER PAGE
  // ══════════════════════════════════════════════════════════════════════════

  // Logo
  if (logoData) {
    doc.addImage(logoData, 'JPEG', ML, y, 40, 20);
  }
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...B.mid);
  doc.text('Velocity Fibre (Pty) Ltd', PW - MR, y + 6, { align: 'right' });
  doc.setFontSize(7);
  doc.text('www.velocityfibre.co.za', PW - MR, y + 11, { align: 'right' });
  y += 28;

  // Divider
  doc.setDrawColor(...B.navy);
  doc.setLineWidth(1);
  doc.line(ML, y, PW - MR, y);
  y += 12;

  // Title
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...B.navy);
  doc.text('SNAG CLOSEOUT REPORT', PW / 2, y, { align: 'center' });
  y += 14;

  // Project name
  doc.setFontSize(16);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...B.dark);
  doc.text(data.project_name, PW / 2, y, { align: 'center' });
  y += 10;

  // Date
  doc.setFontSize(10);
  doc.setTextColor(...B.mid);
  doc.text(`Report Date: ${fmtDate(data.generated_at)}`, PW / 2, y, { align: 'center' });
  y += 6;

  // Filters applied
  const filterParts: string[] = [];
  if (data.filters.status) filterParts.push(`Status: ${capitalize(data.filters.status)}`);
  if (data.filters.zone_no) filterParts.push(`Zone: ${data.filters.zone_no}`);
  if (data.filters.pon_no) filterParts.push(`PON: ${data.filters.pon_no}`);
  if (filterParts.length > 0) {
    doc.setFontSize(9);
    doc.text(`Filters: ${filterParts.join(' | ')}`, PW / 2, y, { align: 'center' });
    y += 6;
  }

  y += 10;

  // ── Summary Stats Box ──────────────────────────────────────────────────────
  doc.setFillColor(...B.bgLight);
  doc.setDrawColor(...B.line);
  doc.roundedRect(ML, y, CW, 32, 2, 2, 'FD');

  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...B.navy);
  doc.text('Executive Summary', ML + 4, y + 8);

  const statsY = y + 15;
  const statItems = [
    { label: 'Total', value: data.summary.total, color: B.dark },
    { label: 'Open', value: data.summary.open, color: B.red },
    { label: 'Assigned', value: data.summary.assigned, color: B.orange },
    { label: 'In Progress', value: data.summary.in_progress, color: B.orange },
    { label: 'Pending QA', value: data.summary.pending_qa, color: B.orange },
    { label: 'Resolved', value: data.summary.resolved, color: B.blue },
    { label: 'Verified', value: data.summary.verified, color: B.green },
    { label: 'Closed', value: data.summary.closed, color: B.green },
  ];

  const statW = CW / statItems.length;
  statItems.forEach((s, i) => {
    const sx = ML + 4 + i * statW;
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...s.color);
    doc.text(String(s.value), sx + statW / 2 - 2, statsY + 2, { align: 'center' });
    doc.setFontSize(6);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...B.mid);
    doc.text(s.label, sx + statW / 2 - 2, statsY + 7, { align: 'center' });
  });

  y += 40;

  // Resolution rate
  const resolvedCount = data.summary.verified + data.summary.closed + data.summary.resolved;
  const resolutionRate = data.summary.total > 0 ? Math.round((resolvedCount / data.summary.total) * 100) : 0;
  doc.setFontSize(10);
  doc.setTextColor(...B.mid);
  doc.text(`Resolution Rate: ${resolutionRate}% (${resolvedCount} of ${data.summary.total} snags resolved/verified/closed)`, PW / 2, y, { align: 'center' });

  drawFooter();

  // ══════════════════════════════════════════════════════════════════════════
  // SNAG DETAIL PAGES
  // ══════════════════════════════════════════════════════════════════════════

  // Pre-load all photos (batch — limit to thumbnails for speed).
  // Stored oriented (EXIF normalised) + with corrected width/height so the
  // draw step can letterbox-fit into the fixed photo slot.
  const photoCache = new Map<string, LoadedImage>();
  const photoUrls: Array<{ id: string; url: string }> = [];
  for (const snag of data.snags) {
    for (const photo of snag.photos) {
      const url = photo.thumbnail_url || photo.photo_url;
      if (url) photoUrls.push({ id: photo.id, url });
    }
  }

  // Load photos in batches of 10
  for (let i = 0; i < photoUrls.length; i += 10) {
    const batch = photoUrls.slice(i, i + 10);
    const results = await Promise.allSettled(
      batch.map(async ({ id, url }) => {
        const loaded = await loadOrientedImage(url);
        if (loaded) photoCache.set(id, loaded);
      })
    );
    // Log failures but continue
    results.forEach((r, idx) => {
      if (r.status === 'rejected') {
        log.warn('Failed to load photo for closeout report', { photoId: batch[idx]?.id });
      }
    });
  }

  // Detect whether the project's references are Drops (DR…) or Poles (P…/LAW…)
  // so the metadata column header matches the content.
  const looksLikeDrop = (refs: string[] | null): boolean => {
    const first = refs?.[0];
    return !!first && /^dr/i.test(first);
  };

  // Maximum photos of each phase to include. Two is plenty for a closeout PDF
  // and keeps page budget under control on 200+ snag reports.
  const MAX_PHOTOS_PER_PHASE = 2;

  for (const snag of data.snags) {
    newPage();

    // Register an outline bookmark so users can jump to a specific snag from
    // the PDF reader's sidebar. Many readers also render these as a table of
    // contents at page 1.
    const outline = (doc as unknown as {
      outline?: { add: (parent: unknown, title: string, opts: { pageNumber: number }) => void };
    }).outline;
    if (outline?.add) {
      try {
        outline.add(null, `#${snag.snag_number} — ${snag.description.slice(0, 60)}`, { pageNumber: pageNum });
      } catch { /* bookmark support varies by jsPDF version; ignore if unavailable */ }
    }

    // ── Snag header ──────────────────────────────────────────────────────────
    doc.setFillColor(...B.navy);
    doc.rect(ML, y, CW, 8, 'F');
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...B.white);
    doc.text(`Snag #${snag.snag_number}`, ML + 3, y + 5.5);

    // Status + severity on the right
    const statusLabel = capitalize(snag.status);
    const sevLabel = capitalize(snag.severity);
    doc.setFontSize(8);
    doc.text(`${statusLabel} | ${sevLabel}`, PW - MR - 3, y + 5.5, { align: 'right' });
    y += 12;

    // ── Description ──────────────────────────────────────────────────────────
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...B.dark);
    const descLines = doc.splitTextToSize(snag.description, CW - 4);
    doc.text(descLines, ML + 2, y);
    y += descLines.length * 4 + 4;

    // ── Metadata row ─────────────────────────────────────────────────────────
    // Values wrap across up to 2 lines so multi-DR snags don't get truncated.
    // The last column's label auto-switches between "Drops" and "Poles" based
    // on the content.
    const poleLabel = looksLikeDrop(snag.pole_references) ? 'Drops' : 'Poles';
    const metaItems = [
      { label: 'Category',  value: capitalize(snag.category) },
      { label: 'Report',    value: snag.report_number ?? '—' },
      { label: 'Zone',      value: snag.zone_no !== null ? String(snag.zone_no) : '—' },
      { label: 'PON',       value: snag.pon_no !== null ? String(snag.pon_no) : '—' },
      { label: poleLabel,   value: snag.pole_references?.join(', ') || '—' },
    ];

    // Compute required height from the widest wrapped value (min 16, max 28).
    const metaW = CW / metaItems.length;
    const wrappedValues = metaItems.map((m) => {
      const lines = doc.splitTextToSize(m.value, metaW - 4);
      return lines.slice(0, 2); // cap at 2 lines per cell
    });
    const maxValueLines = Math.max(1, ...wrappedValues.map((v) => v.length));
    const metaBoxH = Math.max(16, 7 + maxValueLines * 3.5 + 3);

    doc.setFillColor(...B.bgLight);
    doc.roundedRect(ML, y, CW, metaBoxH, 1, 1, 'F');

    metaItems.forEach((m, i) => {
      const mx = ML + 2 + i * metaW;
      doc.setFontSize(6);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...B.mid);
      doc.text(m.label, mx, y + 5);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...B.dark);
      doc.text(wrappedValues[i]!, mx, y + 9);
    });
    y += metaBoxH + 4;

    // ── Photos: Before | After ───────────────────────────────────────────────
    const beforePhotos = snag.photos.filter((p) => p.phase === 'before').slice(0, MAX_PHOTOS_PER_PHASE);
    const afterPhotos  = snag.photos.filter((p) => p.phase === 'after').slice(0, MAX_PHOTOS_PER_PHASE);
    const beforeRemaining = Math.max(0, snag.photos.filter((p) => p.phase === 'before').length - MAX_PHOTOS_PER_PHASE);
    const afterRemaining  = Math.max(0, snag.photos.filter((p) => p.phase === 'after').length - MAX_PHOTOS_PER_PHASE);
    const hasPhotos = beforePhotos.length > 0 || afterPhotos.length > 0;

    if (hasPhotos) {
      // Decide the column height: if *either* the first before or first after
      // photo is portrait, use a taller slot so portrait photos fill more of
      // the page rather than being letterboxed into a postcard strip.
      const firstBefore = beforePhotos[0] ? photoCache.get(beforePhotos[0].id) : null;
      const firstAfter  = afterPhotos[0]  ? photoCache.get(afterPhotos[0].id)  : null;
      const anyPortrait =
        (firstBefore && firstBefore.height > firstBefore.width) ||
        (firstAfter && firstAfter.height > firstAfter.width);

      const photoW = (CW - 6) / 2;
      const photoH = anyPortrait ? 78 : 50;

      ensureSpace(photoH + 20);

      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...B.navy);
      doc.text('Photo Evidence', ML + 2, y);
      y += 5;

      // Labels
      doc.setFontSize(7);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...B.mid);
      const beforeLabel = beforePhotos.length > 1
        ? `BEFORE (${beforePhotos.length}${beforeRemaining > 0 ? ` of ${beforePhotos.length + beforeRemaining}` : ''})`
        : beforeRemaining > 0
          ? `BEFORE (1 of ${1 + beforeRemaining})`
          : 'BEFORE';
      const afterLabel = afterPhotos.length > 1
        ? `AFTER (${afterPhotos.length}${afterRemaining > 0 ? ` of ${afterPhotos.length + afterRemaining}` : ''})`
        : afterRemaining > 0
          ? `AFTER (1 of ${1 + afterRemaining})`
          : 'AFTER';
      doc.text(beforeLabel, ML + photoW / 2, y, { align: 'center' });
      doc.text(afterLabel,  ML + photoW + 6 + photoW / 2, y, { align: 'center' });
      y += 4;

      // Letterbox-fit an image into its slot (pads around edges, preserves AR).
      const drawIntoSlot = (loaded: LoadedImage, slotX: number, slotY: number, slotW: number, slotH: number) => {
        const pad = 1;
        const innerW = slotW - pad * 2;
        const innerH = slotH - pad * 2;
        const scale = Math.min(innerW / loaded.width, innerH / loaded.height);
        const drawW = loaded.width * scale;
        const drawH = loaded.height * scale;
        const offX = slotX + pad + (innerW - drawW) / 2;
        const offY = slotY + pad + (innerH - drawH) / 2;
        try { doc.addImage(loaded.dataUrl, 'JPEG', offX, offY, drawW, drawH); } catch { /* skip */ }
      };

      // Render a phase column (before or after): stack photos vertically inside
      // the column, draw an optional caption under each photo, and fall back to
      // a placeholder if none exist.
      const drawPhaseColumn = (
        photos: CloseoutPhoto[],
        colX: number,
        emptyMessage: string,
      ) => {
        doc.setDrawColor(...B.line);
        doc.setLineWidth(0.3);
        doc.rect(colX, y, photoW, photoH);

        if (photos.length === 0) {
          doc.setFontSize(7);
          doc.setTextColor(...B.light);
          doc.text(emptyMessage, colX + photoW / 2, y + photoH / 2, { align: 'center' });
          return;
        }

        const slotH = photos.length > 1 ? (photoH - 2) / photos.length : photoH;
        photos.forEach((photo, idx) => {
          const slotY = y + idx * slotH + (idx > 0 ? 1 : 0);
          const slotHeight = slotH - (idx > 0 ? 1 : 0);
          const loaded = photoCache.get(photo.id);
          if (loaded) {
            drawIntoSlot(loaded, colX, slotY, photoW, slotHeight);
          } else {
            doc.setFontSize(7);
            doc.setTextColor(...B.light);
            doc.text('Photo unavailable', colX + photoW / 2, slotY + slotHeight / 2, { align: 'center' });
          }
          // Faint horizontal rule between stacked photos
          if (idx > 0) {
            doc.setDrawColor(...B.line);
            doc.setLineWidth(0.2);
            doc.line(colX + 2, slotY, colX + photoW - 2, slotY);
          }
        });
      };

      drawPhaseColumn(beforePhotos, ML, 'No before photo');
      drawPhaseColumn(afterPhotos, ML + photoW + 6, 'No after photo');

      y += photoH + 4;

      // Render captions under each column if any of the shown photos have one
      const collectCaptions = (photos: CloseoutPhoto[]) =>
        photos
          .map((p) => p.caption?.trim())
          .filter((c): c is string => !!c);

      const beforeCaptions = collectCaptions(beforePhotos);
      const afterCaptions  = collectCaptions(afterPhotos);
      if (beforeCaptions.length > 0 || afterCaptions.length > 0) {
        doc.setFontSize(7);
        doc.setFont('helvetica', 'italic');
        doc.setTextColor(...B.mid);
        const captionLinesBefore = beforeCaptions.flatMap((c) => doc.splitTextToSize(c, photoW - 4));
        const captionLinesAfter  = afterCaptions.flatMap((c) => doc.splitTextToSize(c, photoW - 4));
        const maxCapLines = Math.max(captionLinesBefore.length, captionLinesAfter.length);
        if (captionLinesBefore.length > 0) doc.text(captionLinesBefore, ML + 2, y + 3);
        if (captionLinesAfter.length > 0)  doc.text(captionLinesAfter,  ML + photoW + 8, y + 3);
        y += maxCapLines * 3 + 4;
      } else {
        y += 2;
      }
    }

    // ── Resolution Timeline (+ live ticket status pill) ──────────────────────
    ensureSpace(28);

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...B.navy);
    doc.text('Resolution Timeline', ML + 2, y);

    // Small status pill on the right when the linked ticket is still live
    const openTicketStatuses = new Set([
      'open', 'assigned', 'in_progress', 'pending_qa', 'qa_in_progress',
      'qa_rejected', 'qa_approved', 'pending_handover', 'handed_to_ops', 'resolved',
    ]);
    if (snag.noc_ticket_uid && snag.noc_ticket_status && openTicketStatuses.has(snag.noc_ticket_status)) {
      const pillLabel = `Ticket ${snag.noc_ticket_uid}: ${capitalize(snag.noc_ticket_status)}`;
      doc.setFontSize(7);
      doc.setFont('helvetica', 'bold');
      const textW = doc.getTextWidth(pillLabel);
      const pillW = textW + 6;
      const pillX = PW - MR - pillW;
      const pillY = y - 3.2;
      doc.setFillColor(...B.orange);
      doc.roundedRect(pillX, pillY, pillW, 5, 1, 1, 'F');
      doc.setTextColor(...B.white);
      doc.text(pillLabel, pillX + pillW / 2, pillY + 3.6, { align: 'center' });
    }
    y += 5;

    const timelineItems = [
      { label: 'Assigned To', value: snag.assigned_to_name ?? '—' },
      { label: 'Reported', value: fmtDate(snag.audit_date ?? snag.created_at) },
      { label: 'Assigned', value: fmtDate(snag.assigned_at) },
      { label: 'Fixed', value: fmtDate(snag.fixed_at) },
      { label: 'Verified', value: fmtDate(snag.verified_at) },
      { label: 'Closed', value: fmtDate(snag.closed_at) },
    ];

    autoTable(doc, {
      startY: y,
      margin: { left: ML, right: MR },
      head: [timelineItems.map((t) => t.label)],
      body: [timelineItems.map((t) => t.value)],
      styles: { fontSize: 7, cellPadding: 2 },
      headStyles: { fillColor: B.navy, textColor: B.white, fontStyle: 'bold' },
      bodyStyles: { textColor: B.dark },
      theme: 'grid',
    });

    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

    // ── Verification Notes ───────────────────────────────────────────────────
    if (snag.verification_notes) {
      ensureSpace(20);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...B.navy);
      doc.text('Verification Notes', ML + 2, y);
      y += 5;

      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...B.dark);
      const noteLines = doc.splitTextToSize(snag.verification_notes, CW - 4);
      doc.text(noteLines, ML + 2, y);
      y += noteLines.length * 3.5 + 4;
    }

    // ── NOC Ticket Notes ─────────────────────────────────────────────────────
    if (snag.notes.length > 0) {
      ensureSpace(20);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...B.navy);
      const ticketRef = snag.noc_ticket_uid ? `NOC Ticket ${snag.noc_ticket_uid}` : 'NOC Ticket';
      doc.text(`Team Notes — ${ticketRef}`, ML + 2, y);
      y += 5;

      for (const note of snag.notes.slice(0, 10)) {
        ensureSpace(15);

        doc.setFontSize(6);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...B.mid);
        const noteHeader = `${note.created_by_name ?? 'System'} — ${fmtDate(note.created_at)} (${note.note_type})`;
        doc.text(noteHeader, ML + 2, y);
        y += 3;

        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...B.dark);
        const noteLines = doc.splitTextToSize(note.content, CW - 6);
        const maxLines = noteLines.slice(0, 5); // Limit to 5 lines per note
        doc.text(maxLines, ML + 4, y);
        y += maxLines.length * 3 + 3;
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DECLARATION & SIGN-OFF PAGE
  // ══════════════════════════════════════════════════════════════════════════

  newPage();

  // Logo on sign-off page (matches cover page layout)
  if (logoData) {
    doc.addImage(logoData, 'JPEG', ML, y, 40, 20);
  }
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...B.mid);
  doc.text('Velocity Fibre (Pty) Ltd', PW - MR, y + 6, { align: 'right' });
  doc.setFontSize(7);
  doc.text('www.velocityfibre.co.za', PW - MR, y + 11, { align: 'right' });
  y += 28;

  // Navy divider
  doc.setDrawColor(...B.navy);
  doc.setLineWidth(1);
  doc.line(ML, y, PW - MR, y);
  y += 12;

  // Section title
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...B.navy);
  doc.text('Declaration & Sign-Off', ML, y);
  y += 10;

  // Declaration paragraph
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...B.dark);
  const declaration =
    'I, the undersigned, confirm that the photographic evidence presented in this report ' +
    'accurately reflects the before and after status of each snag item. Velocity Fibre (Pty) Ltd ' +
    'accepts responsibility for all outstanding items and commits to providing close-out ' +
    'photographs upon completion.';
  const declLines = doc.splitTextToSize(declaration, CW);
  doc.text(declLines, ML, y);
  y += declLines.length * 5 + 8;

  // Two sign-off columns: Submitted by (Velocity) | Reviewed by (Client)
  // Taller column so a hand-drawn signature has breathing room when printed.
  const colGap = 10;
  const colW = (CW - colGap) / 2;
  const leftX = ML;
  const rightX = ML + colW + colGap;
  const colTop = y;
  const colH = 78;

  // Column headers
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...B.navy);
  doc.text('Submitted by:', leftX, colTop);
  doc.text('Reviewed by (Fibertime):', rightX, colTop);

  // ── Left column: Velocity Fibre side ───────────────────────────────────────
  const submitterName = data.submitter?.name?.trim() || 'Velocity Fibre Representative';
  const submitterTitle = data.submitter?.title?.trim() || null;
  const submittedDate = fmtDate(data.generated_at);

  let ly = colTop + 7;
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...B.dark);
  doc.text(submitterName, leftX, ly);
  ly += 6;

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...B.mid);
  if (submitterTitle) {
    doc.text(submitterTitle, leftX, ly);
    ly += 5;
  }
  doc.text('Velocity Fibre (Pty) Ltd', leftX, ly);
  ly += 5;
  doc.text(`Date: ${submittedDate}`, leftX, ly);
  ly += 10;

  // Signature label + line for Velocity side — near bottom of the taller col
  // with enough clearance above for a printed wet signature or the stamped
  // image below.
  const leftSigLineY = colTop + colH - 6;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...B.mid);
  doc.text('Signature:', leftX, leftSigLineY);
  doc.setDrawColor(...B.line);
  doc.setLineWidth(0.4);
  doc.line(leftX + 18, leftSigLineY, leftX + colW, leftSigLineY);

  // If a signature image was supplied, stamp it above the line
  if (data.submitter?.signature_data_url) {
    try {
      const fmt = data.submitter.signature_data_url.startsWith('data:image/png')
        ? 'PNG'
        : 'JPEG';
      doc.addImage(
        data.submitter.signature_data_url,
        fmt,
        leftX + 20,
        leftSigLineY - 20,
        45,
        18,
      );
    } catch {
      // Fall through silently — the line is still drawn for a wet signature.
    }
  }

  // ── Right column: Fibertime/Client side (blank fields to fill in) ──────────
  let ry = colTop + 7;
  const fieldLineX = rightX + 22;
  const fieldLineEnd = rightX + colW;

  const drawField = (label: string, yy: number) => {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...B.mid);
    doc.text(label, rightX, yy);
    doc.setDrawColor(...B.line);
    doc.setLineWidth(0.4);
    doc.line(fieldLineX, yy, fieldLineEnd, yy);
  };

  // Roomier spacing so a wet signature fits cleanly on a printed page.
  drawField('Name:',      ry + 3); ry += 14;
  drawField('Date:',      ry);     ry += 14;
  drawField('Reference:', ry);     ry += 20;
  drawField('Signature:', ry);

  y = colTop + colH + 14;

  // Confidential footer note above the page footer
  doc.setFontSize(8);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(...B.light);
  const confidential =
    'Velocity Fibre (Pty) Ltd  |  26 Centenary Road, Lorraine, Gqeberha  |  ' +
    'info@velocityfibre.co.za  |  Confidential — intended for named recipient only.';
  const confLines = doc.splitTextToSize(confidential, CW);
  doc.text(confLines, PW / 2, y, { align: 'center' });

  // Final page footer
  drawFooter();

  return doc.output('blob');
}
