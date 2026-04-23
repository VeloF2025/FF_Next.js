/**
 * ISO-week Monday helper — shared by the reconcile orchestrator (cron-side
 * week grouping) and the weekly-locks module (UI + API-side week gating).
 *
 * Pure, no DB, no timezone dependency: the input is a SAST calendar day
 * (`YYYY-MM-DD`) and parsing `YYYY-MM-DDT00:00:00Z` gives midnight UTC on
 * the same calendar day as midnight SAST (SAST is UTC+2, stable weekday).
 *
 * Two implementations of this existed pre-hardening (reconcile.ts + the
 * corrections-module lockQueries.ts); drift between them could silently
 * misassign lock weeks vs. cron week groupings. Consolidating here —
 * both modules import this one.
 */

export function isoWeekMonday(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    throw new Error(`isoWeekMonday: invalid YYYY-MM-DD input '${ymd}'`);
  }
  const d = new Date(`${ymd}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`isoWeekMonday: unparseable date '${ymd}'`);
  }
  const dow = d.getUTCDay(); // 0 Sun..6 Sat
  const deltaToMon = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + deltaToMon);
  return d.toISOString().slice(0, 10);
}
