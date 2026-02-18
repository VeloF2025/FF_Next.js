/**
 * External Services Health Suite
 * Tests all external service integrations: VLM, WhatsApp, 1Map, Sage, Resend
 */

import { config } from '../config';
import { httpClient } from '../utils/httpClient';
import { auditLogger } from '../utils/logger';
import {
  type SuiteResult,
  type TestResult,
  type ServiceHealth,
  createTestResult,
  createSuiteResult,
} from '../types';

const SUITE_NAME = 'external-services';
const SUITE_DESCRIPTION = 'External Service Health Checks';
const SUITE_PRIORITY = 'P0' as const;

interface ServiceConfig {
  name: string;
  url: string;
  healthPath: string;
  priority: 'P0' | 'P1' | 'P2';
  validateResponse?: (data: any) => boolean;
  expectGpuMemory?: boolean;
}

const services: ServiceConfig[] = [
  {
    name: 'VLM Qwen3',
    url: config.services.vlm.url,
    healthPath: config.services.vlm.healthPath,
    priority: 'P0',
    expectGpuMemory: true,
    validateResponse: (data) => {
      // VLM should return GPU memory info
      return data && (data.status === 'ok' || data.gpu_memory_gb !== undefined);
    },
  },
  {
    name: 'WhatsApp Bridge',
    url: config.services.waBridge.url,
    healthPath: config.services.waBridge.healthPath,
    priority: 'P0',
  },
  {
    name: 'VF Storage',
    url: config.services.vfStorage.url,
    healthPath: config.services.vfStorage.healthPath,
    priority: 'P1',
  },
  {
    name: 'QField Sync',
    url: config.services.qfieldSync.url,
    healthPath: config.services.qfieldSync.healthPath,
    priority: 'P1',
  },
];

/**
 * Test a single service health endpoint
 */
async function testService(service: ServiceConfig): Promise<TestResult> {
  const url = `${service.url}${service.healthPath}`;
  const startTime = Date.now();

  try {
    const result = await httpClient.healthCheck(url);
    const duration = result.responseTime;

    let status: 'passed' | 'failed' | 'warning' = 'passed';
    let message: string | undefined;
    const details: Record<string, any> = {
      url,
      httpStatus: result.status,
      responseTime: duration,
    };

    // Check HTTP status
    if (result.status === 0) {
      status = 'failed';
      message = result.error || 'Connection refused';
    } else if (result.status >= 500) {
      status = 'failed';
      message = `Server error: ${result.status}`;
    } else if (result.status >= 400) {
      status = 'warning';
      message = `HTTP ${result.status}`;
    }

    // Validate response if validator provided
    if (status === 'passed' && service.validateResponse && result.data) {
      if (!service.validateResponse(result.data)) {
        status = 'warning';
        message = 'Unexpected response format';
      } else {
        details.data = result.data;
      }
    }

    // Check for GPU memory on VLM
    if (service.expectGpuMemory && result.data) {
      if (result.data.gpu_memory_gb !== undefined) {
        details.gpuMemoryGb = result.data.gpu_memory_gb;
        message = `GPU: ${result.data.gpu_memory_gb}GB`;
      }
    }

    // Response time check
    if (status === 'passed' && duration > config.thresholds.api.responseTimeWarning) {
      status = 'warning';
      message = `Slow response: ${duration}ms`;
    }

    return createTestResult(service.name, status, duration, service.priority, message, details);
  } catch (error) {
    return createTestResult(
      service.name,
      'failed',
      Date.now() - startTime,
      service.priority,
      error instanceof Error ? error.message : 'Health check failed',
      { url }
    );
  }
}

/**
 * Test 1Map API with authentication
 */
