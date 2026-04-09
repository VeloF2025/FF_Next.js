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
  photos: CloseoutPhoto[];
  notes: CloseoutNote[];
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

const SEVERITY_COLOR: Record<string, [number, number, number]> = {
  critical: B.red, major: B.orange, minor: B.light,
};

const STATUS_COLOR: Record<string, [number, number, number]> = {
  open: B.red, assigned: B.orange, in_progress: B.orange,
  pending_qa: B.orange, fixed: B.orange, resolved: B.blue,
  verified: B.green, closed: B.green, reopened: B.red,
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

async function loadImageAsBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
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

  // Pre-load all photos (batch — limit to thumbnails for speed)
  const photoCache = new Map<string, string>();
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
        const b64 = await loadImageAsBase64(url);
        if (b64) photoCache.set(id, b64);
      })
    );
    // Log failures but continue
    results.forEach((r, idx) => {
      if (r.status === 'rejected') {
        log.warn('Failed to load photo for closeout report', { photoId: batch[idx]?.id });
      }
    });
  }

  for (const snag of data.snags) {
    newPage();

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
    doc.setFillColor(...B.bgLight);
    doc.roundedRect(ML, y, CW, 16, 1, 1, 'F');

    const metaItems = [
      { label: 'Category', value: capitalize(snag.category) },
      { label: 'Report', value: snag.report_number ?? '—' },
      { label: 'Zone', value: snag.zone_no !== null ? String(snag.zone_no) : '—' },
      { label: 'PON', value: snag.pon_no !== null ? String(snag.pon_no) : '—' },
      { label: 'Poles', value: snag.pole_references?.join(', ') || '—' },
    ];

    const metaW = CW / metaItems.length;
    metaItems.forEach((m, i) => {
      const mx = ML + 2 + i * metaW;
      doc.setFontSize(6);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...B.mid);
      doc.text(m.label, mx, y + 5);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...B.dark);
      const val = doc.splitTextToSize(m.value, metaW - 4);
      doc.text(val[0] ?? '—', mx, y + 10);
    });
    y += 20;

    // ── Photos: Before | After ───────────────────────────────────────────────
    const beforePhotos = snag.photos.filter((p) => p.phase === 'before');
    const afterPhotos = snag.photos.filter((p) => p.phase === 'after');
    const hasPhotos = beforePhotos.length > 0 || afterPhotos.length > 0;

    if (hasPhotos) {
      ensureSpace(65);

      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...B.navy);
      doc.text('Photo Evidence', ML + 2, y);
      y += 5;

      const photoW = (CW - 6) / 2;
      const photoH = 50;

      // Labels
      doc.setFontSize(7);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...B.mid);
      doc.text('BEFORE', ML + photoW / 2, y, { align: 'center' });
      doc.text('AFTER', ML + photoW + 6 + photoW / 2, y, { align: 'center' });
      y += 4;

      // Before photo
      doc.setDrawColor(...B.line);
      doc.setLineWidth(0.3);
      doc.rect(ML, y, photoW, photoH);

      if (beforePhotos.length > 0 && beforePhotos[0]) {
        const b64 = photoCache.get(beforePhotos[0].id);
        if (b64) {
          try { doc.addImage(b64, 'JPEG', ML + 1, y + 1, photoW - 2, photoH - 2); } catch { /* skip */ }
        } else {
          doc.setFontSize(7);
          doc.setTextColor(...B.light);
          doc.text('Photo unavailable', ML + photoW / 2, y + photoH / 2, { align: 'center' });
        }
      } else {
        doc.setFontSize(7);
        doc.setTextColor(...B.light);
        doc.text('No before photo', ML + photoW / 2, y + photoH / 2, { align: 'center' });
      }

      // After photo
      const afterX = ML + photoW + 6;
      doc.rect(afterX, y, photoW, photoH);

      if (afterPhotos.length > 0 && afterPhotos[0]) {
        const b64 = photoCache.get(afterPhotos[0].id);
        if (b64) {
          try { doc.addImage(b64, 'JPEG', afterX + 1, y + 1, photoW - 2, photoH - 2); } catch { /* skip */ }
        } else {
          doc.setFontSize(7);
          doc.setTextColor(...B.light);
          doc.text('Photo unavailable', afterX + photoW / 2, y + photoH / 2, { align: 'center' });
        }
      } else {
        doc.setFontSize(7);
        doc.setTextColor(...B.light);
        doc.text('No after photo', afterX + photoW / 2, y + photoH / 2, { align: 'center' });
      }

      y += photoH + 6;
    }

    // ── Assigned & Timeline ──────────────────────────────────────────────────
    ensureSpace(25);

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...B.navy);
    doc.text('Resolution Timeline', ML + 2, y);
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
      doc.text(`Team Notes (${snag.noc_ticket_uid ?? 'NOC Ticket'})`, ML + 2, y);
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

  // Final page footer
  drawFooter();

  return doc.output('blob');
}
