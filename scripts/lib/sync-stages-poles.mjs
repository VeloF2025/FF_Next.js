/**
 * Pole-count fallback for scripts/sync-stages.mjs.
 *
 * `syncSite` normally derives pole scope and progress from `drops` —
 * `COUNT(DISTINCT drops.pole_number)` for the totals and `drops LEFT JOIN poles`
 * for planted/CWC. Some projects (Thembisa POP 1, POP 3, Themb'elihle as of
 * 2026-08-27) carry no `drops.pole_number` at all, so every pole figure lands at
 * zero even though `poles` holds the data keyed by `zone_no, pon_no`.
 *
 * The switch is deliberately per project, never per PON: `poles` OVER-counts for
 * projects whose drops do carry the link (Lawley: 4,937 rows in `poles` vs 2,994
 * distinct poles reachable through drops), so blending the two sources would
 * inflate those projects. Only a project with no pole link anywhere falls back.
 */

/**
 * Should this project take its pole counts from the `poles` table?
 *
 * True only when the drops-derived per-PON rows exist but not one of them links
 * a pole — i.e. the normal source is empty for the whole project.
 *
 * @param {Array<{ poles: unknown }>} dropsRows Per-PON rows from the drops totals query.
 * @returns {boolean}
 */
export function shouldUsePolesTable(dropsRows) {
  if (dropsRows.length === 0) return false;
  return dropsRows.every(row => Number(row.poles) === 0);
}

/**
 * @typedef {object} PoleFallbackRow
 * @property {number | string} zone_no
 * @property {number | string} pon_no
 * @property {number | string} poles Distinct poles in the PON.
 * @property {number | string} planted Distinct poles with pole_planted = 'Pole Planted'.
 * @property {number | string} cwc Distinct poles with audit_complete set.
 * @property {string | null} cwc_first Earliest audit_complete in the PON.
 * @property {string | null} cwc_last Latest audit_complete in the PON.
 */

/**
 * Merge `poles`-derived counts into the per-PON aggregates.
 *
 * Rows whose PON is absent from `ponMap` are skipped — a PON can hold poles with
 * no drops at all, and `pon_stage_tracking` scope is defined by the drops sweep
 * (the same rule the joints merge follows).
 *
 * Pure — no database access — so each branch is directly testable.
 *
 * @param {Map<string, { permissions: { total: number }, poles: { total: number, complete: number }, cwc: { total: number, complete: number, firstDate: string | null, lastDate: string | null } }>} ponMap
 * @param {PoleFallbackRow[]} rows
 * @returns {{ pons: number, planted: number, cwc: number }} What the merge applied, for the run log.
 */
export function applyPoleFallback(ponMap, rows) {
  let pons = 0;
  let planted = 0;
  let cwc = 0;

  for (const row of rows) {
    const agg = ponMap.get(`${row.zone_no}-${row.pon_no}`);
    if (!agg) continue;

    const polesTotal = Number(row.poles);
    const polesPlanted = Number(row.planted);
    const cwcComplete = Number(row.cwc);

    agg.permissions.total = polesTotal;
    agg.poles.total = polesTotal;
    agg.cwc.total = polesTotal;
    agg.poles.complete = polesPlanted;
    agg.cwc.complete = cwcComplete;
    agg.cwc.firstDate = row.cwc_first;
    agg.cwc.lastDate = row.cwc_last;

    pons++;
    planted += polesPlanted;
    cwc += cwcComplete;
  }

  return { pons, planted, cwc };
}
