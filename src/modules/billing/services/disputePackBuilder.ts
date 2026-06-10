/**
 * Dispute pack builder — Excel workbook of the deductions we are actively
 * disputing with Fibertime for one billing week. One sheet per note type,
 * one row per disputed DR, with our evidence and its timestamps spelled
 * out so the pack stands on its own in the weekly FT meeting.
 *
 * Styling mirrors src/lib/oes-report/ftDisputeSheetsV2.ts.
 */

import ExcelJS from 'exceljs';

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' },
};
const DISPUTE_FILL: ExcelJS.Fill = {
  type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' },
};

const NOTE_LABELS: Record<string, string> = {
  note1: 'Note 1 — Low Signal',
  note2: 'Note 2 — No Field App',
  note3: 'Note 3 — Degraded',
  note4: 'Note 4 — Serial Mismatch',
  note5: 'Note 5 — Offline',
};

export interface DisputePackRow {
  drNumber: string;
  noteCode: string;
  project: string | null;
  team: string | null;
  ftSerial: string | null;
  oesSerial: string | null;
  oesStatus: string | null;
  oesActivatedAt: string | null;
  signalDbm: number | null;
  disputeReason: string | null;
  disputeOpenedAt: string | null;
  verdictReasons: string[];
  verdictComputedAt: string | null;
  ticketUid: string | null;
}

const COLUMNS: Array<{ header: string; width: number; value: (r: DisputePackRow) => ExcelJS.CellValue }> = [
  { header: 'DR Number', width: 14, value: (r) => r.drNumber },
  { header: 'Project', width: 14, value: (r) => r.project ?? '' },
  { header: 'Team', width: 10, value: (r) => r.team ?? '' },
  { header: 'FT Billed Serial', width: 18, value: (r) => r.ftSerial ?? '' },
  { header: 'OES Serial', width: 18, value: (r) => r.oesSerial ?? '' },
  { header: 'OES Status', width: 12, value: (r) => r.oesStatus ?? '' },
  { header: 'OES Activated', width: 14, value: (r) => r.oesActivatedAt?.slice(0, 10) ?? '' },
  { header: 'RX (dBm)', width: 10, value: (r) => r.signalDbm ?? '' },
  { header: 'Our Evidence', width: 70, value: (r) => r.verdictReasons.join('; ') || (r.disputeReason ?? '') },
  { header: 'Evidence As Of', width: 14, value: (r) => r.verdictComputedAt?.slice(0, 10) ?? '' },
  { header: 'Dispute Raised', width: 14, value: (r) => r.disputeOpenedAt?.slice(0, 10) ?? '' },
  { header: 'FF Ticket', width: 16, value: (r) => r.ticketUid ?? '' },
];

function addNoteSheet(wb: ExcelJS.Workbook, noteCode: string, rows: DisputePackRow[]): void {
  const ws = wb.addWorksheet(NOTE_LABELS[noteCode] ?? noteCode);
  ws.columns = COLUMNS.map((c) => ({ width: c.width }));

  const header = ws.addRow(COLUMNS.map((c) => c.header));
  header.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
  });
  header.height = 18;

  for (const r of rows) {
    const row = ws.addRow(COLUMNS.map((c) => c.value(r)));
    row.eachCell((cell) => { cell.fill = DISPUTE_FILL; });
  }

  const total = ws.addRow([`Total: ${rows.length}`]);
  total.font = { bold: true };
}

/**
 * Build the workbook. Rows are grouped into one sheet per note type, plus a
 * summary sheet up front.
 */
export function buildDisputePackWorkbook(params: {
  weekEnding: string;
  project: string | null;
  rows: DisputePackRow[];
}): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();

  const summary = wb.addWorksheet('Summary');
  summary.columns = [{ width: 28 }, { width: 60 }];
  summary.addRow(['Velocity Fibre — FT Deduction Dispute Pack']).font = { bold: true, size: 14 };
  summary.addRow(['Week ending', params.weekEnding]);
  summary.addRow(['Project', params.project ?? 'All projects']);
  summary.addRow(['Disputed deductions', params.rows.length]);
  summary.addRow([]);
  summary.addRow(['Evidence basis', 'FibreFlow data as of the "Evidence As Of" date per row (latest OES sync, offline-device sync, 1Map fix history, field submissions).']);

  const byNote = new Map<string, DisputePackRow[]>();
  for (const r of params.rows) {
    const list = byNote.get(r.noteCode) ?? [];
    list.push(r);
    byNote.set(r.noteCode, list);
  }
  for (const note of ['note1', 'note2', 'note3', 'note4', 'note5']) {
    const rows = byNote.get(note);
    if (rows && rows.length > 0) {
      summary.addRow([NOTE_LABELS[note] ?? note, rows.length]);
      addNoteSheet(wb, note, rows);
    }
  }

  return wb;
}
