/**
 * Snag Workflow User Manual — PDF Generator
 *
 * Generates a professional user manual for the FibreFlow snag workflow.
 * Run: npx tsx scripts/generate-snag-manual.ts
 *
 * Uses jsPDF + screenshots from /tmp/manual-*.png
 */

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as fs from 'fs';
import * as path from 'path';

// ─── Brand ──────────────────────────────────────────────────────────────────

const B = {
  navy:    [30, 40, 70]    as [number, number, number],
  accent:  [91, 141, 239]  as [number, number, number],
  dark:    [30, 30, 30]    as [number, number, number],
  mid:     [80, 80, 80]    as [number, number, number],
  light:   [120, 120, 120] as [number, number, number],
  line:    [200, 205, 215] as [number, number, number],
  bgLight: [245, 247, 250] as [number, number, number],
  white:   [255, 255, 255] as [number, number, number],
  green:   [40, 160, 80]   as [number, number, number],
  blue:    [60, 120, 220]  as [number, number, number],
  orange:  [220, 140, 40]  as [number, number, number],
  red:     [220, 60, 60]   as [number, number, number],
};

const PW = 210; // A4 width
const PH = 297; // A4 height
const ML = 18;
const MR = 18;
const CW = PW - ML - MR;

// ─── Helpers ────────────────────────────────────────────────────────────────

function loadImage(filename: string): string | null {
  const p = path.join('/tmp', filename);
  if (!fs.existsSync(p)) { console.warn(`Missing: ${p}`); return null; }
  const buf = fs.readFileSync(p);
  return 'data:image/png;base64,' + buf.toString('base64');
}

function loadLogo(): string | null {
  const p = path.join(__dirname, '..', 'public', 'assets', 'vf', 'velocity-fibre-logo.jpg');
  if (!fs.existsSync(p)) return null;
  return 'data:image/jpeg;base64,' + fs.readFileSync(p).toString('base64');
}

// ─── Main ───────────────────────────────────────────────────────────────────

