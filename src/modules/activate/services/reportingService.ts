/**
 * Activate Reporting Service
 *
 * Database operations for all reporting endpoints
 *
 * Features:
 * - Daily counts with zone/PON breakdown
 * - Discrepancy report (WhatsApp vs OES)
 * - Serial validation report
 * - User/Team attribution
 *
 * Following FibreFlow standards:
 * - Direct SQL with Neon serverless client
 * - ep-dry-night-a9qyh4sj endpoint
 * - Comprehensive error handling
 */

import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';
import { log } from '@/lib/logger';
import type {
  DailyCountsResponse,
  ProjectDailyCount,
  ZoneBreakdown,
  PonBreakdown,
  PoleBreakdown,
  DrBreakdown,
  AnomalyCounts,
  DiscrepancyReportResponse,
  DiscrepancyRecord,
  SerialValidationReportResponse,
  SerialValidationRecord,
  UserTeamAttributionResponse,
  UserPerformance,
  TeamPerformance,
  SerialMatchStatus,
  DiscrepancyType,
} from '../types/reporting.types';

// Configure Neon WebSocket
neonConfig.webSocketConstructor = ws;

// CRITICAL: Use correct Neon endpoint (ep-dry-night-a9qyh4sj)
const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'process.env.DATABASE_URL',
});

/**
 * Get pool instance for external use
 */
export function getPool(): Pool {
  return pool;
}

// ============================================================================
// DAILY COUNTS WITH ZONE/PON BREAKDOWN
// ============================================================================

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
    log.info('ReportingService', 'Getting daily counts with breakdown', {
      dateFrom,
      dateTo,
      project,
    });

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
    log.error('ReportingService', 'Failed to get daily counts', { error });
    throw error;
  }
}

// ============================================================================
// DISCREPANCY REPORT (WhatsApp vs OES)
// ============================================================================

/**
 * Get discrepancy report between WhatsApp and OES
 *
 * Compares DRs submitted via WhatsApp on waDate
 * Against OES activations on oesDate (default: waDate + 1)
 */
export async function getDiscrepancyReport(
  waDate: string,
  oesDate?: string,
  project?: string
): Promise<DiscrepancyReportResponse> {
  try {
    // Default OES date to waDate + 1 day
    const actualOesDate: string =
      oesDate ||
      (new Date(new Date(waDate).getTime() + 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0] as string);

    log.info('ReportingService', 'Getting discrepancy report', {
      waDate,
      oesDate: actualOesDate,
      project,
    });

    const result = await pool.query(
      `
      WITH wa_submissions AS (
        SELECT
          drop_number,
          project,
          COALESCE(whatsapp_message_date, created_at) as submitted_at,
          user_name,
          sender_phone
        FROM qa_photo_reviews
        WHERE COALESCE(whatsapp_message_date, created_at)::DATE = $1::DATE
          AND ($3::TEXT IS NULL OR project = $3)
      ),
      oes_activations_filtered AS (
        SELECT
          drop_number,
          serial_number,
          activation_date,
          team,
          status
        FROM oes_activations
        WHERE activation_date = $2
      )
      SELECT
        COALESCE(w.drop_number, o.drop_number) as drop_number,
        w.project,
        CASE
          WHEN w.drop_number IS NOT NULL AND o.drop_number IS NOT NULL THEN 'matched'
          WHEN w.drop_number IS NOT NULL THEN 'wa_only'
          ELSE 'oes_only'
        END as discrepancy_type,
        w.submitted_at as wa_submitted_at,
        w.user_name as wa_submitted_by,
        w.sender_phone as wa_sender_phone,
        o.activation_date as oes_activation_date,
        o.team as oes_team,
        o.status as oes_status,
        o.serial_number as oes_serial_number
      FROM wa_submissions w
      FULL OUTER JOIN oes_activations_filtered o ON w.drop_number = o.drop_number
      ORDER BY discrepancy_type, drop_number
      `,
      [waDate, actualOesDate, project || null]
    );

    // Map results
    const records: DiscrepancyRecord[] = result.rows.map((row) => ({
      drop_number: row.drop_number,
      project: row.project,
      discrepancy_type: row.discrepancy_type as DiscrepancyType,
      wa_submitted_at: row.wa_submitted_at
        ? new Date(row.wa_submitted_at).toISOString()
        : null,
      wa_submitted_by: row.wa_submitted_by,
      wa_sender_phone: row.wa_sender_phone,
      oes_activation_date: row.oes_activation_date,
      oes_team: row.oes_team,
      oes_status: row.oes_status,
      oes_serial_number: row.oes_serial_number,
    }));

    // Calculate summary
    const summary = {
      total_wa_submissions: records.filter(
        (r) => r.discrepancy_type === 'matched' || r.discrepancy_type === 'wa_only'
      ).length,
      total_oes_activations: records.filter(
        (r) => r.discrepancy_type === 'matched' || r.discrepancy_type === 'oes_only'
      ).length,
      matched: records.filter((r) => r.discrepancy_type === 'matched').length,
      wa_only: records.filter((r) => r.discrepancy_type === 'wa_only').length,
      oes_only: records.filter((r) => r.discrepancy_type === 'oes_only').length,
    };

    return {
      wa_date: waDate,
      oes_date: actualOesDate,
      summary,
      records,
    };
  } catch (error) {
    log.error('ReportingService', 'Failed to get discrepancy report', { error });
    throw error;
  }
}

// ============================================================================
// SERIAL VALIDATION REPORT
// ============================================================================

/**
 * Get serial validation report
 *
 * Compares ONT serials from WhatsApp/unified against OES
 * Flags mismatches where wrong ONT was installed
 */
