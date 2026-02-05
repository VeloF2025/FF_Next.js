/**
 * Cross-Module Integration Suite
 * Tests data flow and integration between modules
 */

import { config, moduleIntegrations, getBaseUrl_fn } from '../config';
import { httpClient } from '../utils/httpClient';
import { auditLogger } from '../utils/logger';
import {
  type SuiteResult,
  type TestResult,
  createTestResult,
  createSuiteResult,
} from '../types';

// Dynamic import for database
let sql: any;

async function loadDb(): Promise<void> {
  if (!sql) {
    const dbModule = await import('../../../lib/db/pool.js');
    sql = dbModule.sql;
  }
}

const SUITE_NAME = 'cross-module';
const SUITE_DESCRIPTION = 'Cross-Module Integration Tests';
const SUITE_PRIORITY = 'P1' as const;

/**
 * Test SOW Import → Drops table integration
 */
async function testSowToDrops(): Promise<TestResult> {
  const startTime = Date.now();

  try {
    await loadDb();

    // Check if drops table has data from SOW imports
    const result = await sql`
      SELECT
        COUNT(*) as total_drops,
        COUNT(DISTINCT project_id) as projects_with_drops,
        MAX(created_at) as last_drop_created
      FROM drops
    `;

    const duration = Date.now() - startTime;
    const stats = result[0];

    if (stats.total_drops > 0) {
      return createTestResult(
        'SOW Import → Drops',
        'passed',
        duration,
        'P1',
        `${stats.total_drops} drops across ${stats.projects_with_drops} projects`,
        {
          totalDrops: parseInt(stats.total_drops),
          projectsWithDrops: parseInt(stats.projects_with_drops),
          lastCreated: stats.last_drop_created,
        }
      );
    }

    return createTestResult(
      'SOW Import → Drops',
      'warning',
      duration,
      'P1',
      'No drops in database'
    );
  } catch (error) {
    return createTestResult(
      'SOW Import → Drops',
      'failed',
      Date.now() - startTime,
      'P1',
      error instanceof Error ? error.message : 'Integration check failed'
    );
  }
}

/**
 * Test DR Photo → Unified Reviews integration
 */
async function testDrPhotoToUnifiedReviews(): Promise<TestResult> {
  const startTime = Date.now();

  try {
    await loadDb();

    // Check dr_photo_unified_reviews table using overall_status column
    const result = await sql`
      SELECT
        COUNT(*) as total_reviews,
        COUNT(CASE WHEN overall_status = 'pass' THEN 1 END) as passed,
        COUNT(CASE WHEN overall_status = 'fail' THEN 1 END) as failed,
        COUNT(CASE WHEN overall_status IS NULL OR overall_status = 'pending' THEN 1 END) as pending
      FROM dr_photo_unified_reviews
    `;

    const duration = Date.now() - startTime;
    const stats = result[0];

    if (stats.total_reviews > 0) {
      return createTestResult(
        'DR Photo → Unified Reviews',
        'passed',
        duration,
        'P1',
        `${stats.total_reviews} reviews (${stats.passed} passed, ${stats.pending} pending)`,
        {
          totalReviews: parseInt(stats.total_reviews),
          passed: parseInt(stats.passed),
          failed: parseInt(stats.failed),
          pending: parseInt(stats.pending),
        }
      );
    }

    return createTestResult(
      'DR Photo → Unified Reviews',
      'warning',
      duration,
      'P1',
      'No unified reviews in database'
    );
  } catch (error) {
    return createTestResult(
      'DR Photo → Unified Reviews',
      'failed',
      Date.now() - startTime,
      'P1',
      error instanceof Error ? error.message : 'Integration check failed'
    );
  }
}

/**
 * Test QA Approval → WhatsApp notification path
 */