function generate() {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  let y = 0;
  let pageNum = 1;
  const logo = loadLogo();
  const today = new Date().toLocaleDateString('en-ZA', { day: '2-digit', month: 'long', year: 'numeric' });

  // ── Footer ──────────────────────────────────────────────────────────────
  const footer = () => {
    doc.setDrawColor(...B.line);
    doc.setLineWidth(0.3);
    doc.line(ML, PH - 12, PW - MR, PH - 12);
    doc.setFontSize(7);
    doc.setTextColor(...B.light);
    doc.text('FibreFlow — Snag Workflow User Manual', ML, PH - 8);
    doc.text(`Page ${pageNum}`, PW - MR, PH - 8, { align: 'right' });
    doc.text('CONFIDENTIAL — Velocity Fibre (Pty) Ltd', PW / 2, PH - 8, { align: 'center' });
  };

  const newPage = () => { footer(); doc.addPage(); pageNum++; y = 18; };
  const ensureSpace = (n: number) => { if (y + n > PH - 20) newPage(); };

  // ── Section heading ──────────────────────────────────────────────────────
  const sectionHeading = (num: string, title: string) => {
    ensureSpace(20);
    doc.setFillColor(...B.navy);
    doc.rect(ML, y, CW, 9, 'F');
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...B.white);
    doc.text(`${num}. ${title}`, ML + 4, y + 6.5);
    y += 14;
  };

  const subHeading = (title: string) => {
    ensureSpace(12);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...B.navy);
    doc.text(title, ML, y);
    y += 6;
  };

  const para = (text: string) => {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...B.dark);
    const lines = doc.splitTextToSize(text, CW);
    ensureSpace(lines.length * 4 + 2);
    doc.text(lines, ML, y);
    y += lines.length * 4 + 3;
  };

  const bullet = (items: string[]) => {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...B.dark);
    for (const item of items) {
      const lines = doc.splitTextToSize(item, CW - 8);
      ensureSpace(lines.length * 4 + 2);
      doc.text('•', ML + 2, y);
      doc.text(lines, ML + 7, y);
      y += lines.length * 4 + 1;
    }
    y += 2;
  };

  const addScreenshot = (filename: string, caption: string, maxH = 80) => {
    const img = loadImage(filename);
    if (!img) {
      para(`[Screenshot: ${caption} — not available]`);
      return;
    }
    ensureSpace(maxH + 10);
    const imgW = CW - 10;
    const imgH = maxH;
    doc.setDrawColor(...B.line);
    doc.setLineWidth(0.3);
    doc.rect(ML + 5, y, imgW, imgH);
    try { doc.addImage(img, 'PNG', ML + 5, y, imgW, imgH); } catch { /* skip */ }
    y += imgH + 2;
    doc.setFontSize(7);
    doc.setTextColor(...B.light);
    doc.setFont('helvetica', 'italic');
    doc.text(caption, PW / 2, y, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    y += 6;
  };

  // ══════════════════════════════════════════════════════════════════════════
  // COVER PAGE
  // ══════════════════════════════════════════════════════════════════════════

  y = 30;
  if (logo) doc.addImage(logo, 'JPEG', PW / 2 - 25, y, 50, 25);
  y += 35;

  doc.setDrawColor(...B.navy);
  doc.setLineWidth(1.5);
  doc.line(ML + 20, y, PW - MR - 20, y);
  y += 15;

  doc.setFontSize(28);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...B.navy);
  doc.text('SNAG WORKFLOW', PW / 2, y, { align: 'center' });
  y += 12;
  doc.text('USER MANUAL', PW / 2, y, { align: 'center' });
  y += 15;

  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...B.mid);
  doc.text('FibreFlow — Civil QA Module', PW / 2, y, { align: 'center' });
  y += 8;
  doc.setFontSize(10);
  doc.text(`Version 1.0 — ${today}`, PW / 2, y, { align: 'center' });
  y += 20;

  doc.setDrawColor(...B.line);
  doc.setLineWidth(0.5);
  doc.line(ML + 20, y, PW - MR - 20, y);
  y += 15;

  doc.setFontSize(9);
  doc.setTextColor(...B.mid);
  doc.text('Prepared by: FibreFlow Development Team', PW / 2, y, { align: 'center' });
  y += 5;
  doc.text('Velocity Fibre (Pty) Ltd', PW / 2, y, { align: 'center' });
  y += 5;
  doc.text('www.velocityfibre.co.za', PW / 2, y, { align: 'center' });

  footer();

  // ══════════════════════════════════════════════════════════════════════════
  // TABLE OF CONTENTS
  // ══════════════════════════════════════════════════════════════════════════

  newPage();
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...B.navy);
  doc.text('Table of Contents', ML, y);
  y += 12;

  const toc = [
    ['1', 'Overview', '3'],
    ['2', 'Snag Lifecycle & Workflow', '4'],
    ['3', 'Summary View', '5'],
    ['4', 'Drill-Down Accordion', '6'],
    ['5', 'List View & Filters', '7'],
    ['6', 'NOC Ticket Detail', '8'],
    ['7', 'Before/After Photo Evidence', '9'],
    ['8', 'Verification Steps', '10'],
    ['9', 'Subcontractor Shared Links', '11'],
    ['10', 'Closeout Report', '12'],
    ['11', 'Not Resolvable / Invalid Tickets', '13'],
    ['12', 'QA Approval Permissions', '14'],
    ['13', 'My Tickets & My Team Tickets', '15'],
  ];

  for (const [num, title, pg] of toc) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...B.dark);
    doc.text(`${num}.`, ML + 4, y);
    doc.text(title, ML + 14, y);
    doc.setTextColor(...B.light);
    doc.text(pg, PW - MR - 4, y, { align: 'right' });
    doc.setDrawColor(...B.line);
    doc.setLineDashPattern([1, 1], 0);
    doc.line(ML + 14 + doc.getTextWidth(title) + 2, y - 0.5, PW - MR - 8, y - 0.5);
    doc.setLineDashPattern([], 0);
    y += 7;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 1: OVERVIEW
  // ══════════════════════════════════════════════════════════════════════════

  newPage();
  sectionHeading('1', 'Overview');

  para('The FibreFlow Snag Workflow manages quality issues (snags) identified during TQR (Technical Quality Review) audits of fibre network installations. Each snag goes through a structured lifecycle from identification to resolution, with photo evidence, team notes, and formal QA approval.');

  para('The system is accessed via the Civil QA module under Field Operations. It provides three views:');

  bullet([
    'Cards View — Project dashboard showing snag counts per project',
    'List View — Tabular view with filters, pagination, and closeout report export',
    'Summary View — Per-project breakdown with clickable status drill-down',
  ]);

  para('Key features include:');
  bullet([
    'NOC Kanban-aligned status columns (Open → Assigned → In Progress → Pending QA → Resolved → Verified → Closed)',
    'Clickable drill-down from summary to individual snags with inline workflow buttons',
    'Before/After photo comparison on ticket detail pages',
    'Shareable links for subcontractors to resolve tickets without login',
    'Professional closeout report PDF generation for client handover',
    'RBAC-gated QA approval (only authorized users can approve)',
    '"Not Resolvable" rejection workflow with manager sign-off',
  ]);

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 2: LIFECYCLE
  // ══════════════════════════════════════════════════════════════════════════

  newPage();
  sectionHeading('2', 'Snag Lifecycle & Workflow');

  para('Each snag follows this workflow, aligned with the NOC Kanban board:');

  autoTable(doc, {
    startY: y,
    margin: { left: ML, right: MR },
    head: [['Status', 'Description', 'Who Acts', 'Next Step']],
    body: [
      ['Open', 'Snag identified from TQR audit', 'System / Auditor', 'Assign to technician'],
      ['Assigned', 'Assigned to a person or subcontractor', 'Team Lead', 'Start Work'],
      ['In Progress', 'Work has started on the fix', 'Technician / Subcontractor', 'Mark as Fixed'],
      ['Pending QA', 'Fix completed, awaiting quality review', 'QA Approver', 'Approve or Reject QA'],
      ['Resolved', 'QA approved, waiting for customer confirmation', 'QA Approver / Manager', 'Customer Confirmed'],
      ['Verified', 'Customer confirmed satisfaction', 'Manager / Admin', 'Close'],
      ['Closed', 'Snag fully resolved and documented', '—', '—'],
    ],
    styles: { fontSize: 7, cellPadding: 2 },
    headStyles: { fillColor: B.navy, textColor: B.white, fontStyle: 'bold' },
    bodyStyles: { textColor: B.dark },
    theme: 'grid',
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  subHeading('Workflow Buttons');
  para('Each status has forward (green →) and backward (grey ←) buttons:');

  autoTable(doc, {
    startY: y,
    margin: { left: ML, right: MR },
    head: [['Current Status', '← Back', '→ Forward', 'Reject']],
    body: [
      ['Open', '—', 'Assign →', '—'],
      ['Assigned', '← Unassign', 'Start Work →', 'Not Resolvable'],
      ['In Progress', '← Back to Assigned', 'Mark as Fixed →', 'Not Resolvable'],
      ['Pending QA', '← Reject QA', 'Approve QA →', '—'],
      ['Resolved', '← Customer Unhappy', 'Customer Confirmed →', '—'],
      ['Verified', '← Reopen', 'Close →', '—'],
      ['Closed', '← Reopen', '—', '—'],
    ],
    styles: { fontSize: 7, cellPadding: 2 },
    headStyles: { fillColor: B.navy, textColor: B.white, fontStyle: 'bold' },
    theme: 'grid',
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 3: SUMMARY VIEW
  // ══════════════════════════════════════════════════════════════════════════

  newPage();
  sectionHeading('3', 'Summary View');

  para('The Summary view (Field Operations → Snags → Summary) shows a per-project breakdown of snag counts across all 7 workflow statuses. Each non-zero count cell is clickable.');

  addScreenshot('manual-01-summary.png', 'Figure 3.1 — Snag Summary View with NOC-aligned columns');

  para('Features:');
  bullet([
    'Seven status columns aligned with NOC Kanban: Open, Assigned, In Progress, Pending QA, Resolved, Verified, Closed',
    'Expandable project rows showing Zone → PON breakdown',
    'Excel export button for downloading the full summary',
    'Search by DR number, pole reference, or description',
    'Totals row at the bottom',
  ]);

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 4: DRILL-DOWN
  // ══════════════════════════════════════════════════════════════════════════

  newPage();
  sectionHeading('4', 'Drill-Down Accordion');

  para('Click any non-zero count cell in the summary table to expand an inline accordion showing individual snags for that project and status.');

  addScreenshot('manual-02-drilldown.png', 'Figure 4.1 — Drill-down showing Pending QA snags for Mohadin');

  para('The drill-down shows:');
  bullet([
    'Zone → PON hierarchy with snag counts',
    'Individual snag rows with: number, description, severity badge, NOC ticket link',
    'Forward/backward workflow buttons on each snag row',
    'Active cell highlighted with a blue ring',
    'Auto-refreshes summary counts when a snag status changes',
    'Click the same cell again to collapse',
  ]);

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 5: LIST VIEW
  // ══════════════════════════════════════════════════════════════════════════

  newPage();
  sectionHeading('5', 'List View & Filters');

  para('The List view shows all snags in a tabular format with comprehensive filtering.');

  addScreenshot('manual-03-list.png', 'Figure 5.1 — Snag List View with filters and count tiles');

  para('Filter options:');
  bullet([
    'Project — select a specific project',
    'Zone — filter by zone number within the project',
    'PON — filter by PON number within the zone',
    'Status — filter by workflow status (all statuses in workflow order)',
    'Category — Quality, Safety, Health, Environment, Traffic',
    'Severity — Critical, Major, Minor',
  ]);

  subHeading('Closeout Report');
  para('When a project is selected, the "Closeout Report" button appears. Click it to generate a professional PDF report for client handover, including cover page, executive summary, per-snag before/after photos, notes, and resolution timeline.');

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 6: TICKET DETAIL
  // ══════════════════════════════════════════════════════════════════════════

  newPage();
  sectionHeading('6', 'NOC Ticket Detail');

  para('Each snag is linked to a NOC maintenance ticket. The ticket detail page shows comprehensive information and workflow actions.');

  addScreenshot('manual-05-ticket-header.png', 'Figure 6.1 — Ticket header with workflow buttons');

  para('The ticket header shows:');
  bullet([
    'Ticket UID (e.g. SNG-20260409-001)',
    'Status badge (clickable dropdown for manual status change)',
    'Priority badge (clickable to change priority)',
    'Workflow buttons: ← Back, Forward →, Not Resolvable, Share',
    'Title, creation/update timestamps, assigned user',
    'DR Number with clickable Map link',
    'FibreFlow Cross-Reference: Pole Number, Zone, PON, GPS coordinates',
  ]);

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 7: PHOTOS
  // ══════════════════════════════════════════════════════════════════════════

  newPage();
  sectionHeading('7', 'Before/After Photo Evidence');

  para('The Overview tab displays before and after photos side by side with clear labels.');

  addScreenshot('manual-06-before-after.png', 'Figure 7.1 — Before/After photo comparison on Overview tab');

  para('Photo layout:');
  bullet([
    'BEFORE (red label, red border) — Original TQR audit photo showing the defect',
    'AFTER (green label, green border) — Photo uploaded after rectification',
    'When no after photo exists, an empty placeholder shows with upload guidance',
    'Photos are clickable and open in a new tab at full resolution',
    'GPS coordinates in the description are clickable Google Maps links',
  ]);

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 8: VERIFICATION
  // ══════════════════════════════════════════════════════════════════════════

  newPage();
  sectionHeading('8', 'Verification Steps');

  para('Snag tickets use a 5-step verification checklist (visible on the Verification tab):');

  addScreenshot('manual-07-verification.png', 'Figure 8.1 — Snag verification steps with progress bar');

  autoTable(doc, {
    startY: y,
    margin: { left: ML, right: MR },
    head: [['Step', 'Name', 'Photo Required', 'Description']],
    body: [
      ['1', 'Assess Snag', 'No', 'Visit site and assess the snag. Confirm it matches the before photo.'],
      ['2', 'Perform Rectification', 'No', 'Complete the repair following quality standards.'],
      ['3', 'After Photo (Proof of Fix)', 'YES', 'Upload after photo from same angle as before. Used in closeout report.'],
      ['4', 'Quality Check', 'No', 'Verify fix meets standards. No new issues introduced.'],
      ['5', 'Documentation & Sign-off', 'No', 'Add notes. Record materials used if applicable.'],
    ],
    styles: { fontSize: 7, cellPadding: 2 },
    headStyles: { fillColor: B.navy, textColor: B.white, fontStyle: 'bold' },
    theme: 'grid',
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  para('Step 3 (After Photo) is mandatory — the uploaded photo is used in the closeout report sent to the client.');

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 9: SHARED LINKS
  // ══════════════════════════════════════════════════════════════════════════

  newPage();
  sectionHeading('9', 'Subcontractor Shared Links');

  para('Tickets can be shared with external subcontractors via a secure public link. No login is required.');

  addScreenshot('manual-08-public-resolve.png', 'Figure 9.1 — Public resolve page (subcontractor view)');

  subHeading('How to Share');
  bullet([
    'Open the ticket in the NOC',
    'Click the "Share" button (next to workflow buttons)',
    'A URL is copied to your clipboard',
    'Send the URL to the subcontractor via WhatsApp, email, etc.',
  ]);

  subHeading('Subcontractor Experience');
  bullet([
    'Opens the link — sees ticket details, before photo, GPS location (clickable)',
    'Clicks "Start Work" — ticket moves to In Progress',
    'Completes verification steps, uploads after photo',
    'Clicks "Submit for QA" — ticket moves to Pending QA, page becomes read-only',
    'If QA rejects — the link becomes interactive again automatically',
    'If QA approves — the link stays read-only permanently',
  ]);

  addScreenshot('manual-09-public-steps.png', 'Figure 9.2 — Verification steps on the public resolve page');

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 10: CLOSEOUT REPORT
  // ══════════════════════════════════════════════════════════════════════════

  newPage();
  sectionHeading('10', 'Closeout Report');

  para('The closeout report is a professional PDF document generated for client handover. It summarizes all resolved snags with before/after photos and team notes.');

  subHeading('How to Generate');
  bullet([
    'Go to Snags → List view',
    'Select a project from the dropdown',
    'Optionally filter by Zone, PON, or Status',
    'Click the blue "Closeout Report" button',
    'PDF downloads automatically',
  ]);

  subHeading('Report Contents');
  bullet([
    'Cover page with VF logo, project name, date',
    'Executive summary: status breakdown, resolution rate percentage',
    'Per-snag detail pages with:',
    '  — Snag number, status, severity',
    '  — Description and metadata (zone, PON, poles, category)',
    '  — Before/After photos side by side',
    '  — Resolution timeline table (reported → assigned → fixed → verified)',
    '  — Verification notes',
    '  — NOC team notes',
    'Footer: page numbers, generation date, confidentiality notice',
  ]);

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 11: NOT RESOLVABLE
  // ══════════════════════════════════════════════════════════════════════════

  newPage();
  sectionHeading('11', 'Not Resolvable / Invalid Tickets');

  para('If a snag cannot be fixed (incorrect photo, not applicable, physically impossible), the technician can mark it as "Not Resolvable".');

  subHeading('Workflow');
  bullet([
    'From Assigned or In Progress status, click the red "Not Resolvable" button',
    'The snag moves to Won\'t Fix status',
    'A QA approver (manager/admin) reviews and either:',
    '  — "Approve Rejection" → snag moves to Closed',
    '  — "Send Back" → snag returns to In Progress for rework',
  ]);

  para('This ensures that no snag is silently dismissed — every rejection requires management sign-off.');

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 12: QA PERMISSIONS
  // ══════════════════════════════════════════════════════════════════════════

  sectionHeading('12', 'QA Approval Permissions');

  para('QA approval actions are restricted to authorized users only. Regular technicians and viewers cannot approve QA.');

  subHeading('Who Can Approve QA');

  autoTable(doc, {
    startY: y,
    margin: { left: ML, right: MR },
    head: [['Role / User', 'Can Approve QA', 'Can Do Field Work']],
    body: [
      ['Super Admin (e.g. Hein van Vuuren)', 'YES', 'YES'],
      ['Manager', 'YES', 'YES'],
      ['Admin', 'YES', 'YES'],
      ['Chantall Cordier (named approver)', 'YES', 'YES'],
      ['Jacques White (named approver)', 'YES', 'YES'],
      ['Ticket Assignee', 'YES', 'YES'],
      ['Technician', 'NO', 'YES'],
      ['Viewer', 'NO', 'NO (view only)'],
      ['Subcontractor (shared link)', 'NO', 'YES (via link)'],
    ],
    styles: { fontSize: 8, cellPadding: 2.5 },
    headStyles: { fillColor: B.navy, textColor: B.white, fontStyle: 'bold' },
    theme: 'grid',
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  para('QA approval buttons (Approve QA, Customer Confirmed, Close, Approve Rejection) are hidden for users without approval permission. Field work buttons (Start Work, Mark as Fixed, Not Resolvable) are visible to all authenticated users.');

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 13: MY TICKETS & MY TEAM TICKETS
  // ══════════════════════════════════════════════════════════════════════════

  newPage();
  sectionHeading('13', 'My Tickets & My Team Tickets');

  para('The NOC Work Orders page provides three ticket views to help you focus on relevant work:');

  subHeading('All Tickets');
  para('Shows every ticket across all teams and assignees. Use this view for a complete overview of the snag workload. The Kanban board displays tickets in status columns: Open, Assigned, In Progress, Pending QA, Resolved, Verified, Closed.');

  addScreenshot('m15-my-tickets.png', 'Figure 13.1 — All Tickets Kanban view with status columns');

  subHeading('My Tickets (Mine)');
  para('Filters to show only tickets assigned to you personally. This is the primary view for technicians and subcontractors to see their workload. The count tiles at the top show your personal ticket breakdown.');

  addScreenshot('m16-mine.png', 'Figure 13.2 — My Tickets view showing only tickets assigned to the current user');

  bullet([
    'Shows only tickets where you are the assigned user',
    'Count tiles reflect your personal workload (Total, Open, In Progress, QA, etc.)',
    'Same Kanban/Table/Grid view options as All Tickets',
    'Use this to track what you need to work on today',
  ]);

  subHeading('My Team Tickets (Team)');
  para('Filters to show tickets assigned to anyone on your team. Team leads use this to monitor their team\'s progress and identify bottlenecks. If a team member is overloaded, the lead can reassign tickets.');

  addScreenshot('m17-team.png', 'Figure 13.3 — Team view showing all tickets for the current user\'s team');

  bullet([
    'Shows tickets assigned to any member of your team',
    'Team leads can see who has what and redistribute work',
    'Useful for daily standups and workload balancing',
    'Filter further by Type, Source, Date, or Project',
  ]);

  subHeading('Switching Views');
  para('Click the "All Tickets", "Mine", or "Team" buttons at the top of the Work Orders page to switch between views. You can also switch between Kanban, Table, and Grid layouts using the buttons on the right.');

  // Final footer
  footer();

  // ── Save ─────────────────────────────────────────────────────────────────
  const outputPath = path.join(__dirname, '..', 'public', 'snag-workflow-manual.pdf');
  const buf = Buffer.from(doc.output('arraybuffer'));
  fs.writeFileSync(outputPath, buf);
  console.log(`✅ Manual generated: ${outputPath} (${Math.round(buf.length / 1024)}KB)`);
}

generate();
