import ExcelJS from 'exceljs';
import type { FtDisputeRow, TicketMap, TicketRow } from './queries';

const TICKET_BASE_URL = 'https://app.fibreflow.app/noc/tickets/';

const OES_STATUS_FILLS: Record<string, Partial<ExcelJS.Fill>> = {
  active:      { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF16A34A' } },
  inactive:    { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6B7280' } },
  offline:     { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDC2626' } },
  provisioned: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3B82F6' } },
};

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' },
};

function styleHeader(row: ExcelJS.Row): void {
  row.eachCell((cell: ExcelJS.Cell) => {
    cell.fill = HEADER_FILL;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF374151' } } };
  });
  row.height = 18;
}

function addTicketCells(
  row: ExcelJS.Row,
  startCol: number,
  drNumber: string | null | undefined,
  ontSerial: string | null | undefined,
  ticketMap: TicketMap,
): void {
  const keys: string[] = [];
  if (drNumber) keys.push(drNumber.toUpperCase());
  if (ontSerial) keys.push(ontSerial.toUpperCase());

  const seen = new Set<string>();
  const tickets: TicketRow[] = [];
  for (const key of keys) {
    for (const t of ticketMap.get(key) ?? []) {
      if (!seen.has(t.id)) { seen.add(t.id); tickets.push(t); }
    }
  }
  tickets.forEach((ticket, i) => {
    const cell = row.getCell(startCol + i);
    cell.value = { text: ticket.ticket_uid, hyperlink: `${TICKET_BASE_URL}${ticket.id}` };
    cell.font = { color: { argb: 'FF2563EB' }, underline: true };
  });
}

const DISPUTE_FILL: ExcelJS.Fill = {
  type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' },
};

const HEADERS = [
  'Serial Number', 'Project', 'PP Date Registered',
  'Drop Number', 'Activation Date', 'Team', 'OES Status',
];

export function addFtDisputeSheet(
  wb: ExcelJS.Workbook,
  ftDisputeRows: FtDisputeRow[],
  ticketMap: TicketMap,
): ExcelJS.Worksheet {
  const sheet = wb.addWorksheet('FT Dispute');

  let maxTicketCols = 0;
  for (const r of ftDisputeRows) {
    const count = [r.drop_number?.toUpperCase(), r.serial_number?.toUpperCase()]
      .filter(Boolean)
      .flatMap(k => ticketMap.get(k!) ?? [])
      .reduce((acc, t) => { acc.add(t.id); return acc; }, new Set<string>()).size;
    if (count > maxTicketCols) maxTicketCols = count;
  }

  sheet.columns = [
    { key: 'serial_number',   width: 18 },
    { key: 'project',         width: 18 },
    { key: 'date_registered', width: 20 },
    { key: 'drop_number',     width: 14 },
    { key: 'activation_date', width: 18 },
    { key: 'team',            width: 10 },
    { key: 'status',          width: 14 },
    ...Array.from({ length: maxTicketCols }, () => ({ width: 20 })),
  ];

  styleHeader(sheet.addRow(
    maxTicketCols > 0
      ? [...HEADERS, ...Array.from({ length: maxTicketCols }, (_, i) => `Ticket ${i + 1}`)]
      : HEADERS
  ));

  for (const r of ftDisputeRows) {
    const row = sheet.addRow([
      r.serial_number, r.project, r.date_registered,
      r.drop_number, r.activation_date, r.team, r.activation_status,
    ]);
    row.eachCell((cell: ExcelJS.Cell) => { cell.fill = DISPUTE_FILL; });
    const fill = OES_STATUS_FILLS[(r.activation_status ?? '').toLowerCase()];
    if (fill) {
      sheet.getRow(row.number).getCell(7).fill = fill as ExcelJS.Fill;
      sheet.getRow(row.number).getCell(7).font = { color: { argb: 'FFFFFFFF' } };
    }
    addTicketCells(row, 8, r.drop_number, r.serial_number, ticketMap);
  }

  const totalRow = sheet.addRow([`${ftDisputeRows.length} to dispute`, '', '', '', '', '', '']);
  totalRow.font = { bold: true, color: { argb: 'FFDC2626' } };

  return sheet;
}