async function testQaToWhatsApp(): Promise<TestResult> {
  const startTime = Date.now();

  try {
    // Check if WhatsApp sender service is reachable
    const result = await httpClient.healthCheck(`${config.services.waSender.url}${config.services.waSender.healthPath}`);
    const duration = result.responseTime;

    if (result.success) {
      // Service is up - integration path is available
      return createTestResult(
        'QA Approval → WhatsApp',
        'passed',
        duration,
        'P1',
        'WhatsApp sender available',
        { httpStatus: result.status }
      );
    }

    return createTestResult(
      'QA Approval → WhatsApp',
      'warning',
      duration,
      'P1',
      'WhatsApp sender unavailable',
      { httpStatus: result.status, error: result.error }
    );
  } catch (error) {
    return createTestResult(
      'QA Approval → WhatsApp',
      'failed',
      Date.now() - startTime,
      'P1',
      error instanceof Error ? error.message : 'Integration check failed'
    );
  }
}

/**
 * Test PO Creation → Purchase Orders integration
 */
async function testPoToPurchaseOrders(): Promise<TestResult> {
  const startTime = Date.now();

  try {
    await loadDb();

    // Check purchase_orders table
    const result = await sql`
      SELECT
        COUNT(*) as total_pos,
        COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved,
        COUNT(CASE WHEN status = 'draft' THEN 1 END) as draft,
        SUM(COALESCE(total_amount, 0)) as total_value
      FROM purchase_orders
    `;

    const duration = Date.now() - startTime;
    const stats = result[0];

    if (stats.total_pos > 0) {
      return createTestResult(
        'PO Creation → Purchase Orders',
        'passed',
        duration,
        'P1',
        `${stats.total_pos} POs (${stats.approved} approved)`,
        {
          totalPOs: parseInt(stats.total_pos),
          approved: parseInt(stats.approved),
          draft: parseInt(stats.draft),
          totalValue: parseFloat(stats.total_value || 0),
        }
      );
    }

    return createTestResult(
      'PO Creation → Purchase Orders',
      'warning',
      duration,
      'P1',
      'No purchase orders in database'
    );
  } catch (error) {
    return createTestResult(
      'PO Creation → Purchase Orders',
      'failed',
      Date.now() - startTime,
      'P1',
      error instanceof Error ? error.message : 'Integration check failed'
    );
  }
}

/**
 * Test Fleet Check-in → VLM integration
 */
async function testFleetToVlm(): Promise<TestResult> {
  const startTime = Date.now();

  try {
    // Check if VLM service is reachable
    const result = await httpClient.healthCheck(`${config.services.vlm.url}${config.services.vlm.healthPath}`);
    const duration = result.responseTime;

    if (result.success) {
      // Also check database for fleet check records and VLM results
      // Join: fleet_check_records -> fleet_check_photos -> fleet_photo_vlm_results
      await loadDb();
      const checkInResult = await sql`
        SELECT
          COUNT(DISTINCT fcr.id) as total_checkins,
          COUNT(DISTINCT fpv.id) as vlm_processed
        FROM fleet_check_records fcr
        LEFT JOIN fleet_check_photos fcp ON fcp.record_id = fcr.id
        LEFT JOIN fleet_photo_vlm_results fpv ON fpv.photo_id = fcp.id
        WHERE fcr.created_at > NOW() - INTERVAL '30 days'
      `;

      const stats = checkInResult[0];
      const totalCheckins = parseInt(stats.total_checkins || 0);
      const vlmProcessed = parseInt(stats.vlm_processed || 0);

      return createTestResult(
        'Fleet Check-in → VLM',
        'passed',
        Date.now() - startTime,
        'P1',
        `VLM up, ${vlmProcessed}/${totalCheckins} VLM results (30d)`,
        {
          vlmStatus: result.status,
          totalCheckins,
          vlmProcessed,
        }
      );
    }

    return createTestResult(
      'Fleet Check-in → VLM',
      'warning',
      duration,
      'P1',
      'VLM service unavailable',
      { httpStatus: result.status, error: result.error }
    );
  } catch (error) {
    return createTestResult(
      'Fleet Check-in → VLM',
      'failed',
      Date.now() - startTime,
      'P1',
      error instanceof Error ? error.message : 'Integration check failed'
    );
  }
}

/**
 * Test data consistency between related tables
 */