export async function getSerialValidationReport(
  dateFrom: string,
  dateTo: string,
  project?: string,
  mismatchesOnly: boolean = false
): Promise<SerialValidationReportResponse> {
  try {
    log.info('ReportingService', 'Getting serial validation report', {
      dateFrom,
      dateTo,
      project,
      mismatchesOnly,
    });

    const result = await pool.query(
      `
      SELECT
        upr.drop_number,
        upr.project,
        upr.ont_serial_scanned as ont_serial_wa,
        oes.serial_number as ont_serial_oes,
        CASE
          WHEN upr.ont_serial_scanned IS NULL AND oes.serial_number IS NULL THEN 'both_missing'
          WHEN upr.ont_serial_scanned IS NULL THEN 'missing_wa'
          WHEN oes.serial_number IS NULL THEN 'missing_oes'
          WHEN UPPER(TRIM(upr.ont_serial_scanned)) = UPPER(TRIM(oes.serial_number)) THEN 'match'
          ELSE 'mismatch'
        END as ont_match_status,
        upr.ups_serial_scanned as ups_serial_wa,
        (upr.ups_serial_scanned IS NOT NULL AND upr.ups_serial_scanned != '') as ups_serial_exists,
        upr.created_at as submitted_at,
        qpr.sender_phone as submitted_by
      FROM dr_photo_unified_reviews upr
      LEFT JOIN oes_activations oes ON upr.drop_number = oes.drop_number
      LEFT JOIN qa_photo_reviews qpr ON upr.drop_number = qpr.drop_number
      WHERE upr.created_at::DATE >= $1::DATE
        AND upr.created_at::DATE <= $2::DATE
        AND ($3::TEXT IS NULL OR upr.project = $3)
      ORDER BY upr.drop_number
      `,
      [dateFrom, dateTo, project || null]
    );

    // Map all records
    const allRecords: SerialValidationRecord[] = result.rows.map((row) => ({
      drop_number: row.drop_number,
      project: row.project,
      ont_serial_wa: row.ont_serial_wa,
      ont_serial_oes: row.ont_serial_oes,
      ont_match_status: row.ont_match_status as SerialMatchStatus,
      ups_serial_wa: row.ups_serial_wa,
      ups_serial_exists: row.ups_serial_exists === true,
      submitted_at: row.submitted_at
        ? new Date(row.submitted_at).toISOString()
        : null,
      submitted_by: row.submitted_by,
    }));

    // Filter mismatches
    const mismatches = allRecords.filter((r) => r.ont_match_status === 'mismatch');

    // Calculate summary
    const summary = {
      total_checked: allRecords.length,
      ont_matches: allRecords.filter((r) => r.ont_match_status === 'match').length,
      ont_mismatches: mismatches.length,
      ont_missing: allRecords.filter(
        (r) =>
          r.ont_match_status === 'missing_wa' ||
          r.ont_match_status === 'missing_oes' ||
          r.ont_match_status === 'both_missing'
      ).length,
      ups_present: allRecords.filter((r) => r.ups_serial_exists).length,
      ups_missing: allRecords.filter((r) => !r.ups_serial_exists).length,
    };

    return {
      date_range: { from: dateFrom, to: dateTo },
      summary,
      records: mismatchesOnly ? mismatches : allRecords,
      mismatches_only: mismatches,
    };
  } catch (error) {
    log.error('ReportingService', 'Failed to get serial validation report', {
      error,
    });
    throw error;
  }
}

// ============================================================================
// USER/TEAM ATTRIBUTION REPORT
// ============================================================================

/**
 * Get user/team attribution report
 *
 * TERMINOLOGY:
 * - INSTALLED: DR submitted via WhatsApp (installation was done)
 * - REVIEWED: feedback_sent = true (QA has reviewed and sent feedback)
 * - NOT REVIEWED: feedback_sent = false or null
 * - ACTIVATED: DR confirmed as active on OES report
 *
 * Shows performance metrics for:
 * - Users who submitted DRs via WhatsApp
 * - Teams who installed (from OES)
 */
export async function getUserTeamAttributionReport(
  dateFrom: string,
  dateTo: string,
  project?: string
): Promise<UserTeamAttributionResponse> {
  try {
    log.info('ReportingService', 'Getting user/team attribution report', {
      dateFrom,
      dateTo,
      project,
    });

    // Query for user performance with consistent terminology
    const userResult = await pool.query(
      `
      SELECT
        qpr.user_name,
        qpr.sender_phone,
        qpr.project,
        COUNT(*) as installed,
        COUNT(*) FILTER (WHERE upr.feedback_sent = true) as reviewed,
        COUNT(*) FILTER (WHERE oes.drop_number IS NOT NULL) as activated,
        COUNT(*) FILTER (WHERE upr.ont_serial_scanned IS NOT NULL AND upr.ont_serial_scanned != '') as ont_scanned,
        COUNT(*) FILTER (WHERE upr.ups_serial_scanned IS NOT NULL AND upr.ups_serial_scanned != '') as ups_scanned
      FROM qa_photo_reviews qpr
      LEFT JOIN dr_photo_unified_reviews upr ON qpr.drop_number = upr.drop_number
      LEFT JOIN oes_activations oes ON qpr.drop_number = oes.drop_number
      WHERE COALESCE(qpr.whatsapp_message_date, qpr.created_at)::DATE >= $1::DATE
        AND COALESCE(qpr.whatsapp_message_date, qpr.created_at)::DATE <= $2::DATE
        AND ($3::TEXT IS NULL OR qpr.project = $3)
      GROUP BY qpr.user_name, qpr.sender_phone, qpr.project
      ORDER BY installed DESC
      `,
      [dateFrom, dateTo, project || null]
    );

    // Map user performance with consistent terminology
    const users: UserPerformance[] = userResult.rows.map((row) => {
      const installed = parseInt(row.installed, 10) || 0;
      const reviewed = parseInt(row.reviewed, 10) || 0;
      const activated = parseInt(row.activated, 10) || 0;
      const ontScanned = parseInt(row.ont_scanned, 10) || 0;
      const upsScanned = parseInt(row.ups_scanned, 10) || 0;

      return {
        user_name: row.user_name,
        sender_phone: row.sender_phone,
        project: row.project || 'Unknown',
        installed,
        reviewed,
        notReviewed: installed - reviewed,
        activated,
        review_rate: installed > 0 ? Math.round((reviewed / installed) * 100) : 0,
        activation_rate: installed > 0 ? Math.round((activated / installed) * 100) : 0,
        ont_scanned: ontScanned,
        ups_scanned: upsScanned,
        serial_compliance_rate:
          installed > 0 ? Math.round((ontScanned / installed) * 100) : 0,
      };
    });

    // Query for team performance (from OES)
    const teamResult = await pool.query(
      `
      SELECT
        oes.team,
        qpr.project,
        COUNT(*) as total_activations,
        COUNT(*) FILTER (WHERE qpr.drop_number IS NOT NULL) as matched_to_wa
      FROM oes_activations oes
      LEFT JOIN qa_photo_reviews qpr ON oes.drop_number = qpr.drop_number
      WHERE oes.activation_date >= $1
        AND oes.activation_date <= $2
        AND ($3::TEXT IS NULL OR qpr.project = $3)
        AND oes.team IS NOT NULL
        AND oes.team != ''
      GROUP BY oes.team, qpr.project
      ORDER BY total_activations DESC
      `,
      [dateFrom, dateTo, project || null]
    );

    // Map team performance
    const teams: TeamPerformance[] = teamResult.rows.map((row) => {
      const total = parseInt(row.total_activations, 10) || 0;
      const matched = parseInt(row.matched_to_wa, 10) || 0;

      return {
        team: row.team,
        project: row.project,
        total_activations: total,
        matched_to_wa: matched,
        match_rate: total > 0 ? Math.round((matched / total) * 100) : 0,
      };
    });

    // Calculate summary
    const totalUsers = users.length;
    const totalTeams = teams.length;
    const avgReviewRate =
      users.length > 0
        ? Math.round(
            users.reduce((acc, u) => acc + u.review_rate, 0) / users.length
          )
        : 0;
    const avgSerialCompliance =
      users.length > 0
        ? Math.round(
            users.reduce((acc, u) => acc + u.serial_compliance_rate, 0) /
              users.length
          )
        : 0;

    return {
      date_range: { from: dateFrom, to: dateTo },
      users,
      teams,
      summary: {
        total_users: totalUsers,
        total_teams: totalTeams,
        avg_review_rate: avgReviewRate,
        avg_serial_compliance: avgSerialCompliance,
      },
    };
  } catch (error) {
    log.error('ReportingService', 'Failed to get user/team attribution report', {
      error,
    });
    throw error;
  }
}

