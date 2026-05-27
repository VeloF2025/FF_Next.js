import ExcelJS from 'exceljs';
import type {
  AllRow,
  PpRow,
  FtDisputeRow,
  TicketMap,
  TicketRow,
} from './queries';
import type {
  NotFoundRow,
  LinkedAwaitingRow,
  FtDisputeDefiniteRow,
  FtDisputeLifecycleRow,
} from './queriesV2';
import type { DailySummary } from './dailySummaryQueries';
import { addFtDisputeSheet } from './ftDisputeSheet';
import { addDailySummarySheet } from './dailySummarySheet';
import { addPpNotFoundSheet, addPpLinkedAwaitingSheet } from './ppSheetsV2';
import { addFtDisputeDefiniteSheet, addFtDisputeLifecycleSheet } from './ftDisputeSheetsV2';

const TICKET_BASE_URL = 'https://app.fibreflow.app/noc/tickets/';

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
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF374151' } } };
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

function maxTicketsFor(
  rows: Array<{ dr?: string | null; serial?: string | null }>,
  ticketMap: TicketMap,
): number {
  let max = 0;
  for (const r of rows) {
    const count = [r.dr?.toUpperCase(), r.serial?.toUpperCase()]
      .filter(Boolean)
      .flatMap(k => ticketMap.get(k!) ?? [])
      .reduce((acc, t) => { acc.add(t.id); return acc; }, new Set<string>()).size;
    if (count > max) max = count;
  }
  return max;
}

/** Base opts shared by both flag paths. */
interface BuildWorkbookBaseOpts {
  allRows: AllRow[];
  dailySummary: DailySummary;
  ticketMap: TicketMap;
  reportDate: string;
}

/** Flag-off opts (legacy 4-tab layout). */
interface BuildWorkbookLegacyOpts extends BuildWorkbookBaseOpts {
  lifecycleV2: false;
  ppRows: PpRow[];
  ftDisputeRows: FtDisputeRow[];
}

/** Flag-on opts (6-tab lifecycle layout). */
interface BuildWorkbookV2Opts extends BuildWorkbookBaseOpts {
  lifecycleV2: true;
  ppNotFoundRows: NotFoundRow[];
  ppLinkedAwaitingRows: LinkedAwaitingRow[];
  ppActivatedRows: LinkedAwaitingRow[];
  ftDisputeDefiniteRows: FtDisputeDefiniteRow[];
  ftDisputeLifecycleRows: FtDisputeLifecycleRow[];
}

type BuildWorkbookOpts = BuildWorkbookLegacyOpts | BuildWorkbookV2Opts;

