/**
 * Snag Resolution Report PDF Generator
 *
 * Produces a professional A4 portrait PDF with:
 *   - Branded cover section with period + summary stats
 *   - Per-snag sections: description, metadata, before/after photos, notes
 *   - Footer with page numbers
 *
 * Uses jsPDF + jspdf-autotable (dynamic imports to avoid SSR bundling).
 */

import { log } from '@/lib/logger';
import type { ResolutionReportRow } from '@/pages/api/snags/resolution-report';

// ─── Colour palette ───────────────────────────────────────────────────────────
const B = {
  navy:    [26,  31,  46]  as [number, number, number],
  dark:    [17,  24,  39]  as [number, number, number],
  mid:     [31,  41,  55]  as [number, number, number],
  bgLight: [38,  44,  55]  as [number, number, number],
  white:   [255, 255, 255] as [number, number, number],
  grey:    [156, 163, 175] as [number, number, number],
  border:  [55,  65,  81]  as [number, number, number],
  green:   [52,  211, 153] as [number, number, number],
  orange:  [251, 146, 60]  as [number, number, number],
  blue:    [96,  165, 250] as [number, number, number],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-ZA', { year: 'numeric', month: 'short', day: 'numeric' });
}

function cap(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

async function loadImageAsBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror  = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch { return null; }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function generateSnagResolutionPdf(
  rows: ResolutionReportRow[],
  dateFrom: string,
  dateTo: string
): Promise<Blob> {
  const [{ jsPDF }] = await Promise.all([
    import('jspdf'),
  ]);

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const PW = doc.internal.pageSize.getWidth();   // 210
  const PH = doc.internal.pageSize.getHeight();  // 297
  const ML = 14;
  const MR = 14;
  const CW = PW - ML - MR;
  let y = 14;

  const getPageCount = () =>
    (doc as unknown as { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages();

  function newPage() {
    doc.addPage();
    y = 14;
    // Light top-bar on continuation pages
    doc.setFillColor(...B.mid);
    doc.rect(0, 0, PW, 8, 'F');
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...B.grey);
    doc.text('VelocityFibre — Snag Resolution Report', ML, 5.5);
    doc.text(`${fmt(dateFrom)} — ${fmt(dateTo)}`, PW - MR, 5.5, { align: 'right' });
    y = 14;
  }

  function checkPageBreak(needed: number) {
    if (y + needed > PH - 14) newPage();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // COVER HEADER
  // ══════════════════════════════════════════════════════════════════════════

  doc.setFillColor(...B.navy);
  doc.rect(0, 0, PW, 38, 'F');

  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...B.white);
  doc.text('Snag Resolution Report', ML, 16);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...B.grey);
  doc.text('VelocityFibre — Civil QA', ML, 23);

  doc.setFontSize(9);
  doc.setTextColor(...B.white);
  doc.text(`Period: ${fmt(dateFrom)}  →  ${fmt(dateTo)}`, ML, 30);
  doc.text(`${rows.length} snag${rows.length !== 1 ? 's' : ''}`, PW - MR, 30, { align: 'right' });

  y = 46;

  // ── Summary stat tiles ────────────────────────────────────────────────────
  const statuses = ['pending_qa', 'resolved', 'verified', 'closed'];
  const counts = statuses.map((s) => rows.filter((r) => r.status === s).length);
  const labels = ['Pending QA', 'Resolved', 'Verified', 'Closed'];
  const tileW = CW / 4 - 2;

  statuses.forEach((_, i) => {
    const tx = ML + i * (tileW + 2.67);
    doc.setFillColor(...B.mid);
    doc.roundedRect(tx, y, tileW, 14, 1.5, 1.5, 'F');
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...B.white);
    doc.text(String(counts[i]), tx + tileW / 2, y + 8, { align: 'center' });
    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...B.grey);
    doc.text(labels[i]!, tx + tileW / 2, y + 12.5, { align: 'center' });
  });

  y += 20;

  // ══════════════════════════════════════════════════════════════════════════
  // PRE-LOAD PHOTOS
  // ══════════════════════════════════════════════════════════════════════════

  const photoCache = new Map<string, string>();
  const photoUrls: Array<{ id: string; url: string }> = [];

  for (const row of rows) {
    for (const ph of row.photos) {
      const url = ph.thumbnail_url ?? ph.photo_url;
      if (url) photoUrls.push({ id: ph.id, url });
    }
  }

  // Load in batches of 8
  for (let i = 0; i < photoUrls.length; i += 8) {
    const batch = photoUrls.slice(i, i + 8);
    await Promise.allSettled(
      batch.map(async ({ id, url }) => {
        const b64 = await loadImageAsBase64(url);
        if (b64) photoCache.set(id, b64);
      })
    );
  }

  log.info('snagResolutionPdf: photos pre-loaded', { total: photoUrls.length, cached: photoCache.size });

  // ══════════════════════════════════════════════════════════════════════════
  // PER-SNAG SECTIONS
  // ══════════════════════════════════════════════════════════════════════════

  for (const row of rows) {
    // Estimate space needed (header + meta + photos + notes)
    const beforePhotos = row.photos.filter((p) => p.phase === 'before');
    const afterPhotos  = row.photos.filter((p) => p.phase === 'after');
    const hasPhotos    = beforePhotos.length > 0 || afterPhotos.length > 0;
    const noteLines    = row.notes.reduce((acc, n) => acc + Math.ceil(n.content.length / 70) + 1, 0);
    const estDescH     = Math.min(Math.ceil(row.description.length / 70) + 1, 4) * 4 + 6;
    const estimatedH   = 9 + estDescH + 18 + (hasPhotos ? 56 : 0) + (noteLines > 0 ? noteLines * 4 + 8 : 0) + 6;

    checkPageBreak(estimatedH);

    // ── Snag header bar ───────────────────────────────────────────────────
    doc.setFillColor(...B.navy);
    doc.rect(ML, y, CW, 9, 'F');

    doc.setFontSize(9.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...B.white);
    doc.text(
      `#${row.snag_number}  ${row.report_number}  ·  ${row.project_name}`,
      ML + 3, y + 6
    );

    // Status badge (right side)
    const statusColor = row.status === 'closed' || row.status === 'verified'
      ? B.green
      : row.status === 'resolved'
        ? B.blue
        : B.orange;
    doc.setTextColor(...statusColor);
    doc.setFontSize(7.5);
    doc.text(cap(row.status), PW - MR - 3, y + 6, { align: 'right' });
    y += 12;

    // ── Description (dark bg so white text is visible) ────────────────────
    const descLines = doc.splitTextToSize(row.description, CW - 6);
    const descLineCount = Math.min(descLines.length, 4);
    const descH = descLineCount * 4 + 5;
    doc.setFillColor(...B.dark);
    doc.rect(ML, y, CW, descH, 'F');
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...B.grey);
    doc.text('ISSUE', ML + 3, y + 3.5);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...B.white);
    doc.text(descLines.slice(0, 4), ML + 3, y + 8);
    y += descH + 1;

    // ── Metadata strip ────────────────────────────────────────────────────
    doc.setFillColor(...B.bgLight);
    doc.roundedRect(ML, y, CW, 14, 1, 1, 'F');

    const meta = [
      { label: 'Category',     value: cap(row.category) },
      { label: 'Ref',          value: row.pole_reference ?? '—' },
      { label: 'Zone',         value: row.zone_no !== null ? String(row.zone_no) : '—' },
      { label: 'PON',          value: row.pon_no  !== null ? String(row.pon_no)  : '—' },
      { label: 'Opened',       value: fmt(row.opened_date) },
      { label: 'Resolved',     value: fmt(row.resolved_date) },
      { label: 'Assigned To',  value: row.assigned_to_name ?? '—' },
    ];

    const metaW = CW / meta.length;
    meta.forEach((m, i) => {
      const mx = ML + i * metaW + metaW / 2;
      doc.setFontSize(6.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...B.grey);
      doc.text(m.label, mx, y + 5, { align: 'center' });
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...B.white);
      const val = m.value.length > 14 ? m.value.slice(0, 13) + '…' : m.value;
      doc.text(val, mx, y + 11, { align: 'center' });
    });
    y += 17;

    // ── Before / After photos ─────────────────────────────────────────────
    if (hasPhotos) {
      checkPageBreak(58);

      const photoW = (CW - 6) / 2;
      const photoH = 50;

      // Labels
      doc.setFontSize(7);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...B.grey);
      doc.text('BEFORE', ML + photoW / 2, y + 4, { align: 'center' });
      doc.text('AFTER',  ML + photoW + 6 + photoW / 2, y + 4, { align: 'center' });
      y += 6;

      // Before photo box
      doc.setDrawColor(...B.border);
      doc.setLineWidth(0.3);
      doc.rect(ML, y, photoW, photoH);

      const beforePhoto = beforePhotos[0];
      if (beforePhoto) {
        const b64 = photoCache.get(beforePhoto.id);
        if (b64) {
          try { doc.addImage(b64, 'JPEG', ML + 1, y + 1, photoW - 2, photoH - 2); } catch { /* skip */ }
        } else {
          doc.setFontSize(7); doc.setTextColor(...B.grey);
          doc.text('Photo unavailable', ML + photoW / 2, y + photoH / 2, { align: 'center' });
        }
      } else {
        doc.setFontSize(7); doc.setTextColor(...B.grey);
        doc.text('No before photo', ML + photoW / 2, y + photoH / 2, { align: 'center' });
      }

      // After photo box
      const afterX = ML + photoW + 6;
      doc.rect(afterX, y, photoW, photoH);

      const afterPhoto = afterPhotos[0];
      if (afterPhoto) {
        const b64 = photoCache.get(afterPhoto.id);
        if (b64) {
          try { doc.addImage(b64, 'JPEG', afterX + 1, y + 1, photoW - 2, photoH - 2); } catch { /* skip */ }
        } else {
          doc.setFontSize(7); doc.setTextColor(...B.grey);
          doc.text('Photo unavailable', afterX + photoW / 2, y + photoH / 2, { align: 'center' });
        }
      } else {
        doc.setFontSize(7); doc.setTextColor(...B.grey);
        doc.text('No after photo', afterX + photoW / 2, y + photoH / 2, { align: 'center' });
      }

      y += photoH + 5;
    }

    // ── Notes ─────────────────────────────────────────────────────────────
    if (row.notes.length > 0 || row.verification_notes) {
      checkPageBreak(16);

      doc.setFillColor(...B.mid);
      doc.roundedRect(ML, y, CW, 6, 1, 1, 'F');
      doc.setFontSize(7);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...B.grey);
      doc.text('NOTES', ML + 3, y + 4);
      y += 8;

      if (row.verification_notes) {
        checkPageBreak(10);
        const vLines = doc.splitTextToSize(`Verification: ${row.verification_notes}`, CW - 6);
        const vH = vLines.length * 4 + 4;
        doc.setFillColor(...B.mid);
        doc.rect(ML, y, CW, vH, 'F');
        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'italic');
        doc.setTextColor(...B.green);
        doc.text(vLines, ML + 3, y + 3.5);
        y += vH + 1;
      }

      for (const note of row.notes) {
        checkPageBreak(10);
        const noteText = `[${cap(note.note_type)}] ${note.created_by_name ?? 'Unknown'}  ${fmt(note.created_at)}: ${note.content}`;
        const nLines = doc.splitTextToSize(noteText, CW - 6);
        const noteH = nLines.length * 4 + 4;
        doc.setFillColor(...B.dark);
        doc.rect(ML, y, CW, noteH, 'F');
        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...B.grey);
        doc.text(nLines, ML + 3, y + 3.5);
        y += noteH + 1;
      }
    }

    // Divider before next snag
    y += 4;
    doc.setDrawColor(...B.border);
    doc.setLineWidth(0.2);
    doc.line(ML, y, PW - MR, y);
    y += 6;
  }

  // ── Draw footers on all pages ─────────────────────────────────────────────
  const total = getPageCount();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setFontSize(7);
    doc.setTextColor(...B.grey);
    doc.setFont('helvetica', 'normal');
    doc.text(
      `Page ${p} of ${total}  |  Confidential — VelocityFibre`,
      PW / 2, PH - 6, { align: 'center' }
    );
  }

  return doc.output('blob');
}
