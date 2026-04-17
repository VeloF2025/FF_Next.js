/**
 * DR Timeline PDF generator
 *
 * RFC §5.6 / Phase 7 — produces a one-DR dispute packet:
 *   - Header: DR number, project, team, generation timestamp, actor
 *   - Snapshot: OES current, last 1Map fix, current billing status
 *   - Timeline: every dr_activity_log event, reverse-chronological
 *   - Footer: page numbers + generated-by line
 *
 * Client-side generation via jsPDF + jspdf-autotable (dynamic imports so
 * the ~250 KB bundle is only paid for by users who hit the Export button).
 */

export interface TimelineEntryForPdf {
  timestamp: string;
  title: string;
  description: string;
  actor: string | null;
  eventType: string;
}

export interface DrPdfContext {
  drNumber: string;
  project: string | null;
  team: string | null;
  oesSerial: string | null;
  oesActivatedAt: string | null;
  lastFixSerial: string | null;
  lastFixAt: string | null;
  latestBillingNote: string | null;
  latestBillingWeek: string | null;
  generatedAt: string;
  generatedBy: string;
  timeline: TimelineEntryForPdf[];
}

type RGB = [number, number, number];
const COLOR_INK: RGB = [30, 30, 30];
const COLOR_MUTED: RGB = [120, 120, 120];
const COLOR_BRAND: RGB = [59, 130, 246]; // blue-500
const COLOR_LINE: RGB = [220, 220, 220];

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-ZA', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

export async function generateDrTimelinePdf(ctx: DrPdfContext): Promise<Blob> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const PW = doc.internal.pageSize.getWidth();
  const PH = doc.internal.pageSize.getHeight();
  const ML = 16;
  const MR = 16;
  let y = 16;

  // ─── Header ────────────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(...COLOR_INK);
  doc.text('DR Timeline', ML, y);

  doc.setFontSize(14);
  doc.setTextColor(...COLOR_BRAND);
  doc.text(ctx.drNumber, ML + 48, y);

  doc.setFontSize(8);
  doc.setTextColor(...COLOR_MUTED);
  doc.text(
    `Generated ${fmtDate(ctx.generatedAt)} by ${ctx.generatedBy}`,
    PW - MR,
    y,
    { align: 'right' },
  );

  y += 4;
  doc.setDrawColor(...COLOR_LINE);
  doc.setLineWidth(0.3);
  doc.line(ML, y, PW - MR, y);
  y += 6;

  // ─── Context box ───────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...COLOR_INK);
  doc.text('Context', ML, y);
  y += 4;

  const facts: Array<[string, string]> = [
    ['Project', ctx.project ?? '—'],
    ['Team', ctx.team ?? '—'],
    ['OES serial', ctx.oesSerial ?? '—'],
    ['OES activated', fmtDate(ctx.oesActivatedAt)],
    ['Last 1Map fix serial', ctx.lastFixSerial ?? '—'],
    ['Last 1Map fix at', fmtDate(ctx.lastFixAt)],
    ['Latest billing note', ctx.latestBillingNote ?? '—'],
    ['Latest billing week', ctx.latestBillingWeek ?? '—'],
  ];

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const colW = (PW - ML - MR) / 2;
  for (let i = 0; i < facts.length; i += 2) {
    const [kA, vA] = facts[i]!;
    const pair = facts[i + 1];
    doc.setTextColor(...COLOR_MUTED);
    doc.text(`${kA}:`, ML, y);
    doc.setTextColor(...COLOR_INK);
    doc.text(vA, ML + 36, y);
    if (pair) {
      const [kB, vB] = pair;
      doc.setTextColor(...COLOR_MUTED);
      doc.text(`${kB}:`, ML + colW, y);
      doc.setTextColor(...COLOR_INK);
      doc.text(vB, ML + colW + 36, y);
    }
    y += 5;
  }
  y += 4;

  // ─── Timeline heading ──────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...COLOR_INK);
  doc.text(`Timeline (${ctx.timeline.length} events)`, ML, y);
  y += 2;

  // ─── Timeline table via autoTable ──────────────────────────────────────────
  const rows = ctx.timeline.map((e) => [
    fmtDate(e.timestamp),
    e.title,
    e.description,
    e.actor ?? '—',
  ]);

  autoTable(doc, {
    startY: y + 2,
    head: [['When', 'Event', 'Detail', 'Actor']],
    body: rows,
    theme: 'grid',
    styles: {
      fontSize: 8,
      cellPadding: 2,
      lineWidth: 0.1,
      lineColor: COLOR_LINE,
      textColor: COLOR_INK,
    },
    headStyles: {
      fillColor: [245, 245, 245],
      textColor: COLOR_INK,
      fontStyle: 'bold',
      fontSize: 8,
    },
    alternateRowStyles: { fillColor: [250, 250, 250] },
    columnStyles: {
      0: { cellWidth: 34 },
      1: { cellWidth: 38 },
      2: { cellWidth: 'auto' },
      3: { cellWidth: 36 },
    },
    margin: { left: ML, right: MR },
    didDrawPage: (data) => {
      // Footer
      const fy = PH - 8;
      doc.setDrawColor(...COLOR_LINE);
      doc.setLineWidth(0.2);
      doc.line(ML, fy - 2, PW - MR, fy - 2);
      doc.setFontSize(7);
      doc.setTextColor(...COLOR_MUTED);
      doc.setFont('helvetica', 'normal');
      doc.text(`FibreFlow — DR Timeline Export · ${ctx.drNumber}`, ML, fy);
      const pageText = `Page ${data.pageNumber}`;
      doc.text(pageText, PW - MR, fy, { align: 'right' });
    },
  });

  return doc.output('blob');
}

export function triggerDrTimelineDownload(blob: Blob, drNumber: string): void {
  const date = new Date().toISOString().slice(0, 10);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${drNumber}-timeline-${date}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
