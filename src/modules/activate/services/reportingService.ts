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
    'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require',
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
 * - COMPLETE: vlm_categorization_status = 'approved'
 * - INCOMPLETE: vlm_categorization_status != 'approved'
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

    // Query 1: Get INSTALLED DRs with complete/incomplete status
    // Uses dr_photo_unified_reviews.submitted_date (first submission date, preserved on resubmission)
    const installedResult = await pool.query(
      `
      SELECT
        upr.drop_number,
        upr.project,
        COALESCE(d.zone_no, 0) as zone_no,
        COALESCE(d.pon_no, 0) as pon_no,
        CASE
          WHEN upr.vlm_categorization_status = 'approved' THEN true
          ELSE false
        END as is_complete
      FROM dr_photo_unified_reviews upr
      LEFT JOIN drops d ON d.drop_number = upr.drop_number
      WHERE COALESCE(upr.submitted_date, upr.created_at::DATE) >= $1::DATE
        AND COALESCE(upr.submitted_date, upr.created_at::DATE) <= $2::DATE
        AND ($3::TEXT IS NULL OR upr.project = $3)
      `,
      [dateFrom, dateTo, project || null]
    );

    // Query 2: Get ACTIVATED DRs from OES (independent date context)
    // Uses oes_activations.activation_date (when ONT was activated on OES)
    const activatedResult = await pool.query(
      `
      SELECT DISTINCT
        oes.drop_number,
        COALESCE(upr.project, 'Unknown') as project,
        COALESCE(d.zone_no, 0) as zone_no,
        COALESCE(d.pon_no, 0) as pon_no
      FROM oes_activations oes
      LEFT JOIN dr_photo_unified_reviews upr ON upr.drop_number = oes.drop_number
      LEFT JOIN drops d ON d.drop_number = oes.drop_number
      WHERE oes.activation_date >= $1::DATE
        AND oes.activation_date <= $2::DATE
        AND ($3::TEXT IS NULL OR upr.project = $3 OR upr.project IS NULL)
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
      const isComplete = row.is_complete === true;
      const isActivated = activatedSet.has(row.drop_number);

      // Get or create project
      if (!projectMap.has(projectName)) {
        projectMap.set(projectName, {
          project: projectName,
          date: dateFrom === dateTo ? dateFrom : `${dateFrom} to ${dateTo}`,
          total: 0,
          installed: 0,
          activated: 0,
          incomplete: 0,
          complete: 0,
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
      if (isComplete) {
        projectData.complete++;
      } else {
        projectData.incomplete++;
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
          incomplete: 0,
          complete: 0,
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
      if (isComplete) {
        zone.complete++;
      } else {
        zone.incomplete++;
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
          incomplete: 0,
          complete: 0,
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
      if (isComplete) {
        pon.complete++;
      } else {
        pon.incomplete++;
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
          incomplete: 0,
          complete: 0,
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
          incomplete: 0,
          complete: 0,
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
          incomplete: 0,
          complete: 0,
          anomalies: emptyAnomalies(),
        };
        zone.pons.push(pon);
      }

      pon.total++;
      pon.activated++;
      pon.anomalies!.oes_only++;
    }

    // Sort zones and PONs
    for (const projectData of projectMap.values()) {
      projectData.zones.sort((a, b) => a.zone_no - b.zone_no);
      for (const zone of projectData.zones) {
        zone.pons.sort((a, b) => a.pon_no - b.pon_no);
      }
    }

    // Calculate grand totals
    const projects = Array.from(projectMap.values());
    const grandTotal = projects.reduce(
      (acc, p) => ({
        total: acc.total + p.total,
        installed: acc.installed + p.installed,
        activated: acc.activated + p.activated,
        incomplete: acc.incomplete + p.incomplete,
        complete: acc.complete + p.complete,
        anomalies: {
          wa_only: (acc.anomalies?.wa_only || 0) + (p.anomalies?.wa_only || 0),
          oes_only: (acc.anomalies?.oes_only || 0) + (p.anomalies?.oes_only || 0),
        },
      }),
      { total: 0, installed: 0, activated: 0, incomplete: 0, complete: 0, anomalies: emptyAnomalies() }
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
 * - COMPLETE: All steps/photos submitted AND verified by QA (vlm_categorization_status = 'approved')
 * - INCOMPLETE: Missing steps/photos OR not verified by QA
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
        COUNT(*) FILTER (WHERE upr.vlm_categorization_status = 'approved') as complete,
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
      const complete = parseInt(row.complete, 10) || 0;
      const activated = parseInt(row.activated, 10) || 0;
      const ontScanned = parseInt(row.ont_scanned, 10) || 0;
      const upsScanned = parseInt(row.ups_scanned, 10) || 0;

      return {
        user_name: row.user_name,
        sender_phone: row.sender_phone,
        project: row.project || 'Unknown',
        installed,
        complete,
        incomplete: installed - complete,
        activated,
        completion_rate: installed > 0 ? Math.round((complete / installed) * 100) : 0,
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
    const avgCompletionRate =
      users.length > 0
        ? Math.round(
            users.reduce((acc, u) => acc + u.completion_rate, 0) / users.length
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
        avg_completion_rate: avgCompletionRate,
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
