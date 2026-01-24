/**
 * Odoo Fleet Audit Script
 *
 * Comprehensive comparison of Odoo fleet data vs FibreFlow fleet data
 * Identifies data gaps, sync issues, and enhancement opportunities
 *
 * Run:
 *   npx tsx scripts/odoo-fleet-audit.ts [options]
 *
 * Options:
 *   --markdown     Output report as markdown file
 *   --json         Output raw data as JSON file
 *   --output-dir   Directory for output files (default: ./docs)
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { neon, NeonQueryFunction } from '@neondatabase/serverless';
import { OdooClient, OdooFleetVehicle, OdooFleetServiceLog, OdooFleetOdometer } from '../src/services/odoo/odooClient';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Types
// ============================================================================

interface FFVehicle {
  id: string;
  registration: string;
  make: string;
  model: string;
  vin: string | null;
  status: string;
  odoo_vehicle_id: number | null;
  current_odometer: number | null;
  created_at: string;
}

interface FFServiceLog {
  id: string;
  vehicle_id: string;
  odoo_service_id: number | null;
  service_type: string;
  amount: number;
  service_date: string;
}

interface FFOdometerReading {
  id: string;
  vehicle_id: string;
  odoo_odometer_id: number | null;
  reading: number;
  reading_date: string;
  source: string;
}

interface FFStaff {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
}

interface AuditReport {
  generatedAt: string;
  database: string;
  vehicleAudit: VehicleAudit;
  serviceLogAudit: ServiceLogAudit;
  odometerAudit: OdometerAudit;
  driverLinkingAudit: DriverLinkingAudit;
  financeAudit: FinanceAudit;
  recommendations: Recommendation[];
}

interface VehicleAudit {
  odoo: {
    total: number;
    active: number;
    withDrivers: number;
    withValue: number;
  };
  ff: {
    total: number;
    active: number;
    withOdooId: number;
    withoutOdooId: number;
  };
  comparison: {
    matched: number;
    inOdooNotFF: OdooFleetVehicle[];
    inFFNotOdoo: FFVehicle[];
  };
  fieldCoverage: {
    field: string;
    odooPopulated: number;
    syncedToFF: boolean;
    ffColumn: string | null;
  }[];
}

interface ServiceLogAudit {
  odoo: {
    total: number;
    byType: Record<string, number>;
    totalAmount: number;
  };
  ff_service_logs: {
    total: number;
    withOdooId: number;
    byType: Record<string, number>;
    totalAmount: number;
  };
  ff_service_history: {
    total: number;
    byType: Record<string, number>;
    totalAmount: number;
  };
  gaps: {
    odooNotSynced: number[];
    orphanedFF: string[];
  };
  dualTableIssue: string;
}

interface OdometerAudit {
  odoo: {
    total: number;
    vehiclesWithReadings: number;
  };
  ff: {
    total: number;
    withOdooId: number;
    bySource: Record<string, number>;
  };
  discrepancies: {
    vehicleReg: string;
    ffReading: number;
    odooReading: number;
    difference: number;
  }[];
}

interface DriverLinkingAudit {
  odooVehiclesWithDrivers: {
    vehicleId: number;
    vehicleName: string;
    driverId: number;
    driverName: string;
  }[];
  potentialMatches: {
    odooDriverName: string;
    ffStaffName: string | null;
    ffStaffId: string | null;
    confidence: 'high' | 'medium' | 'low' | 'none';
  }[];
  linkingOpportunity: number;
}

interface FinanceAudit {
  odooVehiclesWithValues: {
    id: number;
    name: string;
    carValue: number;
    residualValue: number;
    acquisitionDate: string | null;
  }[];
  totalOdooValue: number;
  ffFinanceRecords: number;
  ffVehicleCount: number;
  syncOpportunity: string;
}

interface Recommendation {
  priority: 'high' | 'medium' | 'low';
  category: string;
  title: string;
  description: string;
  effort: string;
}

// ============================================================================
// Audit Functions
// ============================================================================

async function auditVehicles(
  odoo: OdooClient,
  sql: NeonQueryFunction<false, false>
): Promise<VehicleAudit> {
  console.log('Auditing vehicles...');

  // Fetch from Odoo
  const odooVehicles = await odoo.getFleetVehicles({ limit: 500 });

  // Fetch from FF
  const ffVehicles = await sql<FFVehicle[]>`
    SELECT id, registration, make, model, vin, status,
           odoo_vehicle_id, current_odometer, created_at
    FROM fleet_vehicles
  `;

  // Build maps
  const odooById = new Map(odooVehicles.map((v) => [v.id, v]));
  const ffByOdooId = new Map(
    ffVehicles.filter((v) => v.odoo_vehicle_id).map((v) => [v.odoo_vehicle_id, v])
  );

  // Find mismatches
  const inOdooNotFF = odooVehicles.filter((v) => !ffByOdooId.has(v.id));
  const inFFNotOdoo = ffVehicles.filter((v) => !v.odoo_vehicle_id);

  // Field coverage analysis
  const fieldCoverage = [
    { field: 'license_plate', odooPopulated: odooVehicles.filter((v) => v.license_plate).length, syncedToFF: true, ffColumn: 'registration' },
    { field: 'vin_sn', odooPopulated: odooVehicles.filter((v) => v.vin_sn).length, syncedToFF: true, ffColumn: 'vin' },
    { field: 'model_id', odooPopulated: odooVehicles.filter((v) => v.model_id).length, syncedToFF: true, ffColumn: 'model' },
    { field: 'brand_id', odooPopulated: odooVehicles.filter((v) => v.brand_id).length, syncedToFF: true, ffColumn: 'make' },
    { field: 'driver_id', odooPopulated: odooVehicles.filter((v) => v.driver_id).length, syncedToFF: false, ffColumn: null },
    { field: 'car_value', odooPopulated: odooVehicles.filter((v) => v.car_value > 0).length, syncedToFF: false, ffColumn: null },
    { field: 'residual_value', odooPopulated: odooVehicles.filter((v) => v.residual_value > 0).length, syncedToFF: false, ffColumn: null },
    { field: 'acquisition_date', odooPopulated: odooVehicles.filter((v) => v.acquisition_date).length, syncedToFF: false, ffColumn: null },
    { field: 'odometer', odooPopulated: odooVehicles.filter((v) => v.odometer > 0).length, syncedToFF: true, ffColumn: 'current_odometer' },
  ];

  return {
    odoo: {
      total: odooVehicles.length,
      active: odooVehicles.filter((v) => v.active).length,
      withDrivers: odooVehicles.filter((v) => v.driver_id).length,
      withValue: odooVehicles.filter((v) => v.car_value > 0).length,
    },
    ff: {
      total: ffVehicles.length,
      active: ffVehicles.filter((v) => v.status === 'active').length,
      withOdooId: ffVehicles.filter((v) => v.odoo_vehicle_id).length,
      withoutOdooId: ffVehicles.filter((v) => !v.odoo_vehicle_id).length,
    },
    comparison: {
      matched: ffByOdooId.size,
      inOdooNotFF,
      inFFNotOdoo,
    },
    fieldCoverage,
  };
}

async function auditServiceLogs(
  odoo: OdooClient,
  sql: NeonQueryFunction<false, false>
): Promise<ServiceLogAudit> {
  console.log('Auditing service logs...');

  // Fetch from Odoo
  const odooLogs = await odoo.getFleetServiceLogs({ limit: 1000 });

  // Fetch from FF - fleet_service_logs (Odoo-synced)
  const ffServiceLogs = await sql<FFServiceLog[]>`
    SELECT id, vehicle_id, odoo_service_id, service_type, amount, service_date
    FROM fleet_service_logs
  `;

  // Fetch from FF - fleet_service_history (FF-native)
  const ffServiceHistory = await sql<{ id: string; service_type: string; total_cost: number }[]>`
    SELECT id, service_type, COALESCE(total_cost, 0) as total_cost
    FROM fleet_service_history
  `;

  // Analyze Odoo logs
  const odooByType: Record<string, number> = {};
  let odooTotal = 0;
  for (const log of odooLogs) {
    const type = log.service_type_id ? (log.service_type_id as [number, string])[1] : 'Unknown';
    odooByType[type] = (odooByType[type] || 0) + 1;
    odooTotal += log.amount;
  }

  // Analyze FF service_logs
  const ffLogsByType: Record<string, number> = {};
  let ffLogsTotal = 0;
  const syncedOdooIds = new Set<number>();
  for (const log of ffServiceLogs) {
    ffLogsByType[log.service_type] = (ffLogsByType[log.service_type] || 0) + 1;
    ffLogsTotal += log.amount;
    if (log.odoo_service_id) syncedOdooIds.add(log.odoo_service_id);
  }

  // Analyze FF service_history
  const ffHistoryByType: Record<string, number> = {};
  let ffHistoryTotal = 0;
  for (const log of ffServiceHistory) {
    ffHistoryByType[log.service_type] = (ffHistoryByType[log.service_type] || 0) + 1;
    ffHistoryTotal += log.total_cost;
  }

  // Find gaps
  const odooNotSynced = odooLogs.filter((l) => !syncedOdooIds.has(l.id)).map((l) => l.id);

  return {
    odoo: {
      total: odooLogs.length,
      byType: odooByType,
      totalAmount: odooTotal,
    },
    ff_service_logs: {
      total: ffServiceLogs.length,
      withOdooId: ffServiceLogs.filter((l) => l.odoo_service_id).length,
      byType: ffLogsByType,
      totalAmount: ffLogsTotal,
    },
    ff_service_history: {
      total: ffServiceHistory.length,
      byType: ffHistoryByType,
      totalAmount: ffHistoryTotal,
    },
    gaps: {
      odooNotSynced,
      orphanedFF: [], // Would need more analysis
    },
    dualTableIssue: `WARNING: Two service tables exist - fleet_service_logs (${ffServiceLogs.length} Odoo-synced) and fleet_service_history (${ffServiceHistory.length} FF-native). Consider unifying or clearly documenting the purpose of each.`,
  };
}

async function auditOdometer(
  odoo: OdooClient,
  sql: NeonQueryFunction<false, false>
): Promise<OdometerAudit> {
  console.log('Auditing odometer readings...');

  // Fetch from Odoo
  const odooReadings = await odoo.getFleetOdometer({ limit: 2000 });

  // Fetch from FF
  const ffReadings = await sql<FFOdometerReading[]>`
    SELECT id, vehicle_id, odoo_odometer_id, reading, reading_date, source
    FROM fleet_odometer_history
  `;

  // Get FF vehicles with current odometer
  const ffVehicles = await sql<{ registration: string; current_odometer: number; odoo_vehicle_id: number }[]>`
    SELECT registration, current_odometer, odoo_vehicle_id
    FROM fleet_vehicles
    WHERE current_odometer IS NOT NULL AND odoo_vehicle_id IS NOT NULL
  `;

  // Analyze FF by source
  const bySource: Record<string, number> = {};
  for (const r of ffReadings) {
    bySource[r.source || 'unknown'] = (bySource[r.source || 'unknown'] || 0) + 1;
  }

  // Get unique vehicles with readings in Odoo
  const odooVehicleIds = new Set(
    odooReadings.filter((r) => r.vehicle_id).map((r) => (r.vehicle_id as [number, string])[0])
  );

  // Find discrepancies (compare latest readings)
  const discrepancies: OdometerAudit['discrepancies'] = [];
  for (const ffVehicle of ffVehicles) {
    const odooVehicleReadings = odooReadings.filter(
      (r) => r.vehicle_id && (r.vehicle_id as [number, string])[0] === ffVehicle.odoo_vehicle_id
    );
    if (odooVehicleReadings.length > 0) {
      const latestOdoo = odooVehicleReadings.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
      const diff = Math.abs(ffVehicle.current_odometer - latestOdoo.value);
      if (diff > 1000) {
        discrepancies.push({
          vehicleReg: ffVehicle.registration,
          ffReading: ffVehicle.current_odometer,
          odooReading: latestOdoo.value,
          difference: diff,
        });
      }
    }
  }

  return {
    odoo: {
      total: odooReadings.length,
      vehiclesWithReadings: odooVehicleIds.size,
    },
    ff: {
      total: ffReadings.length,
      withOdooId: ffReadings.filter((r) => r.odoo_odometer_id).length,
      bySource,
    },
    discrepancies,
  };
}

async function auditDriverLinking(
  odoo: OdooClient,
  sql: NeonQueryFunction<false, false>
): Promise<DriverLinkingAudit> {
  console.log('Auditing driver linking opportunities...');

  // Get Odoo vehicles with drivers
  const odooVehicles = await odoo.getFleetVehicles({ limit: 500 });
  const vehiclesWithDrivers = odooVehicles
    .filter((v) => v.driver_id)
    .map((v) => ({
      vehicleId: v.id,
      vehicleName: v.name,
      driverId: (v.driver_id as [number, string])[0],
      driverName: (v.driver_id as [number, string])[1],
    }));

  // Get FF staff
  const ffStaff = await sql<FFStaff[]>`
    SELECT id, first_name, last_name, email
    FROM staff
    WHERE is_active = true
  `;

  // Attempt fuzzy matching
  const potentialMatches: DriverLinkingAudit['potentialMatches'] = [];
  const uniqueDrivers = new Map<number, { name: string }>();
  for (const v of vehiclesWithDrivers) {
    uniqueDrivers.set(v.driverId, { name: v.driverName });
  }

  for (const [, driver] of uniqueDrivers) {
    const normalized = driver.name.toLowerCase().trim();

    let bestMatch: { staff: FFStaff; confidence: 'high' | 'medium' | 'low' } | null = null;

    for (const staff of ffStaff) {
      const fullName = `${staff.first_name} ${staff.last_name}`.toLowerCase();

      if (fullName === normalized) {
        bestMatch = { staff, confidence: 'high' };
        break;
      } else if (fullName.includes(normalized) || normalized.includes(fullName)) {
        if (!bestMatch || bestMatch.confidence === 'low') {
          bestMatch = { staff, confidence: 'medium' };
        }
      } else if (
        staff.first_name.toLowerCase() === normalized.split(' ')[0] ||
        staff.last_name.toLowerCase() === normalized.split(' ').slice(-1)[0]
      ) {
        if (!bestMatch) {
          bestMatch = { staff, confidence: 'low' };
        }
      }
    }

    potentialMatches.push({
      odooDriverName: driver.name,
      ffStaffName: bestMatch ? `${bestMatch.staff.first_name} ${bestMatch.staff.last_name}` : null,
      ffStaffId: bestMatch?.staff.id || null,
      confidence: bestMatch?.confidence || 'none',
    });
  }

  return {
    odooVehiclesWithDrivers: vehiclesWithDrivers,
    potentialMatches,
    linkingOpportunity: vehiclesWithDrivers.length,
  };
}

async function auditFinanceData(
  odoo: OdooClient,
  sql: NeonQueryFunction<false, false>
): Promise<FinanceAudit> {
  console.log('Auditing finance/value data...');

  const odooVehicles = await odoo.getFleetVehicles({ limit: 500 });

  const vehiclesWithValues = odooVehicles
    .filter((v) => v.car_value > 0 || v.residual_value > 0)
    .map((v) => ({
      id: v.id,
      name: v.name,
      carValue: v.car_value,
      residualValue: v.residual_value,
      acquisitionDate: v.acquisition_date || null,
    }));

  const totalOdooValue = vehiclesWithValues.reduce((sum, v) => sum + v.carValue, 0);

  // Check FF finance utilization
  const ffFinance = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int as count FROM fleet_vehicle_finance
  `;
  const ffVehicleCount = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int as count FROM fleet_vehicles
  `;

  return {
    odooVehiclesWithValues: vehiclesWithValues,
    totalOdooValue,
    ffFinanceRecords: ffFinance[0]?.count || 0,
    ffVehicleCount: ffVehicleCount[0]?.count || 0,
    syncOpportunity: `${vehiclesWithValues.length} Odoo vehicles have value data (total R${totalOdooValue.toLocaleString()}) that could populate FF fleet_vehicle_finance`,
  };
}

function generateRecommendations(report: Omit<AuditReport, 'recommendations'>): Recommendation[] {
  const recommendations: Recommendation[] = [];

  // Vehicle sync issues
  if (report.vehicleAudit.comparison.inOdooNotFF.length > 0) {
    recommendations.push({
      priority: 'high',
      category: 'Data Sync',
      title: 'Sync Missing Vehicles',
      description: `${report.vehicleAudit.comparison.inOdooNotFF.length} vehicles exist in Odoo but not in FibreFlow. Run fleet sync to import them.`,
      effort: 'Low - Run existing sync script',
    });
  }

  // Driver linking
  if (report.driverLinkingAudit.linkingOpportunity > 0) {
    const highConfidence = report.driverLinkingAudit.potentialMatches.filter((m) => m.confidence === 'high').length;
    recommendations.push({
      priority: 'medium',
      category: 'Data Enhancement',
      title: 'Enable Driver Linking',
      description: `${report.driverLinkingAudit.linkingOpportunity} Odoo vehicles have driver assignments. ${highConfidence} drivers have high-confidence matches to FF staff.`,
      effort: 'Medium - Add odoo_driver_id column, update fleetSync.ts',
    });
  }

  // Finance data
  if (report.financeAudit.odooVehiclesWithValues.length > 0 && report.financeAudit.ffFinanceRecords === 0) {
    recommendations.push({
      priority: 'medium',
      category: 'Data Enhancement',
      title: 'Sync Vehicle Values',
      description: `${report.financeAudit.odooVehiclesWithValues.length} Odoo vehicles have car_value data (R${report.financeAudit.totalOdooValue.toLocaleString()} total). FF fleet_vehicle_finance table is empty.`,
      effort: 'Medium - Update fleetSync.ts to populate finance data',
    });
  }

  // Dual service log table
  recommendations.push({
    priority: 'low',
    category: 'Architecture',
    title: 'Resolve Dual Service Log Tables',
    description: report.serviceLogAudit.dualTableIssue,
    effort: 'Low - Document purpose of each table, or create unified view',
  });

  // Odometer discrepancies
  if (report.odometerAudit.discrepancies.length > 0) {
    recommendations.push({
      priority: 'medium',
      category: 'Data Quality',
      title: 'Investigate Odometer Discrepancies',
      description: `${report.odometerAudit.discrepancies.length} vehicles have >1000km difference between FF and Odoo odometer readings.`,
      effort: 'Medium - Manual review required',
    });
  }

  // Field coverage
  const unsyncedFields = report.vehicleAudit.fieldCoverage.filter((f) => !f.syncedToFF && f.odooPopulated > 0);
  if (unsyncedFields.length > 0) {
    recommendations.push({
      priority: 'low',
      category: 'Data Enhancement',
      title: 'Sync Additional Fields',
      description: `${unsyncedFields.length} Odoo fields have data but are not synced: ${unsyncedFields.map((f) => f.field).join(', ')}`,
      effort: 'Low - Update fleetSync.ts field mappings',
    });
  }

  return recommendations;
}

// ============================================================================
// Report Generation
// ============================================================================

function generateConsoleReport(report: AuditReport): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('='.repeat(79));
  lines.push('                       ODOO FLEET AUDIT REPORT');
  lines.push(`                       Generated: ${report.generatedAt}`);
  lines.push('='.repeat(79));
  lines.push('');

  // Executive Summary
  lines.push('EXECUTIVE SUMMARY');
  lines.push('-'.repeat(79));
  lines.push(`  Odoo Vehicles:           ${report.vehicleAudit.odoo.total}`);
  lines.push(`  FibreFlow Vehicles:      ${report.vehicleAudit.ff.total}`);
  lines.push(`  Matched (synced):        ${report.vehicleAudit.comparison.matched}`);
  lines.push(`  In Odoo, not in FF:      ${report.vehicleAudit.comparison.inOdooNotFF.length}`);
  lines.push(`  In FF only (no Odoo ID): ${report.vehicleAudit.ff.withoutOdooId}`);
  lines.push('');

  // Vehicle Field Coverage
  lines.push('ODOO FIELD COVERAGE');
  lines.push('-'.repeat(79));
  for (const field of report.vehicleAudit.fieldCoverage) {
    const pct = ((field.odooPopulated / report.vehicleAudit.odoo.total) * 100).toFixed(0);
    const synced = field.syncedToFF ? 'Yes' : 'NO';
    lines.push(`  ${field.field.padEnd(20)} ${pct.padStart(3)}% populated  Synced: ${synced.padEnd(3)} ${field.ffColumn ? `-> ${field.ffColumn}` : ''}`);
  }
  lines.push('');

  // Service Logs
  lines.push('SERVICE LOGS');
  lines.push('-'.repeat(79));
  lines.push(`  Odoo:                    ${report.serviceLogAudit.odoo.total} (R${report.serviceLogAudit.odoo.totalAmount.toLocaleString()})`);
  lines.push(`  FF fleet_service_logs:   ${report.serviceLogAudit.ff_service_logs.total} (R${report.serviceLogAudit.ff_service_logs.totalAmount.toLocaleString()})`);
  lines.push(`  FF fleet_service_history: ${report.serviceLogAudit.ff_service_history.total} (R${report.serviceLogAudit.ff_service_history.totalAmount.toLocaleString()})`);
  lines.push(`  Not synced from Odoo:    ${report.serviceLogAudit.gaps.odooNotSynced.length}`);
  lines.push('');
  lines.push(`  WARNING: ${report.serviceLogAudit.dualTableIssue}`);
  lines.push('');

  // Odometer
  lines.push('ODOMETER READINGS');
  lines.push('-'.repeat(79));
  lines.push(`  Odoo readings:           ${report.odometerAudit.odoo.total}`);
  lines.push(`  FF readings:             ${report.odometerAudit.ff.total}`);
  lines.push(`  Discrepancies (>1000km): ${report.odometerAudit.discrepancies.length}`);
  if (report.odometerAudit.discrepancies.length > 0) {
    lines.push('');
    lines.push('  Top discrepancies:');
    for (const d of report.odometerAudit.discrepancies.slice(0, 5)) {
      lines.push(`    ${d.vehicleReg}: FF=${d.ffReading.toLocaleString()}km, Odoo=${d.odooReading.toLocaleString()}km (diff: ${d.difference.toLocaleString()}km)`);
    }
  }
  lines.push('');

  // Driver Linking
  lines.push('DRIVER LINKING OPPORTUNITY');
  lines.push('-'.repeat(79));
  lines.push(`  Odoo vehicles with drivers: ${report.driverLinkingAudit.linkingOpportunity}`);
  const highMatch = report.driverLinkingAudit.potentialMatches.filter((m) => m.confidence === 'high').length;
  const medMatch = report.driverLinkingAudit.potentialMatches.filter((m) => m.confidence === 'medium').length;
  const noMatch = report.driverLinkingAudit.potentialMatches.filter((m) => m.confidence === 'none').length;
  lines.push(`  High confidence matches:    ${highMatch}`);
  lines.push(`  Medium confidence matches:  ${medMatch}`);
  lines.push(`  No matches found:           ${noMatch}`);
  lines.push('');

  // Finance
  lines.push('FINANCE/VALUE DATA');
  lines.push('-'.repeat(79));
  lines.push(`  Odoo vehicles with values:  ${report.financeAudit.odooVehiclesWithValues.length}`);
  lines.push(`  Total Odoo vehicle value:   R${report.financeAudit.totalOdooValue.toLocaleString()}`);
  lines.push(`  FF finance records:         ${report.financeAudit.ffFinanceRecords}`);
  lines.push(`  FF total vehicles:          ${report.financeAudit.ffVehicleCount}`);
  lines.push('');

  // Recommendations
  lines.push('RECOMMENDATIONS');
  lines.push('-'.repeat(79));
  for (const rec of report.recommendations) {
    const priority = rec.priority === 'high' ? '[HIGH]' : rec.priority === 'medium' ? '[MED]' : '[LOW]';
    lines.push(`  ${priority} ${rec.title}`);
    lines.push(`       ${rec.description}`);
    lines.push(`       Effort: ${rec.effort}`);
    lines.push('');
  }

  lines.push('='.repeat(79));
  lines.push('End of Report');
  lines.push('='.repeat(79));

  return lines.join('\n');
}

function generateMarkdownReport(report: AuditReport): string {
  const lines: string[] = [];

  lines.push('# Odoo Fleet Audit Report');
  lines.push('');
  lines.push(`**Generated:** ${report.generatedAt}`);
  lines.push(`**Database:** ${report.database}`);
  lines.push('');

  lines.push('## Executive Summary');
  lines.push('');
  lines.push('| Metric | Count |');
  lines.push('|--------|-------|');
  lines.push(`| Odoo Vehicles | ${report.vehicleAudit.odoo.total} |`);
  lines.push(`| FibreFlow Vehicles | ${report.vehicleAudit.ff.total} |`);
  lines.push(`| Matched (synced) | ${report.vehicleAudit.comparison.matched} |`);
  lines.push(`| In Odoo only | ${report.vehicleAudit.comparison.inOdooNotFF.length} |`);
  lines.push(`| In FF only | ${report.vehicleAudit.ff.withoutOdooId} |`);
  lines.push('');

  lines.push('## Field Coverage');
  lines.push('');
  lines.push('| Field | Populated | Synced | FF Column |');
  lines.push('|-------|-----------|--------|-----------|');
  for (const f of report.vehicleAudit.fieldCoverage) {
    const pct = ((f.odooPopulated / report.vehicleAudit.odoo.total) * 100).toFixed(0);
    lines.push(`| ${f.field} | ${pct}% | ${f.syncedToFF ? 'Yes' : '**No**'} | ${f.ffColumn || '-'} |`);
  }
  lines.push('');

  lines.push('## Recommendations');
  lines.push('');
  for (const rec of report.recommendations) {
    const emoji = rec.priority === 'high' ? '🔴' : rec.priority === 'medium' ? '🟡' : '🟢';
    lines.push(`### ${emoji} ${rec.title}`);
    lines.push('');
    lines.push(`**Priority:** ${rec.priority.toUpperCase()} | **Category:** ${rec.category} | **Effort:** ${rec.effort}`);
    lines.push('');
    lines.push(rec.description);
    lines.push('');
  }

  return lines.join('\n');
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const outputMarkdown = args.includes('--markdown');
  const outputJson = args.includes('--json');
  const outputDirArg = args.find((a) => a.startsWith('--output-dir='));
  const outputDir = outputDirArg ? outputDirArg.split('=')[1] : './docs';

  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    console.error('ERROR: DATABASE_URL environment variable required');
    process.exit(1);
  }

  // Check for Odoo credentials
  const ODOO_URL = process.env.ODOO_URL || 'https://velocityfibre.odoo.com';
  const ODOO_DB = process.env.ODOO_DB || 'velocityfibre';
  const ODOO_USERNAME = process.env.ODOO_USERNAME || 'jacques@velocityfibre.co.za';
  const ODOO_PASSWORD = process.env.ODOO_PASSWORD;

  if (!ODOO_PASSWORD) {
    console.error('ERROR: ODOO_PASSWORD environment variable required');
    process.exit(1);
  }

  const sql = neon(DATABASE_URL);
  const odoo = new OdooClient({
    url: ODOO_URL,
    db: ODOO_DB,
    username: ODOO_USERNAME,
    password: ODOO_PASSWORD,
  });

  console.log('='.repeat(60));
  console.log('Odoo Fleet Audit');
  console.log('='.repeat(60));
  console.log('');
  console.log('Connecting to Odoo...');

  try {
    const connection = await odoo.testConnection();
    if (!connection.success) {
      console.error('Failed to connect to Odoo:', connection.message);
      process.exit(1);
    }
    console.log(`Connected to Odoo ${connection.version}`);
    console.log('');

    // Run audits
    const vehicleAudit = await auditVehicles(odoo, sql);
    const serviceLogAudit = await auditServiceLogs(odoo, sql);
    const odometerAudit = await auditOdometer(odoo, sql);
    const driverLinkingAudit = await auditDriverLinking(odoo, sql);
    const financeAudit = await auditFinanceData(odoo, sql);

    // Build partial report for recommendations
    const partialReport = {
      generatedAt: new Date().toISOString(),
      database: DATABASE_URL.includes('ep-dry-night') ? 'Production' : 'Development',
      vehicleAudit,
      serviceLogAudit,
      odometerAudit,
      driverLinkingAudit,
      financeAudit,
    };

    // Generate recommendations
    const recommendations = generateRecommendations(partialReport);

    const report: AuditReport = {
      ...partialReport,
      recommendations,
    };

    // Output console report
    console.log(generateConsoleReport(report));

    // Output markdown if requested
    if (outputMarkdown) {
      const mdPath = path.join(outputDir, 'FLEET_AUDIT_REPORT.md');
      fs.mkdirSync(outputDir, { recursive: true });
      fs.writeFileSync(mdPath, generateMarkdownReport(report));
      console.log(`\nMarkdown report saved to: ${mdPath}`);
    }

    // Output JSON if requested
    if (outputJson) {
      const jsonPath = path.join(outputDir, 'fleet_audit_data.json');
      fs.mkdirSync(outputDir, { recursive: true });
      fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
      console.log(`\nJSON data saved to: ${jsonPath}`);
    }

  } catch (error) {
    console.error('Audit failed:', error);
    process.exit(1);
  }
}

main();
