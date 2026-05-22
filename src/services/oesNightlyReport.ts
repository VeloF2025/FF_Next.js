import { log } from '@/lib/logger';
import {
  loadAllActivations,
  loadPpData,
  loadFtDisputeRows,
  loadTicketsForKeys,
  loadLatestOesReportDate,
} from '@/lib/oes-report/queries';
import {
  loadPpNotFoundRows,
  loadPpLinkedAwaitingRows,
  loadFtDisputeDefiniteRows,
  loadFtDisputeLifecycleRows,
} from '@/lib/oes-report/queriesV2';
import { loadDailySummary } from '@/lib/oes-report/dailySummaryQueries';
import { buildOesWorkbook } from '@/lib/oes-report/buildWorkbook';
import { uploadOesReport } from '@/lib/oes-report/storage';
import { isOntLifecycleV2Enabled } from '@/lib/featureFlags';
import { sendWhatsAppGroupDocument } from '@/modules/notifications/services/whatsappDelivery';

const OES_ACTIVATIONS_GROUP_JID =
  process.env.OES_ACTIVATIONS_WA_GROUP_JID ?? '120363321969740151@g.us';

export interface OesReportResult {
  reportDate: string;
  url: string;
  sizeBytes: number;
  rowCounts: {
    activations: number;
    pp: number;
    ftDispute: number;
    /** V2 only — definite OLT-Active disputes */
    ftDisputeDefinite?: number;
    /** V2 only — lifecycle (ever-activated, no decommission) disputes */
    ftDisputeLifecycle?: number;
  };
  ticketsLinked: number;
  durationMs: number;
}

