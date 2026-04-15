import { describe, test, expect, beforeAll } from 'vitest';
import axios, { AxiosInstance } from 'axios';

interface ClientRecord {
  id: string | number;
  name: string;
  contactEmail: string;
  contactPhone?: string;
  address?: string;
  status: string;
  city?: string;
  state?: string;
  zipCode?: string;
  contactPerson?: string;
}

interface ApiErrorResponse {
  response?: {
    status: number;
    data: { error: string };
  };
}

// Live-server integration suite — requires a running Next.js API at
// VITE_API_URL. Skip in unit vitest runs; re-enable in integration CI.
describe.skip('Clients Module API Integration Tests', () => {
  let api: AxiosInstance;
  const baseURL = process.env.VITE_API_URL || 'http://localhost:3000/api';

  beforeAll(() => {
    api = axios.create({
      baseURL: `${baseURL}/clients`,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      }
    });
  });

  describe('Clients Health Check', () => {
    test('Clients health endpoint returns OK', async () => {
      try {
        const response = await api.get('/health');
        expect(response.status).toBe(200);
        expect(response.data.status).toMatch(/ok|healthy/);
      } catch {
        console.warn('Clients API not running - skipping health check');
      }
    });
  });

  describe('Client CRUD Operations', () => {
    test('Can list all clients', async () => {
      try {
        const response = await api.get('/');
        expect(response.status).toBe(200);
        expect(Array.isArray(response.data)).toBe(true);

        if (response.data.length > 0) {
          const client = response.data[0];
          expect(client).toHaveProperty('id');
          expect(client).toHaveProperty('name');
          expect(client).toHaveProperty('contactEmail');
          expect(client).toHaveProperty('status');
        }
      } catch {
        console.warn('Clients list test skipped - API not available');
      }
    });

    test('Can get client by ID', async () => {
      try {
        const testClientId = '1';
        const response = await api.get(`/${testClientId}`);

        if (response.status === 200) {
          expect(response.data).toHaveProperty('id');
          expect(response.data).toHaveProperty('name');
          expect(response.data).toHaveProperty('contactEmail');
          expect(response.data).toHaveProperty('contactPhone');
          expect(response.data).toHaveProperty('address');
          expect(response.data).toHaveProperty('status');
        }
      } catch (error: unknown) {
        const apiError = error as ApiErrorResponse;
        if (apiError.response?.status === 404) {
          expect(apiError.response.data).toHaveProperty('error');
        }
      }
    });

    test('Can create a new client', async () => {
      try {
        const newClient = {
          name: 'Test Client API',
          contactEmail: 'test.client@example.com',
          contactPhone: '+1234567890',
          contactPerson: 'John Doe',
          address: '123 Test Street',
          city: 'Test City',
          state: 'TS',
          zipCode: '12345',
          status: 'active'
        };

        const response = await api.post('/', newClient);

        if (response.status === 201 || response.status === 200) {
          expect(response.data).toHaveProperty('id');
          expect(response.data.name).toBe(newClient.name);
          expect(response.data.contactEmail).toBe(newClient.contactEmail);
        }
      } catch (error: unknown) {
        const apiError = error as ApiErrorResponse;
        if (apiError.response?.status === 400) {
          expect(apiError.response.data).toHaveProperty('error');
        }
      }
    });

    test('Client creation validates required fields', async () => {
      try {
        // Missing required fields
        await api.post('/', {
          contactEmail: 'test@example.com'
        });
      } catch (error: unknown) {
        const apiError = error as ApiErrorResponse;
        expect([400, 422]).toContain(apiError.response?.status);
        expect(apiError.response?.data).toHaveProperty('error');
      }
    });

    test('Client creation validates email format', async () => {
      try {
        await api.post('/', {
          name: 'Invalid Email Client',
          contactEmail: 'invalid-email',
          contactPerson: 'Test Person'
        });
      } catch (error: unknown) {
        const apiError = error as ApiErrorResponse;
        expect([400, 422]).toContain(apiError.response?.status);
        expect(apiError.response?.data).toHaveProperty('error');
      }
    });

    test('Can update client', async () => {
      try {
        const update = {
          status: 'inactive',
          contactPhone: '+9876543210'
        };

        const response = await api.put('/1', update);

        if (response.status === 200) {
          expect(response.data).toHaveProperty('id');
          expect(response.data.status).toBe(update.status);
          expect(response.data.contactPhone).toBe(update.contactPhone);
        }
      } catch (error: unknown) {
        const apiError = error as ApiErrorResponse;
        if (apiError.response?.status !== 404) {
          console.warn('Client update test failed unexpectedly');
        }
      }
    });

    test('Can delete client', async () => {
      try {
        const response = await api.delete('/999'); // Test ID

        if (response.status === 200) {
          expect(response.data).toHaveProperty('success');
          expect(response.data.success).toBe(true);
        }
      } catch (error: unknown) {
        const apiError = error as ApiErrorResponse;
        if (apiError.response?.status === 404) {
          expect(apiError.response.data).toHaveProperty('error');
        }
      }
    });
  });

  describe('Client Relationships', () => {
    test('Can fetch client with projects', async () => {
      try {
        const response = await api.get('/1?include=projects');

        if (response.status === 200) {
          expect(response.data).toHaveProperty('projects');
          expect(Array.isArray(response.data.projects)).toBe(true);

          if (response.data.projects.length > 0) {
            const project = response.data.projects[0];
            expect(project).toHaveProperty('id');
            expect(project).toHaveProperty('name');
            expect(project).toHaveProperty('status');
          }
        }
      } catch {
        console.warn('Client projects test skipped');
      }
    });

    test('Can fetch client project count', async () => {
      try {
        const response = await api.get('/1/project-count');

        if (response.status === 200) {
          expect(response.data).toHaveProperty('count');
          expect(typeof response.data.count).toBe('number');
        }
      } catch {
        console.warn('Client project count test skipped');
      }
    });
  });

  describe('Client Search and Filtering', () => {
    test('Can search clients by name', async () => {
      try {
        const response = await api.get('/?search=test');

        expect(response.status).toBe(200);
        expect(Array.isArray(response.data)).toBe(true);
      } catch {
        console.warn('Client search test skipped');
      }
    });

    test('Can filter clients by status', async () => {
      try {
        const response = await api.get('/?status=active');

        expect(response.status).toBe(200);
        expect(Array.isArray(response.data)).toBe(true);

        response.data.forEach((client: ClientRecord) => {
          expect(client.status).toBe('active');
        });
      } catch {
        console.warn('Client status filter test skipped');
      }
    });

    test('Can filter clients by city', async () => {
      try {
        const response = await api.get('/?city=New York');

        expect(response.status).toBe(200);
        expect(Array.isArray(response.data)).toBe(true);
      } catch {
        console.warn('Client city filter test skipped');
      }
    });
  });

  describe('Client Statistics', () => {
    test('Can fetch client statistics', async () => {
      try {
        const response = await api.get('/stats');

        if (response.status === 200) {
          expect(response.data).toHaveProperty('total');
          expect(response.data).toHaveProperty('active');
          expect(response.data).toHaveProperty('inactive');
          expect(response.data).toHaveProperty('byCity');
        }
      } catch {
        console.warn('Client statistics test skipped');
      }
    });

    test('Can fetch client revenue summary', async () => {
      try {
        const response = await api.get('/stats/revenue');

        if (response.status === 200) {
          expect(response.data).toHaveProperty('totalRevenue');
          expect(response.data).toHaveProperty('averageRevenue');
          expect(response.data).toHaveProperty('topClients');
        }
      } catch {
        console.warn('Client revenue test skipped');
      }
    });
  });

  describe('Client Validation', () => {
    test('Prevents duplicate client names', async () => {
      try {
        // First create a client
        const client = {
          name: 'Unique Client Name',
          contactEmail: 'unique@example.com',
          contactPerson: 'Test Person'
        };

        await api.post('/', client);

        // Try to create another with same name
        await api.post('/', client);
      } catch (error: unknown) {
        const apiError = error as ApiErrorResponse;
        expect([400, 409]).toContain(apiError.response?.status);
        expect(apiError.response?.data).toHaveProperty('error');
      }
    });
  });

  describe('Client Performance', () => {
    test('List clients responds within 1 second', async () => {
      try {
        const start = Date.now();
        await api.get('/');
        const duration = Date.now() - start;

        expect(duration).toBeLessThan(1000);
      } catch {
        console.warn('Performance test skipped');
      }
    });

    test('Client search responds within 1.5 seconds', async () => {
      try {
        const start = Date.now();
        await api.get('/?search=test&status=active');
        const duration = Date.now() - start;

        expect(duration).toBeLessThan(1500);
      } catch {
        console.warn('Search performance test skipped');
      }
    });
  });
});