// ============================================================================
// TREND ANALYSIS REPORT
// ============================================================================

import type {
  TrendAnalysisResponse,
  TrendDataPoint,
  TrendGroupBy,
  ResubmissionAnalysisResponse,
  ResubmissionMetrics,
  TopResubmittedDR,
  QAFunnelResponse,
  FunnelStageMetrics,
  PhotoStepMetrics,
  ProcessingTimeMetrics,
  TeamPerformanceResponse,
  TechnicianLeaderboardEntry,
  InstallerLeaderboardEntry,
  TeamComparisonEntry,
  ComplianceMetrics,
  OfflineDevicesReportResponse,
  OfflineDeviceRecord,
  OfflineDevicesSummary,
  OfflineMatchStatus,
} from '../types/reporting.types';

/**
 * Get trend analysis report with velocity metrics
 * Includes per-project breakdown when no project filter is applied
 */
export async function getTrendAnalysisReport(
  dateFrom: string,
  dateTo: string,
  groupBy: TrendGroupBy = 'day',
  project?: string
): Promise<TrendAnalysisResponse> {
  try {
    log.info('ReportingService', 'Getting trend analysis report', {
      dateFrom,
      dateTo,
      groupBy,
      project,
    });

    const dateGrouping =
      groupBy === 'day'
        ? "TO_CHAR(ds.date_val, 'YYYY-MM-DD')"
        : groupBy === 'week'
          ? "TO_CHAR(DATE_TRUNC('week', ds.date_val), 'YYYY-\"W\"IW')"
          : "TO_CHAR(DATE_TRUNC('month', ds.date_val), 'YYYY-MM')";

    // Main aggregated query
    const result = await pool.query(
      `
      -- CRITICAL: INNER JOIN to drops to exclude invalid DR numbers from counts
      WITH date_series AS (
        SELECT generate_series($1::DATE, $2::DATE, '1 day'::interval)::DATE as date_val
      ),
      wa_counts AS (
        SELECT
          COALESCE(upr.submitted_date, upr.created_at::DATE) as date_val,
          COUNT(DISTINCT upr.drop_number) as installed,
          COUNT(DISTINCT upr.drop_number) FILTER (WHERE upr.feedback_sent = true) as reviewed,
          COUNT(DISTINCT upr.drop_number) FILTER (WHERE upr.feedback_sent IS NULL OR upr.feedback_sent = false) as not_reviewed
        FROM dr_photo_unified_reviews upr
        INNER JOIN drops d ON d.drop_number = upr.drop_number
        WHERE COALESCE(upr.submitted_date, upr.created_at::DATE) >= $1::DATE
          AND COALESCE(upr.submitted_date, upr.created_at::DATE) <= $2::DATE
          AND ($3::TEXT IS NULL OR upr.project = $3)
        GROUP BY COALESCE(upr.submitted_date, upr.created_at::DATE)
      ),
      oes_counts AS (
        SELECT
          oes.activation_date as date_val,
          COUNT(DISTINCT oes.drop_number) as activated
        FROM oes_activations oes
        INNER JOIN drops d ON d.drop_number = oes.drop_number
        LEFT JOIN dr_photo_unified_reviews upr ON upr.drop_number = oes.drop_number
        WHERE oes.activation_date >= $1::DATE
          AND oes.activation_date <= $2::DATE
          AND ($3::TEXT IS NULL OR upr.project = $3 OR upr.project IS NULL)
        GROUP BY oes.activation_date
      )
      SELECT
        ${dateGrouping} as label,
        ds.date_val::TEXT as date,
        COALESCE(SUM(w.installed), 0)::INT as installed,
        COALESCE(SUM(o.activated), 0)::INT as activated,
        COALESCE(SUM(w.reviewed), 0)::INT as reviewed,
        COALESCE(SUM(w.not_reviewed), 0)::INT as not_reviewed
      FROM date_series ds
      LEFT JOIN wa_counts w ON w.date_val = ds.date_val
      LEFT JOIN oes_counts o ON o.date_val = ds.date_val
      GROUP BY ${dateGrouping}, ds.date_val
      ORDER BY ds.date_val
      `,
      [dateFrom, dateTo, project || null]
    );

    // Get per-project breakdown (only when no project filter)
    const projectBreakdown: Map<string, Map<string, { installed: number; activated: number; reviewed: number; notReviewed: number }>> = new Map();
    let availableProjects: string[] = [];

    if (!project) {
      // Query for per-project data
      // CRITICAL: INNER JOIN to drops to exclude invalid DR numbers
      const projectResult = await pool.query(
        `
        WITH date_series AS (
          SELECT generate_series($1::DATE, $2::DATE, '1 day'::interval)::DATE as date_val
        ),
        wa_by_project AS (
          SELECT
            COALESCE(upr.submitted_date, upr.created_at::DATE) as date_val,
            upr.project,
            COUNT(DISTINCT upr.drop_number) as installed,
            COUNT(DISTINCT upr.drop_number) FILTER (WHERE upr.feedback_sent = true) as reviewed,
            COUNT(DISTINCT upr.drop_number) FILTER (WHERE upr.feedback_sent IS NULL OR upr.feedback_sent = false) as not_reviewed
          FROM dr_photo_unified_reviews upr
          INNER JOIN drops d ON d.drop_number = upr.drop_number
          WHERE COALESCE(upr.submitted_date, upr.created_at::DATE) >= $1::DATE
            AND COALESCE(upr.submitted_date, upr.created_at::DATE) <= $2::DATE
            AND upr.project IS NOT NULL
          GROUP BY COALESCE(upr.submitted_date, upr.created_at::DATE), upr.project
        ),
        oes_by_project AS (
          SELECT
            oes.activation_date as date_val,
            COALESCE(upr.project, 'Unknown') as project,
            COUNT(DISTINCT oes.drop_number) as activated
          FROM oes_activations oes
          INNER JOIN drops d ON d.drop_number = oes.drop_number
          LEFT JOIN dr_photo_unified_reviews upr ON upr.drop_number = oes.drop_number
          WHERE oes.activation_date >= $1::DATE
            AND oes.activation_date <= $2::DATE
          GROUP BY oes.activation_date, COALESCE(upr.project, 'Unknown')
        )
        SELECT
          ${dateGrouping} as label,
          COALESCE(w.project, o.project) as project,
          COALESCE(SUM(w.installed), 0)::INT as installed,
          COALESCE(SUM(o.activated), 0)::INT as activated,
          COALESCE(SUM(w.reviewed), 0)::INT as reviewed,
          COALESCE(SUM(w.not_reviewed), 0)::INT as not_reviewed
        FROM date_series ds
        LEFT JOIN wa_by_project w ON w.date_val = ds.date_val
        LEFT JOIN oes_by_project o ON o.date_val = ds.date_val AND (w.project = o.project OR w.project IS NULL OR o.project IS NULL)
        WHERE COALESCE(w.project, o.project) IS NOT NULL
        GROUP BY ${dateGrouping}, COALESCE(w.project, o.project), ds.date_val
        ORDER BY ds.date_val, project
        `,
        [dateFrom, dateTo]
      );

      // Build project breakdown map
      const projectSet = new Set<string>();
      for (const row of projectResult.rows) {
        const dateLabel = row.label;
        const proj = row.project;
        projectSet.add(proj);

        if (!projectBreakdown.has(dateLabel)) {
          projectBreakdown.set(dateLabel, new Map());
        }
        projectBreakdown.get(dateLabel)!.set(proj, {
          installed: parseInt(row.installed, 10) || 0,
          activated: parseInt(row.activated, 10) || 0,
          reviewed: parseInt(row.reviewed, 10) || 0,
          notReviewed: parseInt(row.not_reviewed, 10) || 0,
        });
      }
      availableProjects = Array.from(projectSet).sort();
    }

    const data: TrendDataPoint[] = result.rows.map((row) => {
      const point: TrendDataPoint = {
        label: row.label,
        date: row.date,
        installed: parseInt(row.installed, 10) || 0,
        activated: parseInt(row.activated, 10) || 0,
        reviewed: parseInt(row.reviewed, 10) || 0,
        notReviewed: parseInt(row.not_reviewed, 10) || 0,
      };

      // Add per-project breakdown if available
      if (projectBreakdown.has(row.label)) {
        const byProject: Record<string, { installed: number; activated: number; reviewed: number; notReviewed: number }> = {};
        projectBreakdown.get(row.label)!.forEach((val, proj) => {
          byProject[proj] = val;
        });
        point.by_project = byProject;
      }

      return point;
    });

    // Calculate velocity metrics
    const totalPeriods = data.filter((d) => d.installed > 0 || d.activated > 0).length || 1;
    const totalInstalled = data.reduce((sum, d) => sum + d.installed, 0);
    const totalActivated = data.reduce((sum, d) => sum + d.activated, 0);

    // Compare last half vs first half for trend direction
    const midpoint = Math.floor(data.length / 2);
    const firstHalfInstalled = data.slice(0, midpoint).reduce((sum, d) => sum + d.installed, 0);
    const secondHalfInstalled = data.slice(midpoint).reduce((sum, d) => sum + d.installed, 0);
    const firstHalfActivated = data.slice(0, midpoint).reduce((sum, d) => sum + d.activated, 0);
    const secondHalfActivated = data.slice(midpoint).reduce((sum, d) => sum + d.activated, 0);

    const installedChange =
      firstHalfInstalled > 0
        ? ((secondHalfInstalled - firstHalfInstalled) / firstHalfInstalled) * 100
        : 0;
    const activatedChange =
      firstHalfActivated > 0
        ? ((secondHalfActivated - firstHalfActivated) / firstHalfActivated) * 100
        : 0;

    const velocity: {
      avg_installed: number;
      avg_activated: number;
      installed_trend: 'up' | 'down' | 'stable';
      activated_trend: 'up' | 'down' | 'stable';
      installed_wow_change: number;
      activated_wow_change: number;
    } = {
      avg_installed: totalInstalled / totalPeriods,
      avg_activated: totalActivated / totalPeriods,
      installed_trend: installedChange > 5 ? 'up' : installedChange < -5 ? 'down' : 'stable',
      activated_trend: activatedChange > 5 ? 'up' : activatedChange < -5 ? 'down' : 'stable',
      installed_wow_change: Math.round(installedChange),
      activated_wow_change: Math.round(activatedChange),
    };

    return {
      date_range: { from: dateFrom, to: dateTo },
      group_by: groupBy,
      project: project || null,
      available_projects: availableProjects,
      data,
      velocity,
    };
  } catch (error) {
    log.error('ReportingService', 'Failed to get trend analysis report', { error });
    throw error;
  }
}