async function testDataConsistency(): Promise<TestResult[]> {
  const results: TestResult[] = [];

  try {
    await loadDb();

    // Test: All drops should have valid project_id
    const orphanDrops = await sql`
      SELECT COUNT(*) as count
      FROM drops d
      LEFT JOIN projects p ON d.project_id = p.id
      WHERE p.id IS NULL AND d.project_id IS NOT NULL
    `;

    results.push(
      createTestResult(
        'Data Consistency: Drops → Projects',
        parseInt(orphanDrops[0].count) === 0 ? 'passed' : 'warning',
        0,
        'P1',
        parseInt(orphanDrops[0].count) === 0
          ? 'All drops linked to valid projects'
          : `${orphanDrops[0].count} orphan drops found`
      )
    );

    // Test: All staff should have valid user_id
    const orphanStaff = await sql`
      SELECT COUNT(*) as count
      FROM staff s
      LEFT JOIN users u ON s.user_id = u.id
      WHERE u.id IS NULL AND s.user_id IS NOT NULL
    `;

    results.push(
      createTestResult(
        'Data Consistency: Staff → Users',
        parseInt(orphanStaff[0].count) === 0 ? 'passed' : 'warning',
        0,
        'P1',
        parseInt(orphanStaff[0].count) === 0
          ? 'All staff linked to valid users'
          : `${orphanStaff[0].count} orphan staff records found`
      )
    );

    // Test: All vehicles should have license_disc data if active
    const vehiclesWithoutDisc = await sql`
      SELECT COUNT(*) as count
      FROM fleet_vehicles v
      LEFT JOIN fleet_license_disc ld ON v.id = ld.vehicle_id
      WHERE v.status = 'active' AND ld.id IS NULL
    `;

    results.push(
      createTestResult(
        'Data Consistency: Vehicles → License Discs',
        parseInt(vehiclesWithoutDisc[0].count) === 0 ? 'passed' : 'warning',
        0,
        'P1',
        parseInt(vehiclesWithoutDisc[0].count) === 0
          ? 'All active vehicles have license disc data'
          : `${vehiclesWithoutDisc[0].count} vehicles without license disc`
      )
    );
  } catch (error) {
    results.push(
      createTestResult(
        'Data Consistency',
        'failed',
        0,
        'P1',
        error instanceof Error ? error.message : 'Consistency check failed'
      )
    );
  }

  return results;
}

/**
 * Run the cross-module integration suite
 */
export async function runCrossModuleSuite(options: {
  quick?: boolean;
} = {}): Promise<SuiteResult> {
  const startTime = new Date();
  const logger = auditLogger.forSuite(SUITE_NAME);

  logger.info('Starting cross-module integration tests');

  const results: TestResult[] = [];

  // Core integration tests
  logger.info('Testing module integrations...');

  const sowResult = await testSowToDrops();
  results.push(sowResult);
  logger.result(sowResult.name, sowResult.status === 'passed', sowResult.message);

  const drPhotoResult = await testDrPhotoToUnifiedReviews();
  results.push(drPhotoResult);
  logger.result(drPhotoResult.name, drPhotoResult.status === 'passed', drPhotoResult.message);

  const qaResult = await testQaToWhatsApp();
  results.push(qaResult);
  logger.result(qaResult.name, qaResult.status === 'passed', qaResult.message);

  const poResult = await testPoToPurchaseOrders();
  results.push(poResult);
  logger.result(poResult.name, poResult.status === 'passed', poResult.message);

  const fleetResult = await testFleetToVlm();
  results.push(fleetResult);
  logger.result(fleetResult.name, fleetResult.status === 'passed', fleetResult.message);

  // Data consistency tests (skip in quick mode)
  if (!options.quick) {
    logger.info('Testing data consistency...');
    const consistencyResults = await testDataConsistency();
    for (const result of consistencyResults) {
      results.push(result);
      logger.result(result.name, result.status === 'passed', result.message);
    }
  }

  const endTime = new Date();

  return createSuiteResult(SUITE_NAME, SUITE_DESCRIPTION, SUITE_PRIORITY, results, startTime, endTime);
}

export default runCrossModuleSuite;