async function test1MapApi(): Promise<TestResult> {
  const startTime = Date.now();

  // Check if 1Map credentials are configured
  const apiKey = process.env.ONEMAP_API_KEY;
  if (!apiKey) {
    return createTestResult(
      '1Map API',
      'skipped',
      Date.now() - startTime,
      'P1',
      'API key not configured'
    );
  }

  try {
    const result = await httpClient.get(`${config.services.oneMap.baseUrl}${config.services.oneMap.testEndpoint}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    const duration = result.responseTime;

    if (result.status === 200) {
      return createTestResult(
        '1Map API',
        'passed',
        duration,
        'P1',
        'Authenticated successfully',
        { httpStatus: result.status }
      );
    } else if (result.status === 401) {
      return createTestResult(
        '1Map API',
        'failed',
        duration,
        'P1',
        'Authentication failed',
        { httpStatus: result.status }
      );
    }

    return createTestResult(
      '1Map API',
      'warning',
      duration,
      'P1',
      `HTTP ${result.status}`,
      { httpStatus: result.status }
    );
  } catch (error) {
    return createTestResult(
      '1Map API',
      'failed',
      Date.now() - startTime,
      'P1',
      error instanceof Error ? error.message : 'Connection failed'
    );
  }
}

/**
 * Test Sage ERP token refresh
 */
async function testSageErp(): Promise<TestResult> {
  const startTime = Date.now();

  // Check if Sage credentials are configured
  const clientId = process.env.SAGE_CLIENT_ID;
  const refreshToken = process.env.SAGE_REFRESH_TOKEN;

  if (!clientId || !refreshToken) {
    return createTestResult(
      'Sage ERP',
      'skipped',
      Date.now() - startTime,
      'P1',
      'Credentials not configured'
    );
  }

  try {
    // Just check if the OAuth endpoint is reachable
    const result = await httpClient.get(config.services.sage.baseUrl);
    const duration = result.responseTime;

    if (result.status < 500) {
      return createTestResult(
        'Sage ERP',
        'passed',
        duration,
        'P1',
        'OAuth endpoint reachable',
        { httpStatus: result.status }
      );
    }

    return createTestResult(
      'Sage ERP',
      'failed',
      duration,
      'P1',
      `HTTP ${result.status}`,
      { httpStatus: result.status }
    );
  } catch (error) {
    return createTestResult(
      'Sage ERP',
      'failed',
      Date.now() - startTime,
      'P1',
      error instanceof Error ? error.message : 'Connection failed'
    );
  }
}

/**
 * Test Resend Email API
 */
async function testResendEmail(): Promise<TestResult> {
  const startTime = Date.now();

  // Check if Resend API key is configured
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    return createTestResult(
      'Resend Email',
      'skipped',
      Date.now() - startTime,
      'P1',
      'API key not configured'
    );
  }

  try {
    const result = await httpClient.get(`${config.services.resend.baseUrl}${config.services.resend.testEndpoint}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    const duration = result.responseTime;

    if (result.status === 200) {
      return createTestResult(
        'Resend Email',
        'passed',
        duration,
        'P1',
        'API key valid',
        { httpStatus: result.status }
      );
    } else if (result.status === 401 || result.status === 403) {
      return createTestResult(
        'Resend Email',
        'failed',
        duration,
        'P1',
        'Invalid API key',
        { httpStatus: result.status }
      );
    }

    return createTestResult(
      'Resend Email',
      'warning',
      duration,
      'P1',
      `HTTP ${result.status}`,
      { httpStatus: result.status }
    );
  } catch (error) {
    return createTestResult(
      'Resend Email',
      'failed',
      Date.now() - startTime,
      'P1',
      error instanceof Error ? error.message : 'Connection failed'
    );
  }
}

/**
 * Run the external services health suite
 */
export async function runExternalServicesSuite(options: {
  quick?: boolean;
} = {}): Promise<SuiteResult> {
  const startTime = new Date();
  const logger = auditLogger.forSuite(SUITE_NAME);

  logger.info('Starting external service health checks');

  const results: TestResult[] = [];

  // Filter services for quick mode
  const servicesToTest = options.quick
    ? services.filter((s) => s.priority === 'P0')
    : services;

  logger.info(`Testing ${servicesToTest.length} services`);

  // Test internal services in parallel
  const serviceResults = await Promise.all(servicesToTest.map((service) => testService(service)));

  for (const result of serviceResults) {
    results.push(result);
    logger.result(result.name, result.status === 'passed', result.message);
  }

  // Skip external API tests in quick mode
  if (!options.quick) {
    // Test external APIs
    logger.info('Testing external APIs...');

    const oneMapResult = await test1MapApi();
    results.push(oneMapResult);
    logger.result(oneMapResult.name, oneMapResult.status === 'passed', oneMapResult.message);

    const sageResult = await testSageErp();
    results.push(sageResult);
    logger.result(sageResult.name, sageResult.status === 'passed', sageResult.message);

    const resendResult = await testResendEmail();
    results.push(resendResult);
    logger.result(resendResult.name, resendResult.status === 'passed', resendResult.message);
  }

  const endTime = new Date();

  return createSuiteResult(SUITE_NAME, SUITE_DESCRIPTION, SUITE_PRIORITY, results, startTime, endTime);
}

export default runExternalServicesSuite;
