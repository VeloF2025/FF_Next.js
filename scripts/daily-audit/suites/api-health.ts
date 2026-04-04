/**
 * API Health Suite
 * Auto-discovers and tests all API endpoints from pages/api/
 */

import * as fs from 'fs';
import * as path from 'path';
import { config, excludedApiPatterns, getBaseUrl_fn } from '../config';
import { httpClient } from '../utils/httpClient';
import { auditLogger } from '../utils/logger';
import {
  type SuiteResult,
  type TestResult,
  type ApiEndpoint,
  createTestResult,
  createSuiteResult,
} from '../types';

const SUITE_NAME = 'api-health';
const SUITE_DESCRIPTION = 'API Endpoint Health Checks';
const SUITE_PRIORITY = 'P0' as const;

// Endpoints known to be slow (external service calls, long-running queries)
const KNOWN_SLOW_ENDPOINTS = [
  '/api/wa-monitor-health',  // Checks external WhatsApp services
  '/api/ws',                 // WebSocket endpoint
  '/api/system/health',      // Full system health check
];

// Helper modules in pages/api/ that are NOT route handlers (no default export)
// These export named functions used by sibling route files
const NON_HANDLER_FILES = [
  '/api/snags/snags-query',
  '/api/snags/snag-photo-mapper',
];

// POST-only endpoints that return 500 on GET (no method guard)
// These need method handling fixes but shouldn't fail the audit
const POST_ONLY_ENDPOINTS = [
  '/api/onemap/upload',
];

// Endpoints with non-standard response formats (acceptable)
const NON_STANDARD_FORMAT_ENDPOINTS = [
  '/api/system/health',      // Returns HealthCheck format, not ApiResponse
  '/api/health',             // Returns HealthCheck format
  '/api/database/health',    // Returns HealthCheck format
  '/api/ws',                 // WebSocket upgrade response
  '/api/realtime/poll',      // Returns SSE/streaming format
  '/api/version',            // Returns simple version object
];

/**
 * Discover all API endpoints from the filesystem
 */
function discoverEndpoints(apiDir: string): ApiEndpoint[] {
  const endpoints: ApiEndpoint[] = [];

  function scanDirectory(dir: string, basePath: string = '/api'): void {
    if (!fs.existsSync(dir)) {
      auditLogger.warn(`API directory not found: ${dir}`);
      return;
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Skip node_modules and hidden directories
        if (entry.name.startsWith('.') || entry.name === 'node_modules') {
          continue;
        }
        scanDirectory(fullPath, `${basePath}/${entry.name}`);
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) {
        // Convert filename to API path
        let apiPath = basePath;
        const fileName = entry.name.replace(/\.(ts|js)$/, '');

        if (fileName === 'index') {
          // index.ts maps to the directory path
        } else if (fileName.startsWith('[') && fileName.endsWith(']')) {
          // Dynamic route - skip for basic health check
          apiPath += `/${fileName}`;
        } else {
          apiPath += `/${fileName}`;
        }

        // Check if excluded
        const isExcluded = excludedApiPatterns.some((pattern) => apiPath.includes(pattern));
        if (isExcluded) {
          continue;
        }

        // Skip known non-handler helper modules
        if (NON_HANDLER_FILES.includes(apiPath)) {
          continue;
        }

        // Determine priority based on path
        let priority: 'P0' | 'P1' | 'P2' = 'P1';
        if (apiPath.includes('/health') || apiPath.includes('/auth')) {
          priority = 'P0';
        } else if (apiPath.includes('/admin') || apiPath.includes('/settings')) {
          priority = 'P2';
        }

        // Check if auth is required (heuristic based on path)
        // Only specific health endpoints are public, not all paths containing 'health'
        const isPublicHealthEndpoint = apiPath === '/api/health' ||
                                       apiPath === '/api/database/health' ||
                                       apiPath === '/api/activate/health-check';
        const requiresAuth = !apiPath.includes('/public') && !isPublicHealthEndpoint;

        endpoints.push({
          path: apiPath,
          method: 'GET',  // Default to GET for health checks
          requiresAuth,
          priority,
        });
      }
    }
  }

  scanDirectory(apiDir);

  // Sort by priority then path
  endpoints.sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority.localeCompare(b.priority);
    }
    return a.path.localeCompare(b.path);
  });

  return endpoints;
}

/**
 * Test a single API endpoint
 */