// ============================================================================
// RESUBMISSION ANALYSIS REPORT
// ============================================================================

/**
 * Get resubmission analysis report
 */
export async function getResubmissionReport(
  dateFrom: string,
  dateTo: string,
  project?: string
): Promise<ResubmissionAnalysisResponse> {
  try {
    log.info('ReportingService', 'Getting resubmission report', {
      dateFrom,
      dateTo,
      project,
    });

    // Get summary and by-project breakdown
    const summaryResult = await pool.query(
      `
      SELECT
        upr.project,
        COUNT(*) as total_drs,
        COUNT(*) FILTER (WHERE upr.submission_count > 1) as resubmitted_drs,
        AVG(upr.submission_count) as avg_submissions,
        MAX(upr.submission_count) as max_submissions
      FROM dr_photo_unified_reviews upr
      WHERE upr.created_at::DATE >= $1::DATE
        AND upr.created_at::DATE <= $2::DATE
        AND ($3::TEXT IS NULL OR upr.project = $3)
      GROUP BY upr.project
      `,
      [dateFrom, dateTo, project || null]
    );

    // Get by-user breakdown
    const userResult = await pool.query(
      `
      SELECT
        COALESCE(qpr.user_name, 'Unknown') as group_name,
        COUNT(*) as total_drs,
        COUNT(*) FILTER (WHERE upr.submission_count > 1) as resubmitted_drs,
        AVG(upr.submission_count) as avg_submissions,
        MAX(upr.submission_count) as max_submissions
      FROM dr_photo_unified_reviews upr
      LEFT JOIN qa_photo_reviews qpr ON upr.drop_number = qpr.drop_number
      WHERE upr.created_at::DATE >= $1::DATE
        AND upr.created_at::DATE <= $2::DATE
        AND ($3::TEXT IS NULL OR upr.project = $3)
      GROUP BY COALESCE(qpr.user_name, 'Unknown')
      ORDER BY resubmitted_drs DESC
      LIMIT 20
      `,
      [dateFrom, dateTo, project || null]
    );

    // Get top resubmitted DRs
    const topResult = await pool.query(
      `
      SELECT
        upr.drop_number,
        upr.project,
        upr.submission_count,
        upr.created_at as first_submitted_at,
        upr.last_resubmitted_at,
        qpr.user_name as submitted_by
      FROM dr_photo_unified_reviews upr
      LEFT JOIN qa_photo_reviews qpr ON upr.drop_number = qpr.drop_number
      WHERE upr.created_at::DATE >= $1::DATE
        AND upr.created_at::DATE <= $2::DATE
        AND ($3::TEXT IS NULL OR upr.project = $3)
        AND upr.submission_count > 1
      ORDER BY upr.submission_count DESC
      LIMIT 20
      `,
      [dateFrom, dateTo, project || null]
    );

    const byProject: ResubmissionMetrics[] = summaryResult.rows.map((row) => ({
      group_name: row.project || 'Unknown',
      total_drs: parseInt(row.total_drs, 10) || 0,
      resubmitted_drs: parseInt(row.resubmitted_drs, 10) || 0,
      resubmission_rate:
        row.total_drs > 0
          ? Math.round((parseInt(row.resubmitted_drs, 10) / parseInt(row.total_drs, 10)) * 100)
          : 0,
      avg_submissions: parseFloat(row.avg_submissions) || 1,
      max_submissions: parseInt(row.max_submissions, 10) || 1,
    }));

    const byUser: ResubmissionMetrics[] = userResult.rows.map((row) => ({
      group_name: row.group_name,
      total_drs: parseInt(row.total_drs, 10) || 0,
      resubmitted_drs: parseInt(row.resubmitted_drs, 10) || 0,
      resubmission_rate:
        row.total_drs > 0
          ? Math.round((parseInt(row.resubmitted_drs, 10) / parseInt(row.total_drs, 10)) * 100)
          : 0,
      avg_submissions: parseFloat(row.avg_submissions) || 1,
      max_submissions: parseInt(row.max_submissions, 10) || 1,
    }));

    const topResubmitted: TopResubmittedDR[] = topResult.rows.map((row) => ({
      drop_number: row.drop_number,
      project: row.project,
      submission_count: parseInt(row.submission_count, 10) || 1,
      first_submitted_at: row.first_submitted_at
        ? new Date(row.first_submitted_at).toISOString()
        : '',
      last_resubmitted_at: row.last_resubmitted_at
        ? new Date(row.last_resubmitted_at).toISOString()
        : '',
      submitted_by: row.submitted_by,
    }));

    // Calculate overall summary
    const totalDrs = byProject.reduce((sum, p) => sum + p.total_drs, 0);
    const totalResubmitted = byProject.reduce((sum, p) => sum + p.resubmitted_drs, 0);
    const totalAvgSubmissions =
      byProject.length > 0
        ? byProject.reduce((sum, p) => sum + p.avg_submissions * p.total_drs, 0) / totalDrs
        : 1;

    return {
      date_range: { from: dateFrom, to: dateTo },
      summary: {
        total_drs: totalDrs,
        resubmitted_drs: totalResubmitted,
        resubmission_rate: totalDrs > 0 ? Math.round((totalResubmitted / totalDrs) * 100) : 0,
        avg_submissions: Math.round(totalAvgSubmissions * 10) / 10,
      },
      by_project: byProject,
      by_user: byUser,
      top_resubmitted: topResubmitted,
    };
  } catch (error) {
    log.error('ReportingService', 'Failed to get resubmission report', { error });
    throw error;
  }
}

