/**
 * Meeting Minutes PDF Generator
 * Produces a professional A4 portrait PDF with:
 *   - Velocity Fibre logo + header
 *   - Meeting metadata (date, time, duration, location, chair)
 *   - Attendance list
 *   - Discussion / overview section
 *   - Decisions taken
 *   - Detailed agenda outline
 *   - Consolidated action items table
 *   - Footer with page numbers + confidentiality
 *
 * Uses jsPDF + jspdf-autotable (dynamic imports, same pattern as statementPdf.ts).
 */

import type { Meeting } from '../types/meeting.types';
import type { ActionItem } from '@/types/action-items.types';
import { actionItemsService } from '@/services/action-items/actionItemsService';
import { log } from '@/lib/logger';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtDate = (d: Date | string): string => {
  const date = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-ZA', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
};

const fmtTime = (d: Date | string): string => {
  const date = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false });
};

/** Fetch the Velocity logo as a base64 data-URL for embedding in the PDF. */
async function loadLogoAsBase64(): Promise<string | null> {
  try {
    const res = await fetch('/help-assets/velocity-logo.jpg');
    if (!res.ok) return null;
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

// ─── Brand colours ────────────────────────────────────────────────────────────

const BRAND = {
  navy: [30, 40, 70] as [number, number, number],
  accent: [91, 141, 239] as [number, number, number],
  darkText: [30, 30, 30] as [number, number, number],
  midText: [80, 80, 80] as [number, number, number],
  lightText: [120, 120, 120] as [number, number, number],
  line: [200, 205, 215] as [number, number, number],
  bgLight: [245, 247, 250] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
};

// ─── Main Export ──────────────────────────────────────────────────────────────

export async function generateMeetingMinutesPdf(meeting: Meeting): Promise<Blob> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const PW = doc.internal.pageSize.getWidth(); // 210
  const PH = doc.internal.pageSize.getHeight(); // 297
  const ML = 18; // margin left
  const MR = 18; // margin right
  const CW = PW - ML - MR; // content width
  let y = 14; // cursor

  // ── Logo ────────────────────────────────────────────────────────────────────
  const logoData = await loadLogoAsBase64();
  if (logoData) {
    doc.addImage(logoData, 'JPEG', ML, y, 36, 18);
  }

  // ── Company name (right-aligned) ────────────────────────────────────────────
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...BRAND.midText);
  doc.text('Velocity Fibre (Pty) Ltd', PW - MR, y + 6, { align: 'right' });
  doc.setFontSize(8);
  doc.text('www.velocityfibre.co.za', PW - MR, y + 11, { align: 'right' });

  y += 24;

  // ── Divider ─────────────────────────────────────────────────────────────────
  doc.setDrawColor(...BRAND.navy);
  doc.setLineWidth(0.8);
  doc.line(ML, y, PW - MR, y);
  y += 6;

  // ── Document title ──────────────────────────────────────────────────────────
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...BRAND.navy);
  doc.text('MEETING MINUTES', PW / 2, y, { align: 'center' });
  y += 10;

  // ── Meeting details box ─────────────────────────────────────────────────────
  doc.setFillColor(...BRAND.bgLight);
  doc.setDrawColor(...BRAND.line);
  doc.roundedRect(ML, y, CW, 34, 2, 2, 'FD');

  const detailX1 = ML + 4;
  const detailX2 = ML + CW / 2 + 4;
  const dy = y + 7;

  const writeDetail = (label: string, value: string, x: number, row: number) => {
    const rowY = dy + row * 7;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...BRAND.midText);
    doc.text(`${label}:`, x, rowY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...BRAND.darkText);
    doc.text(value, x + 28, rowY);
  };

  writeDetail('Meeting', meeting.title, detailX1, 0);
  writeDetail('Date', fmtDate(meeting.date), detailX1, 1);
  writeDetail('Time', meeting.time || fmtTime(meeting.date), detailX1, 2);
  writeDetail('Duration', meeting.duration || '—', detailX1, 3);

  const locationStr = meeting.isVirtual ? 'Virtual' : (meeting.location || '—');
  const platformMap: Record<string, string> = {
    teams: 'Microsoft Teams',
    fireflies: 'Fireflies.ai',
    livekit: 'LiveKit',
    manual: 'Manual',
  };
  writeDetail('Location', locationStr, detailX2, 0);
  writeDetail('Platform', platformMap[meeting.source] || meeting.source || '—', detailX2, 1);
  writeDetail('Chair', meeting.organizerName || meeting.organizer || '—', detailX2, 2);
  writeDetail('Secretary', 'AI-Generated', detailX2, 3);

  y += 40;

  // ── Helper: section heading ─────────────────────────────────────────────────
  const sectionHeading = (title: string, sectionNum: number) => {
    if (y > PH - 40) {
      doc.addPage();
      y = 18;
    }
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...BRAND.navy);
    doc.text(`${sectionNum}. ${title.toUpperCase()}`, ML, y);
    y += 2;
    doc.setDrawColor(...BRAND.accent);
    doc.setLineWidth(0.4);
    doc.line(ML, y, ML + CW * 0.3, y);
    y += 5;
  };

  // ── Helper: body text with wrapping ─────────────────────────────────────────
  const bodyText = (text: string) => {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...BRAND.darkText);
    const lines = doc.splitTextToSize(text, CW - 4);
    for (const line of lines) {
      if (y > PH - 20) {
        doc.addPage();
        y = 18;
      }
      doc.text(line, ML + 2, y);
      y += 4.5;
    }
  };

  // ── Helper: bullet list ─────────────────────────────────────────────────────
  const bulletList = (items: string[]) => {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...BRAND.darkText);
    for (const item of items) {
      if (y > PH - 20) {
        doc.addPage();
        y = 18;
      }
      const wrapped = doc.splitTextToSize(item, CW - 10);
      doc.text('\u2022', ML + 3, y);
      for (let i = 0; i < wrapped.length; i++) {
        if (i > 0 && y > PH - 20) {
          doc.addPage();
          y = 18;
        }
        doc.text(wrapped[i], ML + 8, y);
        y += 4.5;
      }
    }
  };

  // ── 1. ATTENDANCE ───────────────────────────────────────────────────────────
  let sn = 1;
  sectionHeading('Attendance', sn++);

  const attendees = meeting.rawParticipants?.length
    ? meeting.rawParticipants
    : meeting.participants?.map(name => ({ name, email: '', displayName: name })) ?? [];

  if (attendees.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [['#', 'Name', 'Email']],
      body: attendees.map((a, i) => [
        String(i + 1),
        a.displayName || a.name,
        a.email || '—',
      ]),
      styles: { fontSize: 8, cellPadding: 2.5 },
      headStyles: {
        fillColor: BRAND.navy,
        textColor: 255,
        fontStyle: 'bold',
        fontSize: 8,
      },
      alternateRowStyles: { fillColor: BRAND.bgLight },
      columnStyles: {
        0: { cellWidth: 10, halign: 'center' },
        1: { cellWidth: 60 },
      },
      tableWidth: CW,
      margin: { left: ML, right: MR },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable?.finalY + 8 || y + 20;
  } else {
    bodyText('No attendance data available.');
    y += 4;
  }

  // ── 2. MEETING OVERVIEW ─────────────────────────────────────────────────────
  const overviewText = meeting.summary?.overview;
  const isPlaceholder = !overviewText || /no (transcript|summary|ai)/i.test(overviewText);
  if (overviewText && !isPlaceholder) {
    sectionHeading('Meeting Overview', sn++);
    bodyText(overviewText);
    y += 4;
  }

  // ── 3. DISCUSSION POINTS / OUTLINE ──────────────────────────────────────────
  if (meeting.summary?.outline && meeting.summary.outline.length > 0) {
    sectionHeading('Discussion Points', sn++);
    bulletList(meeting.summary.outline);
    y += 4;
  }

  // ── 4. DECISIONS ────────────────────────────────────────────────────────────
  if (meeting.summary?.decisions && meeting.summary.decisions.length > 0) {
    sectionHeading('Decisions Taken', sn++);
    bulletList(meeting.summary.decisions);
    y += 4;
  }

  // ── 5. KEY TOPICS / KEYWORDS ────────────────────────────────────────────────
  if (meeting.summary?.keywords && meeting.summary.keywords.length > 0) {
    sectionHeading('Key Topics', sn++);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...BRAND.midText);
    const keywordStr = meeting.summary.keywords.join('  |  ');
    const kwLines = doc.splitTextToSize(keywordStr, CW - 4);
    for (const line of kwLines) {
      if (y > PH - 20) {
        doc.addPage();
        y = 18;
      }
      doc.text(line, ML + 2, y);
      y += 4.5;
    }
    y += 4;
  }

  // ── 6. USER NOTES ──────────────────────────────────────────────────────────
  if (meeting.userNotes) {
    sectionHeading('Additional Notes', sn++);
    bodyText(meeting.userNotes);
    y += 4;
  }

  // ── 7. ACTION ITEMS ─────────────────────────────────────────────────────────
  // Fetch real action items from DB (the meeting object often has an empty array)
  let dbActionItems: ActionItem[] = [];
  try {
    dbActionItems = await actionItemsService.getActionItems({ meeting_id: Number(meeting.id) });
  } catch {
    // Fall back to meeting.actionItems if API fails
    log.warn('Could not fetch action items from API, using meeting data', { meetingId: meeting.id });
  }

  const allActions = [
    ...dbActionItems.map(a => ({
      task: a.description,
      assignee: a.assignee_name || a.assigned_user_name || '—',
      dueDate: a.due_date ? fmtDate(a.due_date) : '—',
      status: a.status === 'completed' ? 'Completed' : a.status === 'in_progress' ? 'In Progress' : 'Pending',
    })),
    // Fall back to meeting.actionItems if DB returned nothing
    ...(dbActionItems.length === 0 ? meeting.actionItems.map(a => ({
      task: a.task,
      assignee: a.assignee || '—',
      dueDate: a.dueDate ? fmtDate(a.dueDate) : '—',
      status: a.completed ? 'Completed' : 'Pending',
    })) : []),
    // Add AI-detected items not already in DB results
    ...(meeting.summary?.action_items || [])
      .filter(text => !dbActionItems.some(a => a.description === text) && !meeting.actionItems.some(a => a.task === text))
      .map(text => ({
        task: text,
        assignee: '—',
        dueDate: '—',
        status: 'Pending',
      })),
  ];

  if (allActions.length > 0) {
    sectionHeading('Action Items', sn++);

    autoTable(doc, {
      startY: y,
      head: [['#', 'Action Item', 'Responsible', 'Due Date', 'Status']],
      body: allActions.map((a, i) => [
        String(i + 1),
        a.task,
        a.assignee,
        a.dueDate,
        a.status,
      ]),
      styles: { fontSize: 8, cellPadding: 2.5 },
      headStyles: {
        fillColor: BRAND.navy,
        textColor: 255,
        fontStyle: 'bold',
        fontSize: 8,
      },
      alternateRowStyles: { fillColor: BRAND.bgLight },
      columnStyles: {
        0: { cellWidth: 10, halign: 'center' },
        1: { cellWidth: 70 },
        2: { cellWidth: 35 },
        3: { cellWidth: 28 },
        4: { cellWidth: 22, halign: 'center' },
      },
      tableWidth: CW,
      margin: { left: ML, right: MR },
      didDrawCell: (data) => {
        if (data.section === 'body' && data.column.index === 4) {
          const val = String(data.cell.raw);
          if (val === 'Completed') {
            doc.setTextColor(22, 163, 74);
          } else {
            doc.setTextColor(200, 120, 20);
          }
        }
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable?.finalY + 8 || y + 20;
  }

  // ── 8. CLOSURE ──────────────────────────────────────────────────────────────
  if (y > PH - 50) {
    doc.addPage();
    y = 18;
  }

  sectionHeading('Closure', sn++);
  bodyText(`The meeting was concluded. Minutes generated on ${fmtDate(new Date())} at ${fmtTime(new Date())} SAST.`);
  y += 10;

  // ── Signature lines ─────────────────────────────────────────────────────────
  if (y > PH - 40) {
    doc.addPage();
    y = 18;
  }

  const sigY = y + 4;
  doc.setDrawColor(...BRAND.line);
  doc.setLineWidth(0.3);

  doc.line(ML, sigY, ML + 60, sigY);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...BRAND.midText);
  doc.text('Chairperson', ML, sigY + 5);

  doc.line(PW - MR - 60, sigY, PW - MR, sigY);
  doc.text('Secretary / Minute-taker', PW - MR - 60, sigY + 5);

  // ── Page footers (paint on every page) ──────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const totalPages = (doc as any).internal.getNumberOfPages();

  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...BRAND.line);
    doc.setLineWidth(0.3);
    doc.line(ML, PH - 12, PW - MR, PH - 12);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...BRAND.lightText);
    doc.text('CONFIDENTIAL — For internal distribution only', ML, PH - 7);
    doc.text(`Page ${i} of ${totalPages}`, PW - MR, PH - 7, { align: 'right' });
    doc.text('Velocity Fibre — Meeting Minutes', PW / 2, PH - 7, { align: 'center' });
  }

  log.info('Meeting minutes PDF generated', { meetingId: meeting.id, pages: totalPages });

  return doc.output('blob');
}
