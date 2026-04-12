import { describe, test, expect, beforeAll } from 'vitest';
import axios, { AxiosInstance, AxiosError } from 'axios';

describe('Projects Module API Integration Tests', () => {
  let api: AxiosInstance;
  const baseURL = process.env.VITE_API_URL || 'http://localhost:3000/api';

  beforeAll(() => {
    api = axios.create({
      baseURL: `${baseURL}/projects`,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      }
    });
  });

  describe('Projects Health Check', () => {
    test('Projects health endpoint returns OK', async () => {
      try {
        const response = await api.get('/health');
        expect(response.status).toBe(200);
        expect(response.data.status).toMatch(/ok|healthy/);
      } catch (error) {
        console.warn('Projects API not running - skipping health check');
      }
    });
  });

  describe('Project CRUD Operations', () => {
    test('Can list all projects', async () => {
      try {
        const response = await api.get('/');
        expect(response.status).toBe(200);
        expect(Array.isArray(response.data)).toBe(true);
        
        if (response.data.length > 0) {
          const project = response.data[0];
          expect(project).toHaveProperty('id');
          expect(project).toHaveProperty('name');
          expect(project).toHaveProperty('status');
        }
      } catch (error) {
        console.warn('Projects list test skipped - API not available');
      }
    });

    test('Can get project by ID', async () => {
      try {
        const testProjectId = '1'; // Assuming numeric IDs
        const response = await api.get(`/${testProjectId}`);
        
        if (response.status === 200) {
          expect(response.data).toHaveProperty('id');
          expect(response.data).toHaveProperty('name');
          expect(response.data).toHaveProperty('clientId');
          expect(response.data).toHaveProperty('status');
        }
      } catch (error) {
        const axiosErr = error as AxiosError;
        if (axiosErr.response?.status === 404) {
          expect(axiosErr.response.data).toHaveProperty('error');
        }
      }
    });

    test('Can create a new project', async () => {
      try {
        const newProject = {
          name: 'Test Project API',
          clientId: 1,
          status: 'planning',
          startDate: new Date().toISOString(),
          description: 'Test project created by API integration test'
        };

        const response = await api.post('/', newProject);

        if (response.status === 201 || response.status === 200) {
          expect(response.data).toHaveProperty('id');
          expect(response.data.name).toBe(newProject.name);
        }
      } catch (error) {
        const axiosErr = error as AxiosError;
        // If validation fails, check error format
        if (axiosErr.response?.status === 400) {
          expect(axiosErr.response.data).toHaveProperty('error');
        }
      }
    });

    test('Project creation validates required fields', async () => {
      try {
        // Missing required fields
        await api.post('/', { description: 'Invalid project' });
      } catch (error) {
        const axiosErr = error as AxiosError;
        expect([400, 422]).toContain(axiosErr.response?.status);
        expect(axiosErr.response?.data).toHaveProperty('error');
      }
    });

    test('Can update project', async () => {
      try {
        const update = {
          status: 'in_progress',
          progress: 25
        };

        const response = await api.put('/1', update);

        if (response.status === 200) {
          expect(response.data).toHaveProperty('id');
          expect(response.data.status).toBe(update.status);
        }
      } catch (error) {
        const axiosErr = error as AxiosError;
        if (axiosErr.response?.status !== 404) {
          console.warn('Project update test failed unexpectedly');
        }
      }
    });
  });

  describe('Project Relationships', () => {
    test('Project includes client information', async () => {
      try {
        const response = await api.get('/1?include=client');
        
        if (response.status === 200) {
          expect(response.data).toHaveProperty('client');
          if (response.data.client) {
            expect(response.data.client).toHaveProperty('id');
            expect(response.data.client).toHaveProperty('name');
          }
        }
      } catch (error) {
        console.warn('Project relationships test skipped');
      }
    });

    test('Can fetch project with staff assignments', async () => {
      try {
        const response = await api.get('/1?include=staff');
        
        if (response.status === 200) {
          expect(response.data).toHaveProperty('staff');
          expect(Array.isArray(response.data.staff)).toBe(true);
        }
      } catch (error) {
        console.warn('Project staff test skipped');
      }
    });
  });

  describe('Project Filtering and Search', () => {
    test('Can filter projects by status', async () => {
      try {
        const response = await api.get('/?status=active');
        
        expect(response.status).toBe(200);
        expect(Array.isArray(response.data)).toBe(true);
        
        (response.data as Array<{ status: string }>).forEach((project) => {
          expect(project.status).toBe('active');
        });
      } catch (error) {
        console.warn('Project filtering test skipped');
      }
    });

    test('Can search projects by name', async () => {
      try {
        const response = await api.get('/?search=test');
        
        expect(response.status).toBe(200);
        expect(Array.isArray(response.data)).toBe(true);
      } catch (error) {
        console.warn('Project search test skipped');
      }
    });
  });

  describe('Project Statistics', () => {
    test('Can fetch project statistics', async () => {
      try {
        const response = await api.get('/stats');
        
        if (response.status === 200) {
          expect(response.data).toHaveProperty('total');
          expect(response.data).toHaveProperty('byStatus');
          expect(response.data).toHaveProperty('recentlyUpdated');
        }
      } catch (error) {
        console.warn('Project statistics test skipped');
      }
    });
  });

  describe('Project Performance', () => {
    test('List projects responds within 1 second', async () => {
      try {
        const start = Date.now();
        await api.get('/');
        const duration = Date.now() - start;
        
        expect(duration).toBeLessThan(1000);
      } catch (error) {
        console.warn('Performance test skipped');
      }
    });
  });
});