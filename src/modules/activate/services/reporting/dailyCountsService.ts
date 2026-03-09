/**
 * Daily Counts with Zone/PON Breakdown
 */

import { log } from '@/lib/logger';
import { pool } from './_shared';
import type {
  DailyCountsResponse,
  ProjectDailyCount,
  AnomalyCounts,
} from '../../types/reporting.types';

/**
 * Get daily DR counts with zone/PON breakdown
 *
 * CORRECTED LOGIC (Jan 2026):
 * - INSTALLED: First WA submission only (from dr_photo_unified_reviews.submitted_date)
 *   Resubmissions are NOT counted again - only the first occurrence
 * - ACTIVATED: First OES appearance only (from oes_activations.activation_date)
 *   Uses OES date, INDEPENDENT of WA submission date
 * - REVIEWED: feedback_sent = true (QA has reviewed and sent feedback)
 * - NOT REVIEWED: feedback_sent = false or null
 *
 * ANOMALIES (for Reports tab):
 * - wa_only: Installed but not activated (may need maintenance ticket)
 * - oes_only: Activated but not installed (forgot to add to WA group?)
 *
 * Groups hierarchically: Project -> Zone -> PON
 */
export async function getDailyCountsWithBreakdown(
  dateFrom: string,
  dateTo: string,
  project?: string
): Promise<DailyCountsResponse> {
  try {
    log.info('Getting daily counts with breakdown', {
      dateFrom,
      dateTo,
      project,
    }, 'ReportingService');

    // Query 1: Get INSTALLED DRs with reviewed/notReviewed status
    // Uses dr_photo_unified_reviews.submitted_date (first submission date, preserved on resubmission)
    // Includes pole_no for pole-level breakdown and DR-level details
    // CRITICAL: INNER JOIN to drops - only count DRs that exist in SOW-imported drops table
    // DRs not in drops (like incorrect DR numbers) should NOT be counted
    // MUST match drops.ts getProjectStats logic: same date field, same filters
    const installedResult = await pool.query(
      `
      SELECT
        upr.drop_number,
        upr.project,
        COALESCE(d.zone_no, 0) as zone_no,
        COALESCE(d.pon_no, 0) as pon_no,
        d.pole_number as pole_no,
        CASE
          WHEN upr.feedback_sent = true THEN true
          ELSE false
        END as is_reviewed,
        upr.submitted_date as installed_at,
        upr.qa_decision
      FROM dr_photo_unified_reviews upr
      INNER JOIN drops d ON d.drop_number = upr.drop_number
      WHERE upr.submitted_date >= $1::DATE
        AND upr.submitted_date <= $2::DATE
        AND (upr.is_oes_only = FALSE OR upr.is_oes_only IS NULL)
        AND ($3::TEXT IS NULL OR upr.project = $3)
        AND COALESCE(upr.project, '') NOT IN ('Marketing', 'Marketing Activations', 'Unknown')
      `,
      [dateFrom, dateTo, project || null]
    );

    // Query 2: Get ACTIVATED DRs from OES (independent date context)
    // Uses oes_activations.activation_date (when ONT was activated on OES)
    // Includes pole_no for pole-level breakdown
    // CRITICAL: INNER JOIN to drops - only count DRs that exist in SOW-imported drops table
    // For project filter: use upr.project if WA submission exists, otherwise use drops->projects
    const activatedResult = await pool.query(
      `
      SELECT DISTINCT
        oes.drop_number,
        COALESCE(upr.project, p.project_name, 'Unknown') as project,
        COALESCE(d.zone_no, 0) as zone_no,
        COALESCE(d.pon_no, 0) as pon_no,
        d.pole_number as pole_no
      FROM oes_activations oes
      INNER JOIN drops d ON d.drop_number = oes.drop_number
      LEFT JOIN projects p ON p.id = d.project_id
      LEFT JOIN dr_photo_unified_reviews upr ON upr.drop_number = oes.drop_number
      WHERE oes.activation_date >= $1::DATE
        AND oes.activation_date <= $2::DATE
        AND ($3::TEXT IS NULL OR upr.project = $3 OR p.project_name = $3)
        AND COALESCE(upr.project, p.project_name, '') NOT IN ('Marketing', 'Marketing Activations', 'Unknown')
      `,
      [dateFrom, dateTo, project || null]
    );

    // Build sets for quick lookup
    const installedSet = new Set(installedResult.rows.map((r: { drop_number: string }) => r.drop_number));
    const activatedSet = new Set(activatedResult.rows.map((r: { drop_number: string }) => r.drop_number));

    // Helper to create empty anomaly counts
    const emptyAnomalies = (): AnomalyCounts => ({ wa_only: 0, oes_only: 0 });

    // Build hierarchical structure: Project -> Zone -> PON
    const projectMap = new Map<string, ProjectDailyCount>();

    // Process INSTALLED rows (from dr_photo_unified_reviews)
    for (const row of installedResult.rows) {
      const projectName = row.project || 'Unknown';
      const zoneNo = row.zone_no || 0;
      const ponNo = row.pon_no || 0;
      const isReviewed = row.is_reviewed === true;
      const isActivated = activatedSet.has(row.drop_number);

      // Get or create project
      if (!projectMap.has(projectName)) {
        projectMap.set(projectName, {
          project: projectName,
          date: dateFrom === dateTo ? dateFrom : `${dateFrom} to ${dateTo}`,
          total: 0,
          installed: 0,
          activated: 0,
          notReviewed: 0,
          reviewed: 0,
          zones: [],
          anomalies: emptyAnomalies(),
        });
      }
      const projectData = projectMap.get(projectName)!;

      // Update project totals
      projectData.total++;
      projectData.installed++;
      if (isActivated) {
        projectData.activated++;
      } else {
        // WA only anomaly: installed but not activated
        projectData.anomalies!.wa_only++;
      }
      if (isReviewed) {
        projectData.reviewed++;
      } else {
        projectData.notReviewed++;
      }

      // Find or create zone
      let zone = projectData.zones.find((z) => z.zone_no === zoneNo);
      if (!zone) {
        zone = {
          zone_no: zoneNo,
          zone_name: zoneNo === 0 ? 'Unknown Zone' : `Zone ${zoneNo}`,
          pons: [],
          total: 0,
          installed: 0,
          activated: 0,
          notReviewed: 0,
          reviewed: 0,
          anomalies: emptyAnomalies(),
        };
        projectData.zones.push(zone);
      }

      // Update zone totals
      zone.total++;
      zone.installed++;
      if (isActivated) {
        zone.activated++;
      } else {
        zone.anomalies!.wa_only++;
      }
      if (isReviewed) {
        zone.reviewed++;
      } else {
        zone.notReviewed++;
      }

      // Find or create PON
      let pon = zone.pons.find((p) => p.pon_no === ponNo);
      if (!pon) {
        pon = {
          pon_no: ponNo,
          pon_name: ponNo === 0 ? 'Unknown PON' : `PON ${zoneNo}.${ponNo}`,
          total: 0,
          installed: 0,
          activated: 0,
          notReviewed: 0,
          reviewed: 0,
          poles: [],
          anomalies: emptyAnomalies(),
        };
        zone.pons.push(pon);
      }

      // Update PON totals
      pon.total++;
      pon.installed++;
      if (isActivated) {
        pon.activated++;
      } else {
        pon.anomalies!.wa_only++;
      }
      if (isReviewed) {
        pon.reviewed++;
      } else {
        pon.notReviewed++;
      }

      // Find or create Pole (pole_no can be null/empty)
      const poleNo = row.pole_no || null;
      if (poleNo) {
        if (!pon.poles) pon.poles = [];
        let pole = pon.poles.find((p) => p.pole_no === poleNo);
        if (!pole) {
          pole = {
            pole_no: poleNo,
            pole_name: poleNo,
            total: 0,
            installed: 0,
            activated: 0,
            notReviewed: 0,
            reviewed: 0,
            drs: [],
            anomalies: emptyAnomalies(),
          };
          pon.poles.push(pole);
        }

        // Update Pole totals
        pole.total++;
        pole.installed++;
        if (isActivated) {
          pole.activated++;
        } else {
          pole.anomalies!.wa_only++;
        }
        if (isReviewed) {
          pole.reviewed++;
        } else {
          pole.notReviewed++;
        }

        // Add individual DR to pole
        if (!pole.drs) pole.drs = [];
        const qaDecision = row.qa_decision?.toLowerCase() || null;
        pole.drs.push({
          drop_number: row.drop_number,
          is_installed: true,
          is_activated: isActivated,
          is_reviewed: isReviewed,
          installed_at: row.installed_at ? String(row.installed_at) : null,
          activated_at: null, // Will be populated from OES query if needed
          qa_status: qaDecision === 'pass' ? 'pass'
            : qaDecision === 'fail' ? 'fail'
            : qaDecision === 'rework' || qaDecision === 'rework_needed' ? 'rework'
            : 'pending',
        });
      }
    }

    // Process OES-only rows (activated but not installed via WA)
    for (const row of activatedResult.rows) {
      if (installedSet.has(row.drop_number)) continue; // Already counted above

      const projectName = row.project || 'Unknown';
      const zoneNo = row.zone_no || 0;
      const ponNo = row.pon_no || 0;

      // Get or create project
      if (!projectMap.has(projectName)) {
        projectMap.set(projectName, {
          project: projectName,
          date: dateFrom === dateTo ? dateFrom : `${dateFrom} to ${dateTo}`,
          total: 0,
          installed: 0,
          activated: 0,
          notReviewed: 0,
          reviewed: 0,
          zones: [],
          anomalies: emptyAnomalies(),
        });
      }
      const projectData = projectMap.get(projectName)!;

      // OES-only: activated but never installed via WA
      projectData.total++;
      projectData.activated++;
      projectData.anomalies!.oes_only++;

      // Find or create zone
      let zone = projectData.zones.find((z) => z.zone_no === zoneNo);
      if (!zone) {
        zone = {
          zone_no: zoneNo,
          zone_name: zoneNo === 0 ? 'Unknown Zone' : `Zone ${zoneNo}`,
          pons: [],
          total: 0,
          installed: 0,
          activated: 0,
          notReviewed: 0,
          reviewed: 0,
          anomalies: emptyAnomalies(),
        };
        projectData.zones.push(zone);
      }

      zone.total++;
      zone.activated++;
      zone.anomalies!.oes_only++;

      // Find or create PON
      let pon = zone.pons.find((p) => p.pon_no === ponNo);
      if (!pon) {
        pon = {
          pon_no: ponNo,
          pon_name: ponNo === 0 ? 'Unknown PON' : `PON ${zoneNo}.${ponNo}`,
          total: 0,
          installed: 0,
          activated: 0,
          notReviewed: 0,
          reviewed: 0,
          poles: [],
          anomalies: emptyAnomalies(),
        };
        zone.pons.push(pon);
      }

      pon.total++;
      pon.activated++;
      pon.anomalies!.oes_only++;

      // Find or create Pole for OES-only (pole_no can be null/empty)
      const poleNo = row.pole_no || null;
      if (poleNo) {
        if (!pon.poles) pon.poles = [];
        let pole = pon.poles.find((p) => p.pole_no === poleNo);
        if (!pole) {
          pole = {
            pole_no: poleNo,
            pole_name: poleNo,
            total: 0,
            installed: 0,
            activated: 0,
            notReviewed: 0,
            reviewed: 0,
            drs: [],
            anomalies: emptyAnomalies(),
          };
          pon.poles.push(pole);
        }

        // OES-only pole stats
        pole.total++;
        pole.activated++;
        pole.anomalies!.oes_only++;

        // Add individual DR to pole (OES-only - activated but not installed via WA)
        if (!pole.drs) pole.drs = [];
        pole.drs.push({
          drop_number: row.drop_number,
          is_installed: false,
          is_activated: true,
          is_reviewed: false,
          installed_at: null,
          activated_at: null, // Would need OES activation_date from query
          qa_status: 'pending',
        });
      }
    }

    // Sort zones, PONs, poles, and DRs
    for (const projectData of projectMap.values()) {
      projectData.zones.sort((a, b) => a.zone_no - b.zone_no);
      for (const zone of projectData.zones) {
        zone.pons.sort((a, b) => a.pon_no - b.pon_no);
        for (const pon of zone.pons) {
          if (pon.poles) {
            pon.poles.sort((a, b) => a.pole_no.localeCompare(b.pole_no));
            // Sort DRs within each pole by drop_number
            for (const pole of pon.poles) {
              if (pole.drs) {
                pole.drs.sort((a, b) => a.drop_number.localeCompare(b.drop_number));
              }
            }
          }
        }
      }
    }

    // Calculate grand totals
    const projects = Array.from(projectMap.values());
    const grandTotal = projects.reduce(
      (acc, p) => ({
        total: acc.total + p.total,
        installed: acc.installed + p.installed,
        activated: acc.activated + p.activated,
        notReviewed: acc.notReviewed + p.notReviewed,
        reviewed: acc.reviewed + p.reviewed,
        anomalies: {
          wa_only: (acc.anomalies?.wa_only || 0) + (p.anomalies?.wa_only || 0),
          oes_only: (acc.anomalies?.oes_only || 0) + (p.anomalies?.oes_only || 0),
        },
      }),
      { total: 0, installed: 0, activated: 0, notReviewed: 0, reviewed: 0, anomalies: emptyAnomalies() }
    );

    return {
      date_range: { from: dateFrom, to: dateTo },
      projects: projects.sort((a, b) => b.installed - a.installed),
      grand_total: grandTotal,
    };
  } catch (error) {
    log.error('Failed to get daily counts', { error }, 'ReportingService');
    throw error;
  }
}