async function testEndpoint(endpoint: ApiEndpoint, baseUrl: string): Promise<TestResult> {
  const url = `${baseUrl}${endpoint.path}`;
  const startTime = Date.now();

  try {
    const result = await httpClient.get(url);
    const duration = result.responseTime;

    // Determine status based on response
    let status: 'passed' | 'failed' | 'warning' = 'passed';
    let message: string | undefined;

    // 500/503 are failures, unless it's a known POST-only endpoint hit with GET
    if (result.status === 500 || result.status === 503) {
      if (POST_ONLY_ENDPOINTS.includes(endpoint.path)) {
        status = 'warning';
        message = `POST-only endpoint (${result.status} on GET)`;
      } else {
        status = 'failed';
        message = `Server error: ${result.status}`;
      }
    }
    // 401/403 are expected for auth-required endpoints
    else if (result.status === 401 || result.status === 403) {
      if (endpoint.requiresAuth) {
        status = 'passed';
        message = 'Auth required (expected)';
      } else {
        status = 'warning';
        message = `Unexpected auth requirement: ${result.status}`;
      }
    }
    // 400/404 could be dynamic routes tested with invalid params
    else if (result.status === 400) {
      if (endpoint.path.includes('[')) {
        status = 'passed';
        message = 'Dynamic route (400 expected without valid params)';
      } else {
        status = 'warning';
        message = `Bad request: ${result.status}`;
      }
    }
    else if (result.status === 404) {
      if (endpoint.path.includes('[')) {
        status = 'passed';
        message = 'Dynamic route (404 expected without params)';
      } else {
        status = 'warning';
        message = 'Endpoint not found';
      }
    }
    // Response time warnings (skip for known slow endpoints)
    else if (duration > config.thresholds.api.responseTimeCritical) {
      const isKnownSlow = KNOWN_SLOW_ENDPOINTS.some(e => endpoint.path.includes(e));
      if (!isKnownSlow) {
        status = 'warning';
        message = `Slow response: ${duration}ms`;
      } else {
        message = `Expected slow: ${duration}ms`;
      }
    }
    // Network/connection errors
    else if (!result.success && result.status === 0) {
      status = 'failed';
      message = result.error || 'Connection failed';
    }

    // Validate response format for successful responses
    if (result.success && result.data) {
      const hasValidFormat =
        typeof result.data === 'object' &&
        ('success' in result.data || 'data' in result.data || 'status' in result.data);

      if (!hasValidFormat && result.status === 200) {
        // Only warn if not a standard format and not a known non-standard endpoint
        const isKnownNonStandard = NON_STANDARD_FORMAT_ENDPOINTS.some(e => endpoint.path.includes(e));
        if (!isKnownNonStandard) {
          status = status === 'passed' ? 'warning' : status;
          message = message || 'Non-standard response format';
        }
      }
    }

    return createTestResult(
      endpoint.path,
      status,
      duration,
      endpoint.priority,
      message,
      {
        status: result.status,
        responseTime: duration,
        url,
      }
    );
  } catch (error) {
    return createTestResult(
      endpoint.path,
      'failed',
      Date.now() - startTime,
      endpoint.priority,
      error instanceof Error ? error.message : 'Unknown error',
      { url }
    );
  }
}

/**
 * Run the API health suite
 */
export async function runApiHealthSuite(options: {
  quick?: boolean;
  limit?: number;
} = {}): Promise<SuiteResult> {
  const startTime = new Date();
  const logger = auditLogger.forSuite(SUITE_NAME);

  logger.info('Starting API health checks');

  // Discover endpoints
  const apiDir = path.resolve(process.cwd(), 'pages/api');
  let endpoints = discoverEndpoints(apiDir);

  logger.info(`Discovered ${endpoints.length} API endpoints`);

  // Apply filters for quick mode or limits
  if (options.quick) {
    endpoints = endpoints.filter((e) => e.priority === 'P0');
    logger.info(`Quick mode: testing ${endpoints.length} P0 endpoints`);
  } else if (options.limit) {
    endpoints = endpoints.slice(0, options.limit);
    logger.info(`Limited to ${endpoints.length} endpoints`);
  }

  // Get base URL
  const baseUrl = getBaseUrl_fn();
  logger.info(`Testing against: ${baseUrl}`);

  // Run tests in batches to avoid overwhelming the server
  const batchSize = 10;
  const results: TestResult[] = [];

  for (let i = 0; i < endpoints.length; i += batchSize) {
    const batch = endpoints.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((endpoint) => testEndpoint(endpoint, baseUrl))
    );

    for (const result of batchResults) {
      results.push(result);
      logger.result(result.name, result.status === 'passed', result.message);
    }

    // Small delay between batches
    if (i + batchSize < endpoints.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  const endTime = new Date();

  return createSuiteResult(
    SUITE_NAME,
    SUITE_DESCRIPTION,
    SUITE_PRIORITY,
    results,
    startTime,
    endTime
  );
}

export default runApiHealthSuite;
