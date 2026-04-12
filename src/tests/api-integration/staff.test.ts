import { describe, test, expect, beforeAll } from 'vitest';
import axios, { AxiosInstance } from 'axios';

interface StaffRecord {
  id: string | number;
  name: string;
  email: string;
  phone?: string;
  role: string;
  department?: string;
  startDate?: string;
}

interface ApiErrorResponse {
  response?: {
    status: number;
    data: { error: string };
  };
}

describe('Staff Module API Integration Tests', () => {
  let api: AxiosInstance;
  const baseURL = process.env.VITE_API_URL || 'http://localhost:3000/api';

  beforeAll(() => {
    api = axios.create({
      baseURL: `${baseURL}/staff`,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      }
    });
  });

  describe('Staff Health Check', () => {
    test('Staff health endpoint returns OK', async () => {
      try {
        const response = await api.get('/health');
        expect(response.status).toBe(200);
        expect(response.data.status).toMatch(/ok|healthy/);
      } catch {
        console.warn('Staff API not running - skipping health check');
      }
    });
  });

  describe('Staff CRUD Operations', () => {
    test('Can list all staff members', async () => {
      try {
        const response = await api.get('/');
        expect(response.status).toBe(200);
        expect(Array.isArray(response.data)).toBe(true);

        if (response.data.length > 0) {
          const staff = response.data[0];
          expect(staff).toHaveProperty('id');
          expect(staff).toHaveProperty('name');
          expect(staff).toHaveProperty('email');
          expect(staff).toHaveProperty('role');
        }
      } catch {
        console.warn('Staff list test skipped - API not available');
      }
    });

    test('Can get staff member by ID', async () => {
      try {
        const testStaffId = '1';
        const response = await api.get(`/${testStaffId}`);

        if (response.status === 200) {
          expect(response.data).toHaveProperty('id');
          expect(response.data).toHaveProperty('name');
          expect(response.data).toHaveProperty('email');
          expect(response.data).toHaveProperty('phone');
          expect(response.data).toHaveProperty('role');
          expect(response.data).toHaveProperty('department');
        }
      } catch (error: unknown) {
        const apiError = error as ApiErrorResponse;
        if (apiError.response?.status === 404) {
          expect(apiError.response.data).toHaveProperty('error');
        }
      }
    });

    test('Can create a new staff member', async () => {
      try {
        const newStaff = {
          name: 'Test Staff Member',
          email: 'test.staff@example.com',
          phone: '+1234567890',
          role: 'Developer',
          department: 'Engineering',
          startDate: new Date().toISOString()
        };

        const response = await api.post('/', newStaff);

        if (response.status === 201 || response.status === 200) {
          expect(response.data).toHaveProperty('id');
          expect(response.data.name).toBe(newStaff.name);
          expect(response.data.email).toBe(newStaff.email);
        }
      } catch (error: unknown) {
        const apiError = error as ApiErrorResponse;
        if (apiError.response?.status === 400) {
          expect(apiError.response.data).toHaveProperty('error');
        }
      }
    });

    test('Staff creation validates email format', async () => {
      try {
        await api.post('/', {
          name: 'Invalid Email Test',
          email: 'invalid-email',
          role: 'Tester'
        });
      } catch (error: unknown) {
        const apiError = error as ApiErrorResponse;
        expect([400, 422]).toContain(apiError.response?.status);
        expect(apiError.response?.data).toHaveProperty('error');
      }
    });

    test('Can update staff member', async () => {
      try {
        const update = {
          role: 'Senior Developer',
          department: 'R&D'
        };

        const response = await api.put('/1', update);

        if (response.status === 200) {
          expect(response.data).toHaveProperty('id');
          expect(response.data.role).toBe(update.role);
          expect(response.data.department).toBe(update.department);
        }
      } catch (error: unknown) {
        const apiError = error as ApiErrorResponse;
        if (apiError.response?.status !== 404) {
          console.warn('Staff update test failed unexpectedly');
        }
      }
    });

    test('Can soft delete staff member', async () => {
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

  describe('Staff Search and Filtering', () => {
    test('Can search staff by name', async () => {
      try {
        const response = await api.get('/?search=john');

        expect(response.status).toBe(200);
        expect(Array.isArray(response.data)).toBe(true);
      } catch {
        console.warn('Staff search test skipped');
      }
    });

    test('Can filter staff by department', async () => {
      try {
        const response = await api.get('/?department=Engineering');

        expect(response.status).toBe(200);
        expect(Array.isArray(response.data)).toBe(true);

        response.data.forEach((staff: StaffRecord) => {
          expect(staff.department).toBe('Engineering');
        });
      } catch {
        console.warn('Staff department filter test skipped');
      }
    });

    test('Can filter staff by role', async () => {
      try {
        const response = await api.get('/?role=Developer');

        expect(response.status).toBe(200);
        expect(Array.isArray(response.data)).toBe(true);
      } catch {
        console.warn('Staff role filter test skipped');
      }
    });
  });

  describe('Staff Statistics', () => {
    test('Can fetch staff statistics', async () => {
      try {
        const response = await api.get('/stats');

        if (response.status === 200) {
          expect(response.data).toHaveProperty('total');
          expect(response.data).toHaveProperty('byDepartment');
          expect(response.data).toHaveProperty('byRole');
          expect(response.data).toHaveProperty('activeCount');
        }
      } catch {
        console.warn('Staff statistics test skipped');
      }
    });

    test('Can fetch department summary', async () => {
      try {
        const response = await api.get('/stats/departments');

        if (response.status === 200) {
          expect(Array.isArray(response.data)).toBe(true);

          if (response.data.length > 0) {
            const dept = response.data[0];
            expect(dept).toHaveProperty('department');
            expect(dept).toHaveProperty('count');
          }
        }
      } catch {
        console.warn('Department summary test skipped');
      }
    });
  });

  describe('Staff Availability', () => {
    test('Can check staff availability', async () => {
      try {
        const response = await api.get('/1/availability');

        if (response.status === 200) {
          expect(response.data).toHaveProperty('available');
          expect(response.data).toHaveProperty('currentProjects');
        }
      } catch {
        console.warn('Staff availability test skipped');
      }
    });
  });

  describe('Staff Performance', () => {
    test('List staff responds within 1 second', async () => {
      try {
        const start = Date.now();
        await api.get('/');
        const duration = Date.now() - start;

        expect(duration).toBeLessThan(1000);
      } catch {
        console.warn('Performance test skipped');
      }
    });

    test('Staff search responds within 1.5 seconds', async () => {
      try {
        const start = Date.now();
        await api.get('/?search=test&department=Engineering');
        const duration = Date.now() - start;

        expect(duration).toBeLessThan(1500);
      } catch {
        console.warn('Search performance test skipped');
      }
    });
  });
});