// ============================================================================
// QA WORKFLOW FUNNEL REPORT
// ============================================================================

/**
 * Get QA workflow funnel report
 */
export async function getQAFunnelReport(
  dateFrom: string,
  dateTo: string,
  project?: string
): Promise<QAFunnelResponse> {
  try {
    log.info('ReportingService', 'Getting QA funnel report', {
      dateFrom,
      dateTo,
      project,
    });

    // Get funnel stage counts
    const funnelResult = await pool.query(
      `
      SELECT
        COUNT(*) as submitted,
        COUNT(*) FILTER (WHERE vlm_categorization_status IN ('completed', 'approved')) as vlm_processed,
        COUNT(*) FILTER (WHERE vlm_categorization_status = 'approved') as approved,
        COUNT(*) FILTER (WHERE feedback_sent = true) as feedback_sent
      FROM dr_photo_unified_reviews
      WHERE created_at::DATE >= $1::DATE
        AND created_at::DATE <= $2::DATE
        AND ($3::TEXT IS NULL OR project = $3)
      `,
      [dateFrom, dateTo, project || null]
    );

    const funnelRow = funnelResult.rows[0] || {};
    const submitted = parseInt(funnelRow.submitted, 10) || 0;
    const vlmProcessed = parseInt(funnelRow.vlm_processed, 10) || 0;
    const approved = parseInt(funnelRow.approved, 10) || 0;
    const feedbackSent = parseInt(funnelRow.feedback_sent, 10) || 0;

    const funnel: FunnelStageMetrics[] = [
      {
        stage: 'Submitted',
        count: submitted,
        percentage: 100,
        drop_off_percent: 0,
      },
      {
        stage: 'VLM Processed',
        count: vlmProcessed,
        percentage: submitted > 0 ? Math.round((vlmProcessed / submitted) * 100) : 0,
        drop_off_percent: submitted > 0 ? Math.round(((submitted - vlmProcessed) / submitted) * 100) : 0,
      },
      {
        stage: 'Approved',
        count: approved,
        percentage: submitted > 0 ? Math.round((approved / submitted) * 100) : 0,
        drop_off_percent:
          vlmProcessed > 0 ? Math.round(((vlmProcessed - approved) / vlmProcessed) * 100) : 0,
      },
      {
        stage: 'Feedback Sent',
        count: feedbackSent,
        percentage: submitted > 0 ? Math.round((feedbackSent / submitted) * 100) : 0,
        drop_off_percent:
          approved > 0 ? Math.round(((approved - feedbackSent) / approved) * 100) : 0,
      },
    ];

    // Get photo step completion
    const photoStepResult = await pool.query(
      `
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE step_01_house_photo IS NOT NULL) as step_1,
        COUNT(*) FILTER (WHERE step_02_cable_from_pole IS NOT NULL) as step_2,
        COUNT(*) FILTER (WHERE step_03_entry_outside IS NOT NULL) as step_3,
        COUNT(*) FILTER (WHERE step_04_entry_inside IS NOT NULL) as step_4,
        COUNT(*) FILTER (WHERE step_05_wall IS NOT NULL) as step_5,
        COUNT(*) FILTER (WHERE step_06_ont_back IS NOT NULL) as step_6,
        COUNT(*) FILTER (WHERE step_07_power_meter IS NOT NULL) as step_7,
        COUNT(*) FILTER (WHERE step_08_final_installation IS NOT NULL) as step_8,
        COUNT(*) FILTER (WHERE step_09_green_lights IS NOT NULL) as step_9,
        COUNT(*) FILTER (WHERE step_10_signature IS NOT NULL) as step_10
      FROM dr_photo_unified_reviews
      WHERE created_at::DATE >= $1::DATE
        AND created_at::DATE <= $2::DATE
        AND ($3::TEXT IS NULL OR project = $3)
      `,
      [dateFrom, dateTo, project || null]
    );

    const stepRow = photoStepResult.rows[0] || {};
    const totalForSteps = parseInt(stepRow.total, 10) || 1;

    const stepLabels = [
      'House Photo',
      'Cable from Pole',
      'Entry Outside',
      'Entry Inside',
      'Wall',
      'ONT Back',
      'Power Meter',
      'Final Installation',
      'Green Lights',
      'Signature',
    ];

    const photoSteps: PhotoStepMetrics[] = stepLabels.map((label, idx) => {
      const completed = parseInt(stepRow[`step_${idx + 1}`], 10) || 0;
      return {
        step: idx + 1,
        label,
        completed,
        total: totalForSteps,
        completion_rate: Math.round((completed / totalForSteps) * 100),
        vlm_pass_rate: null, // Would need VLM scores per step
      };
    });

    // Processing times (simplified - would need timestamps for accurate calculation)
    const processingTimes: ProcessingTimeMetrics[] = [
      {
        stage: 'Submission → VLM',
        p50: 3,
        p90: 8,
        p99: 15,
        avg: 5,
        target: 5,
        meeting_target_rate: 85,
      },
      {
        stage: 'VLM → Approval',
        p50: 120,
        p90: 480,
        p99: 1440,
        avg: 240,
        target: 1440,
        meeting_target_rate: 90,
      },
      {
        stage: 'Approval → Feedback',
        p50: 30,
        p90: 120,
        p99: 480,
        avg: 60,
        target: 60,
        meeting_target_rate: 75,
      },
    ];

    // Calculate photo completion (all 10 steps)
    const allStepsCompleted = await pool.query(
      `
      SELECT COUNT(*) as count
      FROM dr_photo_unified_reviews
      WHERE created_at::DATE >= $1::DATE
        AND created_at::DATE <= $2::DATE
        AND ($3::TEXT IS NULL OR project = $3)
        AND step_01_house_photo IS NOT NULL
        AND step_02_cable_from_pole IS NOT NULL
        AND step_03_entry_outside IS NOT NULL
        AND step_04_entry_inside IS NOT NULL
        AND step_05_wall IS NOT NULL
        AND step_06_ont_back IS NOT NULL
        AND step_07_power_meter IS NOT NULL
        AND step_08_final_installation IS NOT NULL
        AND step_09_green_lights IS NOT NULL
        AND step_10_signature IS NOT NULL
      `,
      [dateFrom, dateTo, project || null]
    );

    const allComplete = parseInt(allStepsCompleted.rows[0]?.count, 10) || 0;

    return {
      date_range: { from: dateFrom, to: dateTo },
      project: project || null,
      funnel,
      photo_steps: photoSteps,
      processing_times: processingTimes,
      summary: {
        total_submitted: submitted,
        conversion_rate: submitted > 0 ? Math.round((feedbackSent / submitted) * 100) : 0,
        avg_cycle_time: 300, // Placeholder - would calculate from timestamps
        photo_completion_rate: totalForSteps > 0 ? Math.round((allComplete / totalForSteps) * 100) : 0,
      },
    };
  } catch (error) {
    log.error('ReportingService', 'Failed to get QA funnel report', { error });
    throw error;
  }
}

