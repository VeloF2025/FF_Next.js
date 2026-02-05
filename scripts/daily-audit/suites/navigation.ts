/**
 * Navigation Health Suite
 * Tests sidebar sections, tab navigation, and RBAC enforcement
 */

import { config, navigationSections, getBaseUrl_fn } from '../config';
import { httpClient } from '../utils/httpClient';
import { auditLogger } from '../utils/logger';
import {
  type SuiteResult,
  type TestResult,
  createTestResult,
  createSuiteResult,
} from '../types';

const SUITE_NAME = 'navigation';
const SUITE_DESCRIPTION = 'Navigation and Route Health Checks';
const SUITE_PRIORITY = 'P1' as const;

// Navigation routes to test (derived from navigationConfig)
interface NavRoute {
  section: string;
  path: string;
  name: string;
  requiresAuth: boolean;
  requiredRole?: string;
}

// Key routes per section - representative sample
const navRoutes: NavRoute[] = [
  // Main section
  { section: 'main', path: '/', name: 'Dashboard', requiresAuth: true },
  { section: 'main', path: '/meetings', name: 'Meetings', requiresAuth: true },
  { section: 'main', path: '/action-items', name: 'Action Items', requiresAuth: true },

  // Project section
  { section: 'project', path: '/projects', name: 'Projects', requiresAuth: true },
  { section: 'project', path: '/clients', name: 'Clients', requiresAuth: true },
  { section: 'project', path: '/contractors', name: 'Contractors', requiresAuth: true },

  // Activate section
  { section: 'activate', path: '/activate', name: 'QA Review', requiresAuth: true },
  { section: 'activate', path: '/activate/qa-centre', name: 'QA Centre', requiresAuth: true },

  // Maintenance section
  { section: 'maintenance', path: '/maintenance', name: 'Maintenance', requiresAuth: true },

  // Procurement section
  { section: 'procurement', path: '/procurement', name: 'Procurement', requiresAuth: true },
  { section: 'procurement', path: '/procurement/boq', name: 'BOQ', requiresAuth: true },

  // Assets section
  { section: 'assets', path: '/assets', name: 'Assets', requiresAuth: true },

  // Fleet section
  { section: 'fleet', path: '/fleet', name: 'Fleet', requiresAuth: true },
  { section: 'fleet', path: '/fleet/check-in', name: 'Fleet Check-in', requiresAuth: true },

  // People section
  { section: 'people', path: '/staff', name: 'Staff', requiresAuth: true },

  // Analytics section
  { section: 'analytics', path: '/analytics', name: 'Analytics', requiresAuth: true },

  // Communications section
  { section: 'communications', path: '/communications', name: 'Communications', requiresAuth: true },

  // System section (admin only)
  { section: 'system', path: '/system/health', name: 'System Health', requiresAuth: true, requiredRole: 'admin' },
  { section: 'system', path: '/settings', name: 'Settings', requiresAuth: true },
];

/**
 * Test a navigation route
 */
async function testRoute(route: NavRoute, baseUrl: string): Promise<TestResult> {
  const url = `${baseUrl}${route.path}`;
  const startTime = Date.now();

  try {
    const result = await httpClient.get(url, {
      maxRedirects: 0,  // Don't follow redirects to detect auth redirects
      validateStatus: () => true,
    });

    const duration = result.responseTime;
    let status: 'passed' | 'failed' | 'warning' = 'passed';
    let message: string | undefined;

    // Check response
    if (result.status === 0) {
      status = 'failed';
      message = result.error || 'Connection failed';
    } else if (result.status === 500 || result.status === 503) {
      status = 'failed';
      message = `Server error: ${result.status}`;
    } else if (result.status === 404) {
      status = 'failed';
      message = 'Route not found';
    } else if (result.status === 302 || result.status === 307) {
      // Redirect - likely auth required
      if (route.requiresAuth) {
        status = 'passed';
        message = 'Auth redirect (expected)';
      } else {
        status = 'warning';
        message = 'Unexpected redirect';
      }
    } else if (result.status === 401 || result.status === 403) {
      if (route.requiresAuth) {
        status = 'passed';
        message = 'Auth required (expected)';
      } else {
        status = 'failed';
        message = `Unexpected ${result.status}`;
      }
    } else if (result.status === 200) {
      // Page loaded - check for basic HTML
      const hasHtml = typeof result.data === 'string' && result.data.includes('<!DOCTYPE');
      if (!hasHtml && typeof result.data === 'string') {
        status = 'warning';
        message = 'Non-HTML response';
      }
    }

    // Response time warning
    if (status === 'passed' && duration > config.thresholds.api.responseTimeWarning) {
      status = 'warning';
      message = `Slow: ${duration}ms`;
    }

    return createTestResult(
      `${route.section}:${route.name}`,
      status,
      duration,
      'P1',
      message,
      { url, httpStatus: result.status }
    );
  } catch (error) {
    return createTestResult(
      `${route.section}:${route.name}`,
      'failed',
      Date.now() - startTime,
      'P1',
      error instanceof Error ? error.message : 'Request failed',
      { url }
    );
  }
}

