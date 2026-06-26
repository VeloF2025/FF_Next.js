/**
 * Orchestrator for the per-group daily non-activation + PP report.
 *
 * Builds one workbook per target group that had submissions on `cohortDate`.
 * PR2 scope: build only (no upload/send). PR3 wires delivery + the consolidated
 * ops view + the nightly re-resolve.
 *
 * @module services/groupNonActivationReport
 */
import { log } from '@/lib/logger';
import {
  getTargetGroups,
  getCohort,
  getBacklog,
  getPpList,
  ppProjectFor,
} from '@/lib/group-nonactivation/queries';
import { buildGroupWorkbook, type GroupReportCounts } from '@/lib/group-nonactivation/buildWorkbook';
import { addDaysIso } from '@/lib/group-nonactivation/format';
import { groupCaption, sendGroupReport, sendOpsReport } from '@/lib/group-nonactivation/delivery';
import { getConsolidatedNotFound } from '@/lib/group-nonactivation/opsQueries';
import { buildOpsWorkbook } from '@/lib/group-nonactivation/buildOpsWorkbook';

export interface GroupReportResult {
  groupJid: string;
  groupName: string;
  project: string | null;
  counts: GroupReportCounts;
  /** xlsx bytes for the group, ready to upload/send in PR3. */
  buffer: Buffer;
}

export interface BuildReportsOpts {
  /** Cohort day (YYYY-MM-DD, SAST) — the "yesterday" being reported on. */
  cohortDate: string;
  /** Report generation day (YYYY-MM-DD, SAST) — drives aging. */
  generatedDate: string;
  /** Backlog look-back window in days (inclusive of the day before cohortDate). Default 14. */
  backlogDays?: number;
}

/**
 * Build the per-group workbooks. Groups with no submissions on `cohortDate` are
 * skipped (no sheet). Returns one result per group that produced a workbook.
 */
export async function buildGroupNonActivationReports(
  opts: BuildReportsOpts,
): Promise<GroupReportResult[]> {
  const backlogDays = opts.backlogDays ?? 14;
  // Look back `backlogDays` calendar days immediately before the cohort day
  // (e.g. cohort 06-25, 14 days → 06-11…06-24 inclusive).
  const backlogFrom = addDaysIso(opts.cohortDate, -backlogDays);
  const backlogTo = addDaysIso(opts.cohortDate, -1);

  const groups = await getTargetGroups();
  const results: GroupReportResult[] = [];

  for (const group of groups) {
    const cohort = await getCohort(group.groupJid, opts.cohortDate);
    if (cohort.length === 0) continue; // a group gets a sheet only if it submitted that day

    const backlog = await getBacklog(group.groupJid, backlogFrom, backlogTo);
    if (group.showPp && !group.project) {
      log.warn(
        'Activations group has no project_name — PP tab will be empty',
        { group: group.groupName, groupJid: group.groupJid },
        'GroupNonActivationReport',
      );
    }
    const ppList = group.showPp ? await getPpList(ppProjectFor(group.project), opts.cohortDate) : [];

    const { buffer, counts } = await buildGroupWorkbook({
      group,
      cohort,
      backlog,
      ppList,
      cohortDate: opts.cohortDate,
      generatedDate: opts.generatedDate,
    });

    results.push({
      groupJid: group.groupJid,
      groupName: group.groupName,
      project: group.project,
      counts,
      buffer,
    });
    log.info('Group non-activation report built', { group: group.groupName, ...counts }, 'GroupNonActivationReport');
  }

  return results;
}

export interface RunReportResult {
  cohortDate: string;
  generatedDate: string;
  dryRun: boolean;
  groups: { groupName: string; counts: GroupReportCounts; sent: boolean; url: string | null }[];
  ops: { totalNotFound: number; sent: boolean; url: string | null };
}

/**
 * Build and (unless dryRun) deliver: one workbook per group to its WhatsApp
 * group, plus the consolidated "Unresolved Pre-Provision" worklist to the
 * reconciliation hub. dryRun builds but sends nothing.
 */
export async function runGroupNonActivationReport(opts: {
  cohortDate: string;
  generatedDate: string;
  dryRun?: boolean;
  backlogDays?: number;
}): Promise<RunReportResult> {
  const dryRun = opts.dryRun ?? false;
  const built = await buildGroupNonActivationReports({
    cohortDate: opts.cohortDate,
    generatedDate: opts.generatedDate,
    backlogDays: opts.backlogDays,
  });

  const groups: RunReportResult['groups'] = [];
  for (const r of built) {
    let url: string | null = null;
    if (!dryRun) {
      const caption = groupCaption(r.groupName, r.project, opts.cohortDate, r.counts);
      url = await sendGroupReport(r.groupJid, r.groupName, opts.cohortDate, r.buffer, caption);
      log.info('Group non-activation report sent', { group: r.groupName }, 'GroupNonActivationReport');
    }
    groups.push({ groupName: r.groupName, counts: r.counts, sent: !dryRun, url });
  }

  const opsRows = await getConsolidatedNotFound(opts.generatedDate);
  let opsUrl: string | null = null;
  let opsSent = false;
  if (!dryRun && opsRows.length > 0) {
    const opsBuffer = await buildOpsWorkbook(opsRows, opts.generatedDate);
    opsUrl = await sendOpsReport(opts.generatedDate, opsRows.length, opsBuffer);
    opsSent = true;
    log.info('Unresolved PP ops view sent', { total: opsRows.length }, 'GroupNonActivationReport');
  }

  return {
    cohortDate: opts.cohortDate,
    generatedDate: opts.generatedDate,
    dryRun,
    groups,
    ops: { totalNotFound: opsRows.length, sent: opsSent, url: opsUrl },
  };
}
