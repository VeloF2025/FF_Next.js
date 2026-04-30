import ExcelJS from 'exceljs';
import type {
  AllRow,
  PpRow,
  PpSiteCount,
  WaOnlyRow,
  OesOnlyRow,
  TicketMap,
  TicketRow,
} from './queries';

const TICKET_BASE_URL = 'https://app.fibreflow.app/noc/tickets/';

// ARGB fills for OES status values
const OES_STATUS_FILLS: Record<string, Partial<ExcelJS.Fill>> = {
  active:       { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF16A34A' } },
  inactive:     { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6B7280' } },
  offline:      { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDC2626' } },
  provisioned:  { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3B82F6' } },
};

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' },
};
const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true, color: { argb: 'FFFFFFFF' },
};

function styleHeader(row: ExcelJS.Row): void {
  row.eachCell((cell: ExcelJS.Cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FF374151' } },
    };
  });
  row.height = 18;
}

function addTicketCells(
  row: ExcelJS.Row,
  startCol: number,
  drNumber: string | null | undefined,
  ontSerial: string | null | undefined,
  ticketMap: TicketMap
): number {
  const keys: string[] = [];
  if (drNumber) keys.push(drNumber.toUpperCase());
  if (ontSerial) keys.push(ontSerial.toUpperCase());

  const seen = new Set<string>();
  const tickets: TicketRow[] = [];
  for (const key of keys) {
    for (const t of ticketMap.get(key) ?? []) {
      if (!seen.has(t.id)) {
        seen.add(t.id);
        tickets.push(t);
      }
    }
  }

  tickets.forEach((ticket, i) => {
    const cell = row.getCell(startCol + i);
    cell.value = {
      text: ticket.ticket_uid,
      hyperlink: `${TICKET_BASE_URL}${ticket.id}`,
    };
    cell.font = { color: { argb: 'FF2563EB' }, underline: true };
  });

  return tickets.length;
}

export async function buildOesWorkbook(opts: {
  allRows: AllRow[];
  ppRows: PpRow[];
  ppSiteCounts: PpSiteCount[];
  waOnlyRows: WaOnlyRow[];
  oesOnlyRows: OesOnlyRow[];
  ticketMap: TicketMap;
  reportDate: string; // YYYY-MM-DD
}): Promise<Buffer> {
  const { allRows, ppRows, ppSiteCounts, waOnlyRows, oesOnlyRows, ticketMap } = opts;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'FibreFlow';
  wb.created = new Date();

  // ── Tab 1: All ────────────────────────────────────────────────────────────
  const sheetAll = wb.addWorksheet('All');
  const allHeaders = [
    'Drop Number', 'Serial Number', 'Timestamp', 'OLT Address',
    'ONT Rx SIG (dBm)', 'Link Budget ONT->OLT (dB)',
    'OLT Rx SIG (dBm)', 'Link Budget OLT->ONT (dB)',
    'Status', 'Latitude', 'Longitude', 'Current ONT RX', 'Team',
  ];
  sheetAll.columns = [
    { key: 'drop_number',            width: 14 },
    { key: 'serial_number',          width: 18 },
    { key: 'activation_datetime',    width: 22 },
    { key: 'olt_address',            width: 28 },
    { key: 'ont_rx_sig_dbm',         width: 18 },
    { key: 'link_budget_ont_olt_db', width: 22 },
    { key: 'olt_rx_sig_dbm',         width: 18 },
    { key: 'link_budget_olt_ont_db', width: 22 },
    { key: 'status',                 width: 14 },
    { key: 'latitude',               width: 12 },
    { key: 'longitude',              width: 12 },
    { key: 'current_ont_rx',         width: 16 },
    { key: 'team',                   width: 10 },
  ];

  // Calculate max ticket columns needed
  let maxTicketColsAll = 0;
  for (const r of allRows) {
    const count = [r.drop_number?.toUpperCase(), r.serial_number?.toUpperCase()]
      .filter(Boolean)
      .flatMap(k => ticketMap.get(k!) ?? [])
      .reduce((acc, t) => { acc.add(t.id); return acc; }, new Set<string>()).size;
    if (count > maxTicketColsAll) maxTicketColsAll = count;
  }
  for (let i = 0; i < maxTicketColsAll; i++) {
    sheetAll.getColumn(14 + i).width = 20;
  }

  const headerRowAll = sheetAll.addRow(
    maxTicketColsAll > 0
      ? [...allHeaders, ...Array.from({ length: maxTicketColsAll }, (_, i) => `Ticket ${i + 1}`)]
      : allHeaders
  );
  styleHeader(headerRowAll);

  for (const r of allRows) {
    const row = sheetAll.addRow([
      r.drop_number, r.serial_number,
      r.activation_datetime ?? r.activation_date,
      r.olt_address,
      r.ont_rx_sig_dbm, r.link_budget_ont_olt_db,
      r.olt_rx_sig_dbm, r.link_budget_olt_ont_db,
      r.status, r.latitude, r.longitude, r.current_ont_rx, r.team,
    ]);
    const statusLower = (r.status ?? '').toLowerCase();
    const fill = OES_STATUS_FILLS[statusLower];
    if (fill) {
      const statusCell = row.getCell(9);
      statusCell.fill = fill as ExcelJS.Fill;
      statusCell.font = { color: { argb: 'FFFFFFFF' }, bold: statusLower === 'active' };
    }
    addTicketCells(row, 14, r.drop_number, r.serial_number, ticketMap);
  }

  // Summary row at bottom
  const totalRowAll = sheetAll.addRow(['TOTAL', '', '', '', '', '', '', '', '', '', '', '', allRows.length.toString()]);
  totalRowAll.font = { bold: true };

  // ── Tab 2: PP ─────────────────────────────────────────────────────────────
  const sheetPp = wb.addWorksheet('PP');
  sheetPp.columns = [
    { key: 'project',         width: 18 }, // A
    { key: 'serial_number',   width: 18 }, // B
    { key: 'date_registered', width: 18 }, // C
    { key: 'empty1',          width: 4  }, // D
    { key: 'empty2',          width: 4  }, // E
    { key: 'project2',        width: 18 }, // F
    { key: 'count',           width: 10 }, // G
  ];

  let maxTicketColsPp = 0;
  for (const r of ppRows) {
    const count = [r.serial_number?.toUpperCase()]
      .filter(Boolean)
      .flatMap(k => ticketMap.get(k!) ?? [])
      .reduce((acc, t) => { acc.add(t.id); return acc; }, new Set<string>()).size;
    if (count > maxTicketColsPp) maxTicketColsPp = count;
  }
  for (let i = 0; i < maxTicketColsPp; i++) {
    sheetPp.getColumn(8 + i).width = 20;
  }

  const ppHeaders: string[] = ['Project', 'Serial', 'Date Registered', '', '', 'Project', 'Count'];
  if (maxTicketColsPp > 0) {
    ppHeaders.push(...Array.from({ length: maxTicketColsPp }, (_, i) => `Ticket ${i + 1}`));
  }
  const headerRowPp = sheetPp.addRow(ppHeaders);
  styleHeader(headerRowPp);

  const maxPpRows = Math.max(ppRows.length, ppSiteCounts.length);
  for (let i = 0; i < maxPpRows; i++) {
    const pp = ppRows[i];
    const sc = ppSiteCounts[i];
    const rowValues: (string | number | null)[] = [
      pp?.project ?? null,
      pp?.serial_number ?? null,
      pp?.date_registered ?? null,
      null,
      null,
      sc?.project ?? null,
      sc?.count ?? null,
    ];
    const row = sheetPp.addRow(rowValues);
    if (pp) {
      addTicketCells(row, 8, null, pp.serial_number, ticketMap);
    }
  }

  const totalRowPp = sheetPp.addRow([`${ppRows.length} total`, '', '', '', '', '', '']);
  totalRowPp.font = { bold: true };

  // ── Tab 3: WhatsApp Only ──────────────────────────────────────────────────
  const sheetWa = wb.addWorksheet('WhatsApp Only');
  const waHeaders = ['Drop Number', 'Installed Date', 'ONT Serial', 'Sender Phone'];

  let maxTicketColsWa = 0;
  for (const r of waOnlyRows) {
    const count = [r.drop_number?.toUpperCase(), r.ont_serial_scanned?.toUpperCase()]
      .filter(Boolean)
      .flatMap(k => ticketMap.get(k!) ?? [])
      .reduce((acc, t) => { acc.add(t.id); return acc; }, new Set<string>()).size;
    if (count > maxTicketColsWa) maxTicketColsWa = count;
  }

  sheetWa.columns = [
    { key: 'drop_number',       width: 14 },
    { key: 'submitted_date',    width: 20 },
    { key: 'ont_serial_scanned', width: 18 },
    { key: 'sender_phone',      width: 16 },
    ...Array.from({ length: maxTicketColsWa }, () => ({ width: 20 })),
  ];

  const headerRowWa = sheetWa.addRow(
    maxTicketColsWa > 0
      ? [...waHeaders, ...Array.from({ length: maxTicketColsWa }, (_, i) => `Ticket ${i + 1}`)]
      : waHeaders
  );
  styleHeader(headerRowWa);

  for (const r of waOnlyRows) {
    const row = sheetWa.addRow([r.drop_number, r.submitted_date, r.ont_serial_scanned, r.sender_phone]);
    addTicketCells(row, 5, r.drop_number, r.ont_serial_scanned, ticketMap);
  }

  // ── Tab 4: OES Only ───────────────────────────────────────────────────────
  const sheetOes = wb.addWorksheet('OES Only');
  const oesOnlyHeaders = ['Drop Number', 'Serial Number', 'Activation Date', 'Team', 'Status'];

  let maxTicketColsOes = 0;
  for (const r of oesOnlyRows) {
    const count = [r.drop_number?.toUpperCase(), r.serial_number?.toUpperCase()]
      .filter(Boolean)
      .flatMap(k => ticketMap.get(k!) ?? [])
      .reduce((acc, t) => { acc.add(t.id); return acc; }, new Set<string>()).size;
    if (count > maxTicketColsOes) maxTicketColsOes = count;
  }

  sheetOes.columns = [
    { key: 'drop_number',    width: 14 },
    { key: 'serial_number',  width: 18 },
    { key: 'activation_date', width: 18 },
    { key: 'team',           width: 10 },
    { key: 'status',         width: 14 },
    ...Array.from({ length: maxTicketColsOes }, () => ({ width: 20 })),
  ];

  const headerRowOes = sheetOes.addRow(
    maxTicketColsOes > 0
      ? [...oesOnlyHeaders, ...Array.from({ length: maxTicketColsOes }, (_, i) => `Ticket ${i + 1}`)]
      : oesOnlyHeaders
  );
  styleHeader(headerRowOes);

  for (const r of oesOnlyRows) {
    const row = sheetOes.addRow([r.drop_number, r.serial_number, r.activation_date, r.team, r.status]);
    const statusLower = (r.status ?? '').toLowerCase();
    const fill = OES_STATUS_FILLS[statusLower];
    if (fill) {
      const statusCell = row.getCell(5);
      statusCell.fill = fill as ExcelJS.Fill;
      statusCell.font = { color: { argb: 'FFFFFFFF' } };
    }
    addTicketCells(row, 6, r.drop_number, r.serial_number, ticketMap);
  }

  // ── Freeze header rows on all tabs ───────────────────────────────────────
  for (const sheet of [sheetAll, sheetPp, sheetWa, sheetOes]) {
    sheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 1, activeCell: 'A2' }];
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