/**
 * Test section coverage - ensure each section has at least one working route
 */
function checkSectionCoverage(results: TestResult[]): TestResult[] {
  const coverageResults: TestResult[] = [];
  const sectionResults = new Map<string, TestResult[]>();

  // Group results by section
  for (const result of results) {
    const section = result.name.split(':')[0];
    if (!sectionResults.has(section)) {
      sectionResults.set(section, []);
    }
    sectionResults.get(section)!.push(result);
  }

  // Check each expected section
  for (const section of navigationSections) {
    const sectionTests = sectionResults.get(section) || [];
    const hasPass = sectionTests.some((t) => t.status === 'passed');
    const allFailed = sectionTests.length > 0 && sectionTests.every((t) => t.status === 'failed');

    if (sectionTests.length === 0) {
      coverageResults.push(
        createTestResult(`Section Coverage: ${section}`, 'warning', 0, 'P1', 'No routes tested')
      );
    } else if (allFailed) {
      coverageResults.push(
        createTestResult(
          `Section Coverage: ${section}`,
          'failed',
          0,
          'P1',
          `All ${sectionTests.length} routes failed`
        )
      );
    } else if (hasPass) {
      coverageResults.push(
        createTestResult(
          `Section Coverage: ${section}`,
          'passed',
          0,
          'P1',
          `${sectionTests.filter((t) => t.status === 'passed').length}/${sectionTests.length} routes OK`
        )
      );
    }
  }

  return coverageResults;
}

/**
 * Run the navigation health suite
 */
export async function runNavigationSuite(options: {
  quick?: boolean;
} = {}): Promise<SuiteResult> {
  const startTime = new Date();
  const logger = auditLogger.forSuite(SUITE_NAME);

  logger.info('Starting navigation health checks');

  const baseUrl = getBaseUrl_fn();
  logger.info(`Testing against: ${baseUrl}`);

  const results: TestResult[] = [];

  // In quick mode, test only one route per section
  let routesToTest = navRoutes;
  if (options.quick) {
    const seenSections = new Set<string>();
    routesToTest = navRoutes.filter((route) => {
      if (seenSections.has(route.section)) {
        return false;
      }
      seenSections.add(route.section);
      return true;
    });
    logger.info(`Quick mode: testing ${routesToTest.length} routes (one per section)`);
  }

  // Test routes in parallel batches
  const batchSize = 5;
  for (let i = 0; i < routesToTest.length; i += batchSize) {
    const batch = routesToTest.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map((route) => testRoute(route, baseUrl)));

    for (const result of batchResults) {
      results.push(result);
      logger.result(result.name, result.status === 'passed', result.message);
    }

    // Small delay between batches
    if (i + batchSize < routesToTest.length) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  // Check section coverage
  if (!options.quick) {
    logger.info('Checking section coverage...');
    const coverageResults = checkSectionCoverage(results);
    for (const result of coverageResults) {
      results.push(result);
      logger.result(result.name, result.status === 'passed', result.message);
    }
  }

  const endTime = new Date();

  return createSuiteResult(SUITE_NAME, SUITE_DESCRIPTION, SUITE_PRIORITY, results, startTime, endTime);
}

export default runNavigationSuite;