export async function runNightlyOesReport(opts: {
  date?: string;
  dryRun?: boolean;
}): Promise<OesReportResult> {
  const start = Date.now();
  const lifecycleV2 = isOntLifecycleV2Enabled();

  // Date comes from the latest OES import batch's report_date — the date Fibertime
  // published the file on SharePoint, not today's date.
  const reportDate = opts.date ?? await loadLatestOesReportDate();

  log.info('OES nightly report: loading data', {
    date: reportDate,
    dryRun: opts.dryRun,
    lifecycleV2,
  }, 'OesNightlyReport');

  if (lifecycleV2) {
    // ── V2 path: load the four split datasets in parallel ───────────────────
    const [allRows, dailySummary, ppNotFoundRows, ppLinkedAwaitingRows, ftDisputeDefiniteRows, ftDisputeLifecycleRows] =
      await Promise.all([
        loadAllActivations(),
        loadDailySummary(reportDate),
        loadPpNotFoundRows(),
        loadPpLinkedAwaitingRows(),
        loadFtDisputeDefiniteRows(),
        loadFtDisputeLifecycleRows(),
      ]);

    log.info('OES nightly report: data loaded (v2)', {
      activations: allRows.length,
      ppNotFound: ppNotFoundRows.length,
      ppLinkedAwaiting: ppLinkedAwaitingRows.length,
      ftDisputeDefinite: ftDisputeDefiniteRows.length,
      ftDisputeLifecycle: ftDisputeLifecycleRows.length,
    }, 'OesNightlyReport');

    const drNumbers = [
      ...allRows.map(r => r.drop_number),
      ...ppLinkedAwaitingRows.map(r => r.resolved_drop_number),
      ...ftDisputeDefiniteRows.map(r => r.drop_number),
      ...ftDisputeLifecycleRows.map(r => r.drop_number),
    ].filter(Boolean) as string[];

    const ontSerials = [
      ...allRows.map(r => r.serial_number),
      ...ppNotFoundRows.map(r => r.serial_number),
      ...ppLinkedAwaitingRows.map(r => r.serial_number),
      ...ftDisputeDefiniteRows.map(r => r.serial_number),
      ...ftDisputeLifecycleRows.map(r => r.serial_number),
    ].filter(Boolean) as string[];

    const ticketMap = await loadTicketsForKeys(
      [...new Set(drNumbers)],
      [...new Set(ontSerials)],
    );
    const ticketsLinked = ticketMap.size;

    log.info('OES nightly report: tickets loaded (v2)', { ticketsLinked }, 'OesNightlyReport');

    const buffer = await buildOesWorkbook({
      lifecycleV2: true,
      allRows,
      dailySummary,
      ticketMap,
      reportDate,
      ppNotFoundRows,
      ppLinkedAwaitingRows,
      ftDisputeDefiniteRows,
      ftDisputeLifecycleRows,
    });

    const url = await uploadOesReport(buffer, reportDate);
    log.info('OES nightly report: uploaded (v2)', { url, sizeBytes: buffer.length }, 'OesNightlyReport');

    if (!opts.dryRun) {
      const filename = `OES-Report-${reportDate}.xlsx`;
      const ppTotal = ppNotFoundRows.length + ppLinkedAwaitingRows.length;
      const caption =
        `*OES Daily Report — ${reportDate}*\n` +
        `Activations: ${allRows.length} | PP: ${ppTotal} ` +
        `(${ppNotFoundRows.length} not found, ${ppLinkedAwaitingRows.length} linked awaiting)\n` +
        `FT Dispute — Definite: ${ftDisputeDefiniteRows.length} | ` +
        `Lifecycle: ${ftDisputeLifecycleRows.length}`;
      try {
        await sendWhatsAppGroupDocument(OES_ACTIVATIONS_GROUP_JID, url, filename, caption);
        log.info('OES nightly report: sent to WA group (v2)', {
          group: OES_ACTIVATIONS_GROUP_JID,
        }, 'OesNightlyReport');
      } catch (waErr) {
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
        activations: allRows.length,
        pp: ppNotFoundRows.length + ppLinkedAwaitingRows.length,
        ftDispute: ftDisputeDefiniteRows.length + ftDisputeLifecycleRows.length,
        ftDisputeDefinite: ftDisputeDefiniteRows.length,
        ftDisputeLifecycle: ftDisputeLifecycleRows.length,
      },
      ticketsLinked,
      durationMs: Date.now() - start,
    };
  }

  // ── Legacy path (flag OFF) — single Promise.all matches pre-PR master ────────
  const [allRows, ppRows, ftDisputeRows, dailySummary] = await Promise.all([
    loadAllActivations(),
    loadPpData(),
    loadFtDisputeRows(),
    loadDailySummary(reportDate),
  ]);

  log.info('OES nightly report: data loaded', {
    activations: allRows.length,
    pp: ppRows.length,
    ftDispute: ftDisputeRows.length,
  }, 'OesNightlyReport');

  const drNumbers = [
    ...allRows.map(r => r.drop_number),
    ...ppRows.map(r => r.resolved_drop_number),
    ...ftDisputeRows.map(r => r.drop_number),
  ].filter(Boolean) as string[];

  const ontSerials = [
    ...allRows.map(r => r.serial_number),
    ...ppRows.map(r => r.serial_number),
    ...ftDisputeRows.map(r => r.serial_number),
  ].filter(Boolean) as string[];

  const ticketMap = await loadTicketsForKeys(
    [...new Set(drNumbers)],
    [...new Set(ontSerials)],
  );
  const ticketsLinked = ticketMap.size;

  log.info('OES nightly report: tickets loaded', { ticketsLinked }, 'OesNightlyReport');

  const buffer = await buildOesWorkbook({
    lifecycleV2: false,
    allRows,
    ppRows,
    ftDisputeRows,
    dailySummary,
    ticketMap,
    reportDate,
  });

  const url = await uploadOesReport(buffer, reportDate);
  log.info('OES nightly report: uploaded', { url, sizeBytes: buffer.length }, 'OesNightlyReport');

  if (!opts.dryRun) {
    const filename = `OES-Report-${reportDate}.xlsx`;
    const caption =
      `*OES Daily Report — ${reportDate}*\n` +
      `Activations: ${allRows.length} | PP: ${ppRows.length} | FT Dispute: ${ftDisputeRows.length}`;
    try {
      await sendWhatsAppGroupDocument(OES_ACTIVATIONS_GROUP_JID, url, filename, caption);
      log.info('OES nightly report: sent to WA group', {
        group: OES_ACTIVATIONS_GROUP_JID,
      }, 'OesNightlyReport');
    } catch (waErr) {
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
      activations: allRows.length,
      pp: ppRows.length,
      ftDispute: ftDisputeRows.length,
    },
    ticketsLinked,
    durationMs: Date.now() - start,
  };
}
