import { describe, test, expect, beforeAll } from 'vitest';
import axios, { AxiosInstance } from 'axios';
import { log } from '@/lib/logger';

interface BenchmarkResult {
  endpoint: string;
  method: string;
  averageTime: number;
  minTime: number;
  maxTime: number;
  p95Time: number;
  p99Time: number;
  requests: number;
  errors: number;
}

describe('API Performance Benchmarks', () => {
  let api: AxiosInstance;
  const baseURL = process.env.VITE_API_URL || 'http://localhost:3000/api';
  const BENCHMARK_ITERATIONS = 10;
  const PERFORMANCE_THRESHOLDS = {
    health: 200,      // ms
    list: 500,        // ms
    single: 300,      // ms
    create: 1000,     // ms
    update: 800,      // ms
    complex: 2000     // ms
  };

  beforeAll(() => {
    api = axios.create({
      baseURL,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      }
    });
  });

  async function benchmarkEndpoint(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    endpoint: string,
    data?: any,
    iterations: number = BENCHMARK_ITERATIONS
  ): Promise<BenchmarkResult> {
    const times: number[] = [];
    let errors = 0;

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      
      try {
        switch (method) {
          case 'GET':
            await api.get(endpoint);
            break;
          case 'POST':
            await api.post(endpoint, data);
            break;
          case 'PUT':
            await api.put(endpoint, data);
            break;
          case 'DELETE':
            await api.delete(endpoint);
            break;
        }
        
        const duration = performance.now() - start;
        times.push(duration);
      } catch (error) {
        errors++;
        // Still record the time for failed requests
        const duration = performance.now() - start;
        times.push(duration);
      }

      // Small delay between requests to avoid overwhelming the server
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    // Calculate statistics
    times.sort((a, b) => a - b);
    const sum = times.reduce((a, b) => a + b, 0);
    const average = sum / times.length;
    const min = times[0] || 0;
    const max = times[times.length - 1] || 0;
    const p95Index = Math.floor(times.length * 0.95);
    const p99Index = Math.floor(times.length * 0.99);

    return {
      endpoint,
      method,
      averageTime: Math.round(average),
      minTime: Math.round(min),
      maxTime: Math.round(max),
      p95Time: Math.round(times[p95Index] || max),
      p99Time: Math.round(times[p99Index] || max),
      requests: iterations,
      errors
    };
  }

  describe('Health Check Endpoints', () => {
    const healthEndpoints = [
      '/sow/health',
      '/projects/health',
      '/staff/health',
      '/clients/health',
      '/monitoring/health'
    ];

    healthEndpoints.forEach(endpoint => {
      test(`${endpoint} performance`, async () => {
        const result = await benchmarkEndpoint('GET', endpoint);
        
        log.info(`${endpoint} Performance:`, undefined, 'api-benchmarks');
        log.info(`  Average: ${result.averageTime}ms`, undefined, 'api-benchmarks');
        log.info(`  Min: ${result.minTime}ms`, undefined, 'api-benchmarks');
        log.info(`  Max: ${result.maxTime}ms`, undefined, 'api-benchmarks');
        log.info(`  P95: ${result.p95Time}ms`, undefined, 'api-benchmarks');
        log.info(`  P99: ${result.p99Time}ms`, undefined, 'api-benchmarks');
        log.info(`  Errors: ${result.errors}/${result.requests}`, undefined, 'api-benchmarks');

        expect(result.averageTime).toBeLessThan(PERFORMANCE_THRESHOLDS.health);
        expect(result.errors).toBe(0);
      });
    });
  });

  describe('List Endpoints Performance', () => {
    const listEndpoints = [
      { path: '/projects', name: 'Projects List' },
      { path: '/staff', name: 'Staff List' },
      { path: '/clients', name: 'Clients List' }
    ];

    listEndpoints.forEach(({ path, name }) => {
      test(`${name} performance`, async () => {
        const result = await benchmarkEndpoint('GET', path);
        
        log.info(`${name} Performance:`, undefined, 'api-benchmarks');
        log.info(`  Average: ${result.averageTime}ms`, undefined, 'api-benchmarks');
        log.info(`  P95: ${result.p95Time}ms`, undefined, 'api-benchmarks');
        log.info(`  Errors: ${result.errors}/${result.requests}`, undefined, 'api-benchmarks');

        expect(result.averageTime).toBeLessThan(PERFORMANCE_THRESHOLDS.list);
        expect(result.p95Time).toBeLessThan(PERFORMANCE_THRESHOLDS.list * 1.5);
      });
    });
  });

  describe('Single Resource Performance', () => {
    test('Get single project performance', async () => {
      const result = await benchmarkEndpoint('GET', '/projects/1');
      
      expect(result.averageTime).toBeLessThan(PERFORMANCE_THRESHOLDS.single);
    });

    test('Get single staff member performance', async () => {
      const result = await benchmarkEndpoint('GET', '/staff/1');
      
      expect(result.averageTime).toBeLessThan(PERFORMANCE_THRESHOLDS.single);
    });

    test('Get single client performance', async () => {
      const result = await benchmarkEndpoint('GET', '/clients/1');
      
      expect(result.averageTime).toBeLessThan(PERFORMANCE_THRESHOLDS.single);
    });
  });

  describe('Complex Query Performance', () => {
    test('SOW data with all relationships', async () => {
      const result = await benchmarkEndpoint('GET', '/sow/data/test-project-001');
      
      log.info('SOW Complex Query Performance:', undefined, 'api-benchmarks');
      log.info(`  Average: ${result.averageTime}ms`, undefined, 'api-benchmarks');
      log.info(`  P95: ${result.p95Time}ms`, undefined, 'api-benchmarks');

      expect(result.averageTime).toBeLessThan(PERFORMANCE_THRESHOLDS.complex);
    });

    test('Project with all includes', async () => {
      const result = await benchmarkEndpoint('GET', '/projects/1?include=client,staff,sow');
      
      expect(result.averageTime).toBeLessThan(PERFORMANCE_THRESHOLDS.complex);
    });
  });

  describe('Write Operations Performance', () => {
    test('Create operations benchmark', async () => {
      const testData = {
        project: {
          name: 'Performance Test Project',
          clientId: 1,
          status: 'planning'
        },
        staff: {
          name: 'Performance Test User',
          email: 'perf.test@example.com',
          role: 'Developer'
        },
        client: {
          name: 'Performance Test Client',
          contactEmail: 'perf.client@example.com',
          contactPerson: 'Test Person'
        }
      };

      const results = await Promise.all([
        benchmarkEndpoint('POST', '/projects', testData.project, 5),
        benchmarkEndpoint('POST', '/staff', testData.staff, 5),
        benchmarkEndpoint('POST', '/clients', testData.client, 5)
      ]);

      results.forEach(result => {
        log.info(`${result.endpoint} Create Performance:`, undefined, 'api-benchmarks');
        log.info(`  Average: ${result.averageTime}ms`, undefined, 'api-benchmarks');
        
        expect(result.averageTime).toBeLessThan(PERFORMANCE_THRESHOLDS.create);
      });
    });
  });

  describe('Concurrent Request Performance', () => {
    test('Parallel requests handling', async () => {
      const endpoints = [
        '/projects',
        '/staff',
        '/clients',
        '/sow/health'
      ];

      const start = performance.now();
      
      // Fire 4 requests in parallel
      const promises = endpoints.map(endpoint => api.get(endpoint));
      await Promise.all(promises);
      
      const totalTime = performance.now() - start;
      
      log.info(`Parallel Requests (${endpoints.length} requests):`, undefined, 'api-benchmarks');
      log.info(`  Total time: ${Math.round(totalTime)}ms`, undefined, 'api-benchmarks');
      log.info(`  Average per request: ${Math.round(totalTime / endpoints.length)}ms`, undefined, 'api-benchmarks');

      // Should complete faster than sequential
      expect(totalTime).toBeLessThan(PERFORMANCE_THRESHOLDS.list * endpoints.length * 0.5);
    });
  });

  describe('Database Connection Pool Performance', () => {
    test('Rapid successive requests', async () => {
      const endpoint = '/projects/health';
      const rapidIterations = 50;
      
      const result = await benchmarkEndpoint('GET', endpoint, undefined, rapidIterations);
      
      log.info('Connection Pool Performance (50 rapid requests):', undefined, 'api-benchmarks');
      log.info(`  Average: ${result.averageTime}ms`, undefined, 'api-benchmarks');
      log.info(`  Min: ${result.minTime}ms`, undefined, 'api-benchmarks');
      log.info(`  Max: ${result.maxTime}ms`, undefined, 'api-benchmarks');
      log.info(`  Errors: ${result.errors}`, undefined, 'api-benchmarks');

      // Connection pool should handle rapid requests efficiently
      expect(result.errors).toBe(0);
      expect(result.averageTime).toBeLessThan(100);
    });
  });

  describe('Performance Regression Tests', () => {
    test('Compare before/after migration performance', async () => {
      // This would compare with baseline metrics
      const currentMetrics = {
        projectsList: await benchmarkEndpoint('GET', '/projects'),
        staffList: await benchmarkEndpoint('GET', '/staff'),
        clientsList: await benchmarkEndpoint('GET', '/clients')
      };

      // In a real scenario, you'd load baseline metrics from a file
      const baselineMetrics = {
        projectsList: { averageTime: 400 },
        staffList: { averageTime: 350 },
        clientsList: { averageTime: 300 }
      };

      // Performance should not regress more than 20%
      Object.keys(currentMetrics).forEach(key => {
        const current = currentMetrics[key as keyof typeof currentMetrics].averageTime;
        const baseline = baselineMetrics[key as keyof typeof baselineMetrics].averageTime;
        const regression = ((current - baseline) / baseline) * 100;
        
        log.info(`${key} regression: ${regression.toFixed(1)}%`, undefined, 'api-benchmarks');
        
        expect(regression).toBeLessThan(20);
      });
    });
  });

  describe('Load Test Simulation', () => {
    test.skip('Sustained load test', async () => {
      // Skip by default as this is intensive
      const duration = 30000; // 30 seconds
      const requestsPerSecond = 10;
      const endpoint = '/projects/health';
      
      const startTime = Date.now();
      const results: number[] = [];
      let errors = 0;

      while (Date.now() - startTime < duration) {
        const batchStart = Date.now();
        
        // Fire requests
        const promises = Array(requestsPerSecond).fill(0).map(async () => {
          const reqStart = performance.now();
          try {
            await api.get(endpoint);
            return performance.now() - reqStart;
          } catch (error) {
            errors++;
            return -1;
          }
        });

        const batchResults = await Promise.all(promises);
        results.push(...batchResults.filter(r => r > 0));

        // Wait for the rest of the second
        const elapsed = Date.now() - batchStart;
        if (elapsed < 1000) {
          await new Promise(resolve => setTimeout(resolve, 1000 - elapsed));
        }
      }

      const avgResponseTime = results.reduce((a, b) => a + b, 0) / results.length;
      const errorRate = (errors / (results.length + errors)) * 100;

      log.info('Load Test Results:', undefined, 'api-benchmarks');
      log.info(`  Total requests: ${results.length + errors}`, undefined, 'api-benchmarks');
      log.info(`  Successful: ${results.length}`, undefined, 'api-benchmarks');
      log.info(`  Errors: ${errors} (${errorRate.toFixed(1)}%)`, undefined, 'api-benchmarks');
      log.info(`  Average response time: ${Math.round(avgResponseTime)}ms`, undefined, 'api-benchmarks');

      expect(errorRate).toBeLessThan(1); // Less than 1% error rate
      expect(avgResponseTime).toBeLessThan(500); // Average under 500ms under load
    });
  });
});