export async function buildOesWorkbook(opts: BuildWorkbookOpts): Promise<Buffer> {
  const { allRows, dailySummary, ticketMap } = opts;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'FibreFlow';
  wb.created = new Date();

  // ── Tab 1: Daily Summary ─────────────────────────────────────────────────
  const sheetSummary = addDailySummarySheet(wb, dailySummary);

  // ── Tab 2: Activations ───────────────────────────────────────────────────
  const sheetAct = wb.addWorksheet('Activations');
  const actHeaders = [
    'Drop Number', 'Serial Number', 'Timestamp', 'OLT Address',
    'ONT Rx SIG (dBm)', 'Link Budget ONT->OLT (dB)',
    'OLT Rx SIG (dBm)', 'Link Budget OLT->ONT (dB)',
    'Status', 'Latitude', 'Longitude', 'Current ONT RX', 'Team',
  ];
  sheetAct.columns = [
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

  const maxTicketColsAct = maxTicketsFor(
    allRows.map(r => ({ dr: r.drop_number, serial: r.serial_number })),
    ticketMap,
  );
  for (let i = 0; i < maxTicketColsAct; i++) {
    sheetAct.getColumn(14 + i).width = 20;
  }

  styleHeader(sheetAct.addRow(
    maxTicketColsAct > 0
      ? [...actHeaders, ...Array.from({ length: maxTicketColsAct }, (_, i) => `Ticket ${i + 1}`)]
      : actHeaders
  ));

  for (const r of allRows) {
    const row = sheetAct.addRow([
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

  const totalRowAct = sheetAct.addRow(
    ['TOTAL', '', '', '', '', '', '', '', '', '', '', '', allRows.length.toString()]
  );
  totalRowAct.font = { bold: true };

  // ── Tabs 3–6: flag-gated layout ─────────────────────────────────────────
  // Flag OFF (legacy): Tab 3 = PP's, Tab 4 = FT Dispute (unchanged).
  // Flag ON  (v2):     Tab 3 = PP — Not Found, Tab 4 = PP — Linked Awaiting,
  //                    Tab 5 = FT Dispute — Definite, Tab 6 = FT Dispute — Lifecycle.

  let ppAndDisputeSheets: ExcelJS.Worksheet[];

  if (!opts.lifecycleV2) {
    // ── Flag OFF: legacy 4-tab layout ──────────────────────────────────────
    const { ppRows, ftDisputeRows } = opts;

    const sheetPp = wb.addWorksheet("PP's");
    const ppHeaders = [
      'Project', 'Serial', 'Date Registered', 'Status', 'Matched Drop',
    ];
    sheetPp.columns = [
      { key: 'project',              width: 16 },
      { key: 'serial_number',        width: 18 },
      { key: 'date_registered',      width: 18 },
      { key: 'resolution_status',    width: 16 },
      { key: 'resolved_drop_number', width: 16 },
    ];

    const maxTicketColsPp = maxTicketsFor(
      ppRows.map(r => ({ dr: r.resolved_drop_number, serial: r.serial_number })),
      ticketMap,
    );
    for (let i = 0; i < maxTicketColsPp; i++) {
      sheetPp.getColumn(6 + i).width = 20;
    }

    styleHeader(sheetPp.addRow(
      maxTicketColsPp > 0
        ? [...ppHeaders, ...Array.from({ length: maxTicketColsPp }, (_, i) => `Ticket ${i + 1}`)]
        : ppHeaders
    ));

    for (const r of ppRows) {
      const row = sheetPp.addRow([
        r.project, r.serial_number, r.date_registered,
        r.resolution_status, r.resolved_drop_number,
      ]);
      addTicketCells(row, 6, r.resolved_drop_number, r.serial_number, ticketMap);
    }

    const totalRowPp = sheetPp.addRow([`${ppRows.length} total`, '', '', '', '']);
    totalRowPp.font = { bold: true };

    const sheetDisp = addFtDisputeSheet(wb, ftDisputeRows, ticketMap);
    ppAndDisputeSheets = [sheetPp, sheetDisp];

  } else {
    // ── Flag ON: 6-tab lifecycle layout ────────────────────────────────────
    const {
      ppNotFoundRows,
      ppLinkedAwaitingRows,
      ppActivatedRows,
      ftDisputeDefiniteRows,
      ftDisputeLifecycleRows,
    } = opts;

    const sheetNotFound   = addPpNotFoundSheet(wb, ppNotFoundRows);
    const sheetLinked     = addPpLinkedAwaitingSheet(wb, ppLinkedAwaitingRows, ppActivatedRows);
    const sheetDefinite   = addFtDisputeDefiniteSheet(wb, ftDisputeDefiniteRows, ticketMap);
    const sheetLifecycle  = addFtDisputeLifecycleSheet(wb, ftDisputeLifecycleRows, ticketMap);
    ppAndDisputeSheets = [sheetNotFound, sheetLinked, sheetDefinite, sheetLifecycle];
  }

  // ── Freeze header rows on all tabs ───────────────────────────────────────
  for (const sheet of [sheetSummary, sheetAct, ...ppAndDisputeSheets]) {
    sheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 1, activeCell: 'A2' }];
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
