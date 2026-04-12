/**
 * WA Monitor Integration Tests
 * Verifies module independence and API contracts
 *
 * Run: npm run test:wa-monitor
 * Or: node -r esbuild-register src/modules/wa-monitor/tests/integration.test.ts
 */

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration?: number;
}

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3005';
const results: TestResult[] = [];

interface ApiData {
  success?: boolean;
  error?: { code?: string; message?: string };
  data?: ApiData & { drops?: unknown[]; total?: number; date?: string; stats?: ApiData };
  summary?: { total?: number; byProject?: unknown[]; overallStats?: unknown; trends?: unknown };
}

interface ApiResult {
  response: Response;
  data: ApiData;
  duration: number;
}

/**
 * Helper: Make API request
 */
async function apiRequest(endpoint: string, options?: RequestInit): Promise<ApiResult> {
  const url = `${BASE_URL}${endpoint}`;
  const startTime = Date.now();

  try {
    const response = await fetch(url, options);
    const duration = Date.now() - startTime;
    const data = await response.json();

    return { response, data, duration };
  } catch (error: unknown) {
    throw new Error(`Request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Helper: Extract error message
 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Helper: Add test result
 */
function addResult(name: string, passed: boolean, error?: string, duration?: number) {
  results.push({ name, passed, error, duration });
  const status = passed ? '✅' : '❌';
  const durationStr = duration ? ` (${duration}ms)` : '';
  console.log(`${status} ${name}${durationStr}`);
  if (error) {
    console.log(`   Error: ${error}`);
  }
}

/**
 * Test 1: GET /api/wa-monitor-drops
 */
async function testGetAllDrops() {
  try {
    const { response, data, duration } = await apiRequest('/api/wa-monitor-drops');

    if (response.status !== 200) {
      throw new Error(`Expected 200, got ${response.status}`);
    }

    if (!data.success) {
      throw new Error('Response success is not true');
    }

    if (!Array.isArray(data.data)) {
      throw new Error('Response data is not an array');
    }

    if (!data.summary) {
      throw new Error('Response missing summary');
    }

    if (typeof data.summary.total !== 'number') {
      throw new Error('Summary.total is not a number');
    }

    addResult('GET /api/wa-monitor-drops', true, undefined, duration);
  } catch (error: unknown) {
    addResult('GET /api/wa-monitor-drops', false, errorMessage(error));
  }
}

/**
 * Test 2: GET /api/wa-monitor-daily-drops
 */
async function testGetDailyDrops() {
  try {
    const { response, data, duration } = await apiRequest('/api/wa-monitor-daily-drops');

    if (response.status !== 200) {
      throw new Error(`Expected 200, got ${response.status}`);
    }

    if (!data.success) {
      throw new Error('Response success is not true');
    }

    if (!data.data || !Array.isArray(data.data.drops)) {
      throw new Error('Response data.drops is not an array');
    }

    if (typeof data.data.total !== 'number') {
      throw new Error('Response data.total is not a number');
    }

    if (typeof data.data.date !== 'string') {
      throw new Error('Response data.date is not a string');
    }

    addResult('GET /api/wa-monitor-daily-drops', true, undefined, duration);
  } catch (error: unknown) {
    addResult('GET /api/wa-monitor-daily-drops', false, errorMessage(error));
  }
}

/**
 * Test 3: GET /api/wa-monitor-project-stats
 */
async function testGetProjectStats() {
  try {
    const { response, data, duration } = await apiRequest(
      '/api/wa-monitor-project-stats?project=Lawley'
    );

    if (response.status !== 200) {
      throw new Error(`Expected 200, got ${response.status}`);
    }

    if (!data.success) {
      throw new Error('Response success is not true');
    }

    if (!data.data || !data.data.stats) {
      throw new Error('Response missing data.stats');
    }

    const stats = data.data.stats;
    if (!stats.today || !stats.week || !stats.month || !stats.allTime) {
      throw new Error('Stats missing time periods');
    }

    addResult('GET /api/wa-monitor-project-stats', true, undefined, duration);
  } catch (error: unknown) {
    addResult('GET /api/wa-monitor-project-stats', false, errorMessage(error));
  }
}

/**
 * Test 4: GET /api/wa-monitor-projects-summary
 */
async function testGetProjectsSummary() {
  try {
    const { response, data, duration } = await apiRequest('/api/wa-monitor-projects-summary');

    if (response.status !== 200) {
      throw new Error(`Expected 200, got ${response.status}`);
    }

    if (!data.success) {
      throw new Error('Response success is not true');
    }

    if (!data.data) {
      throw new Error('Response missing data');
    }

    const summary = data.data;
    if (typeof summary.total !== 'number') {
      throw new Error('Summary.total is not a number');
    }

    if (!Array.isArray(summary.byProject)) {
      throw new Error('Summary.byProject is not an array');
    }

    if (!summary.overallStats) {
      throw new Error('Summary missing overallStats');
    }

    if (!summary.trends) {
      throw new Error('Summary missing trends');
    }

    addResult('GET /api/wa-monitor-projects-summary', true, undefined, duration);
  } catch (error: unknown) {
    addResult('GET /api/wa-monitor-projects-summary', false, errorMessage(error));
  }
}

/**
 * Test 5: Method Not Allowed
 */
async function testMethodNotAllowed() {
  try {
    const { response, data, duration } = await apiRequest('/api/wa-monitor-drops', {
      method: 'POST',
    });

    if (response.status !== 405) {
      throw new Error(`Expected 405, got ${response.status}`);
    }

    if (data.success !== false) {
      throw new Error('Expected success: false');
    }

    if (!data.error || data.error.code !== 'METHOD_NOT_ALLOWED') {
      throw new Error('Expected error code METHOD_NOT_ALLOWED');
    }

    addResult('Method Not Allowed (405)', true, undefined, duration);
  } catch (error: unknown) {
    addResult('Method Not Allowed (405)', false, errorMessage(error));
  }
}

/**
 * Test 6: Not Found
 */
async function testNotFound() {
  try {
    const { response, data, duration } = await apiRequest(
      '/api/wa-monitor-drops?id=nonexistent-id-12345'
    );

    if (response.status !== 404) {
      throw new Error(`Expected 404, got ${response.status}`);
    }

    if (data.success !== false) {
      throw new Error('Expected success: false');
    }

    if (!data.error || data.error.code !== 'NOT_FOUND') {
      throw new Error('Expected error code NOT_FOUND');
    }

    addResult('Not Found (404)', true, undefined, duration);
  } catch (error: unknown) {
    addResult('Not Found (404)', false, errorMessage(error));
  }
}

/**
 * Test 7: Validation Error
 */
async function testValidationError() {
  try {
    const { response, data, duration } = await apiRequest('/api/wa-monitor-project-stats');

    if (response.status !== 422) {
      throw new Error(`Expected 422, got ${response.status}`);
    }

    if (data.success !== false) {
      throw new Error('Expected success: false');
    }

    if (!data.error || data.error.code !== 'VALIDATION_ERROR') {
      throw new Error('Expected error code VALIDATION_ERROR');
    }

    addResult('Validation Error (422)', true, undefined, duration);
  } catch (error: unknown) {
    addResult('Validation Error (422)', false, errorMessage(error));
  }
}

/**
 * Run all tests
 */
async function runTests() {
  console.log('\n🧪 WA Monitor Integration Tests\n');
  console.log(`Testing against: ${BASE_URL}\n`);

  await testGetAllDrops();
  await testGetDailyDrops();
  await testGetProjectStats();
  await testGetProjectsSummary();
  await testMethodNotAllowed();
  await testNotFound();
  await testValidationError();

  // Summary
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;

  console.log('\n' + '='.repeat(50));
  console.log(`\n📊 Results: ${passed}/${total} passed, ${failed} failed\n`);

  if (failed > 0) {
    console.log('❌ TESTS FAILED\n');
    process.exit(1);
  } else {
    console.log('✅ ALL TESTS PASSED\n');
    process.exit(0);
  }
}

// Run tests
runTests().catch(error => {
  console.error('\n❌ Test runner error:', error);
  process.exit(1);
});