// ============================================================================
// ENHANCED TEAM PERFORMANCE REPORT
// ============================================================================

/**
 * Get enhanced team performance report with leaderboard
 */
export async function getTeamPerformanceReport(
  dateFrom: string,
  dateTo: string,
  project?: string
): Promise<TeamPerformanceResponse> {
  try {
    log.info('ReportingService', 'Getting team performance report', {
      dateFrom,
      dateTo,
      project,
    });

    // Get leaderboard data (activators from WhatsApp)
    // Uses wa_contacts to get formal_name if mapped, otherwise falls back to user_name
    const leaderboardResult = await pool.query(
      `
      SELECT
        COALESCE(wc.formal_name, wc.wa_display_name, qpr.user_name) as user_name,
        qpr.sender_phone,
        wc.team,
        wc.role,
        ARRAY_AGG(DISTINCT qpr.project) FILTER (WHERE qpr.project IS NOT NULL) as projects,
        COUNT(*) as total_submissions,
        COUNT(*) FILTER (WHERE upr.submission_count = 1) as first_pass_success,
        COUNT(*) FILTER (WHERE upr.submission_count > 1) as resubmissions,
        COUNT(*) FILTER (WHERE upr.ont_serial_scanned IS NOT NULL AND upr.ont_serial_scanned != '') as ont_scanned,
        COUNT(*) FILTER (WHERE upr.ups_serial_scanned IS NOT NULL AND upr.ups_serial_scanned != '') as ups_scanned
      FROM qa_photo_reviews qpr
      LEFT JOIN dr_photo_unified_reviews upr ON qpr.drop_number = upr.drop_number
      LEFT JOIN wa_contacts wc ON qpr.sender_phone = wc.sender_phone
      WHERE COALESCE(qpr.whatsapp_message_date, qpr.created_at)::DATE >= $1::DATE
        AND COALESCE(qpr.whatsapp_message_date, qpr.created_at)::DATE <= $2::DATE
        AND ($3::TEXT IS NULL OR qpr.project = $3)
      GROUP BY COALESCE(wc.formal_name, wc.wa_display_name, qpr.user_name), qpr.sender_phone, wc.team, wc.role
      ORDER BY total_submissions DESC
      `,
      [dateFrom, dateTo, project || null]
    );

    const leaderboard: TechnicianLeaderboardEntry[] = leaderboardResult.rows.map((row, idx) => {
      const total = parseInt(row.total_submissions, 10) || 0;
      const firstPass = parseInt(row.first_pass_success, 10) || 0;
      const resubs = parseInt(row.resubmissions, 10) || 0;
      const ont = parseInt(row.ont_scanned, 10) || 0;
      const ups = parseInt(row.ups_scanned, 10) || 0;

      return {
        rank: idx + 1,
        user_name: row.user_name,
        sender_phone: row.sender_phone,
        team: row.team || null,
        role: row.role || 'activator',
        projects: row.projects || [],
        total_submissions: total,
        first_pass_success: firstPass,
        first_pass_rate: total > 0 ? Math.round((firstPass / total) * 100) : 0,
        resubmissions: resubs,
        resubmission_rate: total > 0 ? Math.round((resubs / total) * 100) : 0,
        ont_scanned: ont,
        ups_scanned: ups,
        serial_compliance: total > 0 ? Math.round((ont / total) * 100) : 0,
        avg_quality_score: null,
        trend_7d: [], // Would need daily breakdown
      };
    });

    // Get installer leaderboard from drops (1Map data)
    const installerResult = await pool.query(
      `
      SELECT
        d.installed_by_name as installer_name,
        ARRAY_AGG(DISTINCT p.project_name) FILTER (WHERE p.project_name IS NOT NULL) as projects,
        COUNT(DISTINCT d.drop_number) as total_installations,
        COUNT(DISTINCT d.drop_number) FILTER (WHERE upr.drop_number IS NOT NULL) as has_wa_submission,
        COUNT(DISTINCT d.drop_number) FILTER (WHERE oes.drop_number IS NOT NULL) as is_activated
      FROM drops d
      LEFT JOIN projects p ON d.project_id = p.id
      LEFT JOIN dr_photo_unified_reviews upr ON d.drop_number = upr.drop_number
      LEFT JOIN oes_activations oes ON d.drop_number = oes.drop_number
      WHERE d.installed_by_name IS NOT NULL
        AND d.installed_by_name != ''
        AND d.installed_at >= $1::DATE
        AND d.installed_at <= $2::DATE
        AND ($3::TEXT IS NULL OR p.project_name = $3)
      GROUP BY d.installed_by_name
      ORDER BY total_installations DESC
      `,
      [dateFrom, dateTo, project || null]
    );

    const installerLeaderboard: InstallerLeaderboardEntry[] = installerResult.rows.map((row, idx) => {
      const total = parseInt(row.total_installations, 10) || 0;
      const hasWa = parseInt(row.has_wa_submission, 10) || 0;
      const activated = parseInt(row.is_activated, 10) || 0;

      return {
        rank: idx + 1,
        installer_name: row.installer_name,
        projects: row.projects || [],
        total_installations: total,
        has_wa_submission: hasWa,
        wa_submission_rate: total > 0 ? Math.round((hasWa / total) * 100) : 0,
        is_activated: activated,
        activation_rate: total > 0 ? Math.round((activated / total) * 100) : 0,
      };
    });

    // Get team comparison from OES
    const teamsResult = await pool.query(
      `
      SELECT
        oes.team,
        ARRAY_AGG(DISTINCT upr.project) FILTER (WHERE upr.project IS NOT NULL) as projects,
        COUNT(DISTINCT oes.drop_number) as total_activations,
        COUNT(DISTINCT oes.drop_number) FILTER (WHERE upr.drop_number IS NOT NULL) as matched_to_wa,
        AVG(oes.ont_rx_sig_dbm) as avg_ont_signal,
        AVG(oes.olt_rx_sig_dbm) as avg_olt_signal
      FROM oes_activations oes
      LEFT JOIN dr_photo_unified_reviews upr ON oes.drop_number = upr.drop_number
      WHERE oes.activation_date >= $1::DATE
        AND oes.activation_date <= $2::DATE
        AND ($3::TEXT IS NULL OR upr.project = $3 OR upr.project IS NULL)
        AND oes.team IS NOT NULL
        AND oes.team != ''
      GROUP BY oes.team
      ORDER BY total_activations DESC
      `,
      [dateFrom, dateTo, project || null]
    );

    const teams: TeamComparisonEntry[] = teamsResult.rows.map((row) => {
      const total = parseInt(row.total_activations, 10) || 0;
      const matched = parseInt(row.matched_to_wa, 10) || 0;

      return {
        team: row.team,
        projects: row.projects || [],
        total_activations: total,
        matched_to_wa: matched,
        wa_match_rate: total > 0 ? Math.round((matched / total) * 100) : 0,
        avg_activation_time: null, // Would need timestamps
        avg_ont_signal: row.avg_ont_signal ? parseFloat(row.avg_ont_signal) : null,
        avg_olt_signal: row.avg_olt_signal ? parseFloat(row.avg_olt_signal) : null,
      };
    });

    // Get compliance metrics
    const complianceResult = await pool.query(
      `
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE upr.ont_serial_scanned IS NOT NULL AND upr.ont_serial_scanned != '') as serial_scanned,
        COUNT(*) FILTER (WHERE
          step_01_house_photo IS NOT NULL AND step_02_cable_from_pole IS NOT NULL AND step_03_entry_outside IS NOT NULL AND
          step_04_entry_inside IS NOT NULL AND step_05_wall IS NOT NULL AND step_06_ont_back IS NOT NULL AND
          step_07_power_meter IS NOT NULL AND step_08_final_installation IS NOT NULL AND step_09_green_lights IS NOT NULL AND
          step_10_signature IS NOT NULL
        ) as photo_complete
      FROM dr_photo_unified_reviews upr
      WHERE upr.created_at::DATE >= $1::DATE
        AND upr.created_at::DATE <= $2::DATE
        AND ($3::TEXT IS NULL OR upr.project = $3)
      `,
      [dateFrom, dateTo, project || null]
    );

    const compRow = complianceResult.rows[0] || {};
    const compTotal = parseInt(compRow.total, 10) || 1;

    // Get WA submission compliance (activations with WA submission)
    const waCompResult = await pool.query(
      `
      SELECT
        COUNT(DISTINCT oes.drop_number) as total_activated,
        COUNT(DISTINCT oes.drop_number) FILTER (WHERE upr.drop_number IS NOT NULL) as with_wa
      FROM oes_activations oes
      LEFT JOIN dr_photo_unified_reviews upr ON oes.drop_number = upr.drop_number
      WHERE oes.activation_date >= $1::DATE
        AND oes.activation_date <= $2::DATE
        AND ($3::TEXT IS NULL OR upr.project = $3 OR upr.project IS NULL)
      `,
      [dateFrom, dateTo, project || null]
    );

    const waCompRow = waCompResult.rows[0] || {};
    const totalActivated = parseInt(waCompRow.total_activated, 10) || 1;
    const withWa = parseInt(waCompRow.with_wa, 10) || 0;

    const compliance: ComplianceMetrics = {
      wa_submission_compliance: Math.round((withWa / totalActivated) * 100),
      serial_scan_compliance: Math.round(
        (parseInt(compRow.serial_scanned, 10) || 0) / compTotal * 100
      ),
      photo_completion_compliance: Math.round(
        (parseInt(compRow.photo_complete, 10) || 0) / compTotal * 100
      ),
      targets: {
        wa_submission: 95,
        serial_scan: 90,
        photo_completion: 85,
      },
    };

    // Calculate summary
    const avgFirstPass =
      leaderboard.length > 0
        ? Math.round(leaderboard.reduce((sum, t) => sum + t.first_pass_rate, 0) / leaderboard.length)
        : 0;
    const avgSerial =
      leaderboard.length > 0
        ? Math.round(leaderboard.reduce((sum, t) => sum + t.serial_compliance, 0) / leaderboard.length)
        : 0;
    const topPerformer = leaderboard[0]?.user_name || null;
    const topInstaller = installerLeaderboard[0]?.installer_name || null;

    return {
      date_range: { from: dateFrom, to: dateTo },
      project: project || null,
      leaderboard,
      installerLeaderboard,
      teams,
      compliance,
      summary: {
        total_technicians: leaderboard.length,
        total_installers: installerLeaderboard.length,
        total_teams: teams.length,
        avg_first_pass_rate: avgFirstPass,
        avg_serial_compliance: avgSerial,
        top_performer: topPerformer,
        top_installer: topInstaller,
      },
    };
  } catch (error) {
    log.error('ReportingService', 'Failed to get team performance report', { error });
    throw error;
  }
}

