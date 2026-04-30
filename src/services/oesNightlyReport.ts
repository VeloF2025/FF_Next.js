import { log } from '@/lib/logger';
import {
  loadAllActivations,
  loadPpData,
  loadPpSiteCounts,
  loadWaOnlyRows,
  loadOesOnlyRows,
  loadFtDisputeRows,
  loadTicketsForKeys,
  loadLatestOesReportDate,
} from '@/lib/oes-report/queries';
import { buildOesWorkbook } from '@/lib/oes-report/buildWorkbook';
import { uploadOesReport } from '@/lib/oes-report/storage';
import { sendWhatsAppGroupDocument } from '@/modules/notifications/services/whatsappDelivery';

const OES_ACTIVATIONS_GROUP_JID =
  process.env.OES_ACTIVATIONS_WA_GROUP_JID ?? '120363321969740151@g.us';

export interface OesReportResult {
  reportDate: string;
  url: string;
  sizeBytes: number;
  rowCounts: {
    all: number;
    pp: number;
    waOnly: number;
    oesOnly: number;
    ftDispute: number;
  };
  ticketsLinked: number;
  durationMs: number;
}

export async function runNightlyOesReport(opts: {
  date?: string;
  dryRun?: boolean;
}): Promise<OesReportResult> {
  const start = Date.now();

  // Date comes from the latest OES import batch's report_date — the date Fibertime
  // published the file on SharePoint, not today's date.
  const reportDate = opts.date ?? await loadLatestOesReportDate();

  log.info('OES nightly report: loading data', { date: reportDate, dryRun: opts.dryRun }, 'OesNightlyReport');

  const [allRows, ppRows, ppSiteCounts, waOnlyRows, oesOnlyRows, ftDisputeRows] = await Promise.all([
    loadAllActivations(),
    loadPpData(),
    loadPpSiteCounts(),
    loadWaOnlyRows(),
    loadOesOnlyRows(),
    loadFtDisputeRows(),
  ]);

  log.info('OES nightly report: data loaded', {
    all: allRows.length, pp: ppRows.length,
    waOnly: waOnlyRows.length, oesOnly: oesOnlyRows.length,
    ftDispute: ftDisputeRows.length,
  }, 'OesNightlyReport');

  // Collect keys for ticket lookup
  const drNumbers = [
    ...allRows.map(r => r.drop_number),
    ...waOnlyRows.map(r => r.drop_number),
    ...oesOnlyRows.map(r => r.drop_number),
    ...ftDisputeRows.map(r => r.drop_number),
  ].filter(Boolean) as string[];

  const ontSerials = [
    ...allRows.map(r => r.serial_number),
    ...ppRows.map(r => r.serial_number),
    ...waOnlyRows.map(r => r.ont_serial_scanned),
    ...oesOnlyRows.map(r => r.serial_number),
    ...ftDisputeRows.map(r => r.serial_number),
  ].filter(Boolean) as string[];

  const ticketMap = await loadTicketsForKeys(
    [...new Set(drNumbers)],
    [...new Set(ontSerials)]
  );

  const ticketsLinked = ticketMap.size;

  log.info('OES nightly report: tickets loaded', { ticketsLinked }, 'OesNightlyReport');

  const buffer = await buildOesWorkbook({
    allRows, ppRows, ppSiteCounts, waOnlyRows, oesOnlyRows, ftDisputeRows, ticketMap, reportDate,
  });

  const url = await uploadOesReport(buffer, reportDate);
  log.info('OES nightly report: uploaded', { url, sizeBytes: buffer.length }, 'OesNightlyReport');

  if (!opts.dryRun) {
    const filename = `OES-Report-${reportDate}.xlsx`;
    const caption = `*OES Daily Report — ${reportDate}*\nAll: ${allRows.length} | PP: ${ppRows.length} | WA anomaly: ${waOnlyRows.length} | OES anomaly: ${oesOnlyRows.length} | FT Dispute: ${ftDisputeRows.length}`;
    try {
      await sendWhatsAppGroupDocument(OES_ACTIVATIONS_GROUP_JID, url, filename, caption);
      log.info('OES nightly report: sent to WA group', { group: OES_ACTIVATIONS_GROUP_JID }, 'OesNightlyReport');
    } catch (waErr) {
      // WA failure is non-fatal — file is already in storage
      log.error('OES nightly report: WA send failed (file still uploaded)', {
        error: waErr instanceof Error ? waErr.message : String(waErr),
        url,
      }, 'OesNightlyReport');
    }
  }

  return {
    reportDate,
    url,
    sizeBytes: buffer.length,
    rowCounts: {
      all: allRows.length,
      pp: ppRows.length,
      waOnly: waOnlyRows.length,
      oesOnly: oesOnlyRows.length,
      ftDispute: ftDisputeRows.length,
    },
    ticketsLinked,
    durationMs: Date.now() - start,
  };
}