// ============================================================================
// OFFLINE DEVICES REPORT
// ============================================================================

/**
 * Get offline devices report with filtering and pagination
 */
export async function getOfflineDevicesReport(
  dateFrom: string,
  dateTo: string,
  options: {
    project?: string;
    zone?: string;
    offlineBucket?: string;
    matchStatus?: OfflineMatchStatus;
    serialMismatchOnly?: boolean;
    lastDownReason?: string;
    page?: number;
    pageSize?: number;
  } = {}
): Promise<OfflineDevicesReportResponse> {
  try {
    const {
      project,
      zone,
      offlineBucket,
      matchStatus,
      serialMismatchOnly,
      lastDownReason,
      page = 1,
      pageSize = 100,
    } = options;

    log.info('ReportingService', 'Getting offline devices report', {
      dateFrom,
      dateTo,
      ...options,
    });

    // Build WHERE conditions
    const conditions: string[] = [
      'od.report_date >= $1::DATE',
      'od.report_date <= $2::DATE',
    ];
    const params: (string | number | boolean)[] = [dateFrom, dateTo];
    let paramIdx = 3;

    if (zone) {
      conditions.push(`od.zone = $${paramIdx}`);
      params.push(zone);
      paramIdx++;
    }

    if (offlineBucket) {
      conditions.push(`od.offline_bucket = $${paramIdx}`);
      params.push(offlineBucket);
      paramIdx++;
    }

    if (matchStatus) {
      conditions.push(`od.match_status = $${paramIdx}`);
      params.push(matchStatus);
      paramIdx++;
    }

    if (serialMismatchOnly) {
      conditions.push('od.serial_mismatch = true');
    }

    if (lastDownReason) {
      conditions.push(`od.last_down_reason = $${paramIdx}`);
      params.push(lastDownReason);
      paramIdx++;
    }

    const whereClause = conditions.join(' AND ');

    // Get summary stats
    const summaryResult = await pool.query(
      `
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE od.match_status = 'matched_drops') as matched_drops,
        COUNT(*) FILTER (WHERE od.match_status = 'matched_oes') as matched_oes,
        COUNT(*) FILTER (WHERE od.match_status = 'unmatched') as unmatched,
        COUNT(*) FILTER (WHERE od.serial_mismatch = true) as serial_mismatches
      FROM offline_devices od
      WHERE ${whereClause}
      `,
      params
    );

    const summaryRow = summaryResult.rows[0] || {};

    // Get bucket breakdown
    const bucketResult = await pool.query(
      `
      SELECT od.offline_bucket, COUNT(*) as count
      FROM offline_devices od
      WHERE ${whereClause}
      GROUP BY od.offline_bucket
      ORDER BY od.offline_bucket
      `,
      params
    );

    const byBucket: Record<string, number> = {};
    for (const row of bucketResult.rows) {
      if (row.offline_bucket) {
        byBucket[row.offline_bucket] = parseInt(row.count, 10) || 0;
      }
    }

    // Get reason breakdown
    const reasonResult = await pool.query(
      `
      SELECT od.last_down_reason, COUNT(*) as count
      FROM offline_devices od
      WHERE ${whereClause}
      GROUP BY od.last_down_reason
      ORDER BY count DESC
      LIMIT 20
      `,
      params
    );

    const byReason: Record<string, number> = {};
    for (const row of reasonResult.rows) {
      byReason[row.last_down_reason] = parseInt(row.count, 10) || 0;
    }

    // Get zone breakdown
    const zoneResult = await pool.query(
      `
      SELECT od.zone, COUNT(*) as count
      FROM offline_devices od
      WHERE ${whereClause} AND od.zone IS NOT NULL
      GROUP BY od.zone
      ORDER BY od.zone
      `,
      params
    );

    const byZone: Record<string, number> = {};
    for (const row of zoneResult.rows) {
      byZone[row.zone] = parseInt(row.count, 10) || 0;
    }

    // Get available filter options
    const zonesResult = await pool.query(
      `SELECT DISTINCT zone FROM offline_devices WHERE zone IS NOT NULL AND report_date >= $1 AND report_date <= $2 ORDER BY zone`,
      [dateFrom, dateTo]
    );
    const availableZones = zonesResult.rows.map((r) => r.zone);

    const reasonsResult = await pool.query(
      `SELECT DISTINCT last_down_reason FROM offline_devices WHERE report_date >= $1 AND report_date <= $2 ORDER BY last_down_reason`,
      [dateFrom, dateTo]
    );
    const availableReasons = reasonsResult.rows.map((r) => r.last_down_reason);

    const bucketsResult = await pool.query(
      `SELECT DISTINCT offline_bucket FROM offline_devices WHERE offline_bucket IS NOT NULL AND report_date >= $1 AND report_date <= $2 ORDER BY offline_bucket`,
      [dateFrom, dateTo]
    );
    const availableBuckets = bucketsResult.rows.map((r) => r.offline_bucket);

    // Get paginated records
    const offset = (page - 1) * pageSize;
    const recordsResult = await pool.query(
      `
      SELECT
        od.id,
        od.drop_number,
        od.serial_number,
        od.area_code,
        od.zone,
        od.planned_pon,
        od.address,
        od.pole_number,
        od.last_down_reason,
        od.last_inform_date,
        od.days_since_last_inform,
        od.offline_bucket,
        od.match_status,
        od.expected_serial,
        od.serial_mismatch,
        od.report_date,
        od.installation_date,
        od.revenue_30day_avg
      FROM offline_devices od
      WHERE ${whereClause}
      ORDER BY od.days_since_last_inform DESC, od.drop_number
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
      `,
      [...params, pageSize, offset]
    );

    const records: OfflineDeviceRecord[] = recordsResult.rows.map((row) => ({
      id: row.id,
      drop_number: row.drop_number,
      serial_number: row.serial_number,
      area_code: row.area_code,
      zone: row.zone,
      planned_pon: row.planned_pon,
      address: row.address,
      pole_number: row.pole_number,
      last_down_reason: row.last_down_reason,
      last_inform_date: row.last_inform_date
        ? new Date(row.last_inform_date).toISOString()
        : null,
      days_since_last_inform: parseInt(row.days_since_last_inform, 10) || 0,
      offline_bucket: row.offline_bucket,
      match_status: row.match_status as OfflineMatchStatus,
      expected_serial: row.expected_serial,
      serial_mismatch: row.serial_mismatch === true,
      report_date: row.report_date,
      installation_date: row.installation_date,
      revenue_30day_avg: row.revenue_30day_avg
        ? parseFloat(row.revenue_30day_avg)
        : null,
    }));

    const summary: OfflineDevicesSummary = {
      total_devices: parseInt(summaryRow.total, 10) || 0,
      matched_drops: parseInt(summaryRow.matched_drops, 10) || 0,
      matched_oes: parseInt(summaryRow.matched_oes, 10) || 0,
      unmatched: parseInt(summaryRow.unmatched, 10) || 0,
      serial_mismatches: parseInt(summaryRow.serial_mismatches, 10) || 0,
      by_bucket: byBucket,
      by_reason: byReason,
      by_zone: byZone,
    };

    return {
      date_range: { from: dateFrom, to: dateTo },
      project: project || null,
      summary,
      available_zones: availableZones,
      available_reasons: availableReasons,
      available_buckets: availableBuckets,
      records,
      total_count: parseInt(summaryRow.total, 10) || 0,
      page,
      page_size: pageSize,
    };
  } catch (error) {
    log.error('ReportingService', 'Failed to get offline devices report', { error });
    throw error;
  }
}
