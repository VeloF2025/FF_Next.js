/**
 * Tests for Staff Projects API endpoints
 * GET, POST /api/staff/[staffId]/projects
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

// Use vi.hoisted to create mock before vi.mock is hoisted
const { mockSql } = vi.hoisted(() => {
  return { mockSql: vi.fn() };
});

// Mock dependencies
vi.mock('@neondatabase/serverless', () => ({
  neon: () => mockSql,
}));

vi.mock('@/lib/arcjet', () => ({
  withArcjetProtection: (handler: Function) => handler,
  aj: {},
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

  getAuth: vi.fn().mockReturnValue({ userId: null }),
}));

// Import handler after mocks
import handler from '../../../pages/api/staff/[staffId]/projects';

describe('Staff Projects API - /api/staff/[staffId]/projects', () => {
  let req: Partial<NextApiRequest>;
  let res: Partial<NextApiResponse>;

  beforeEach(() => {
    vi.clearAllMocks();

    req = {
      method: 'GET',
      query: { staffId: 'staff-123' },
      body: {},
    };

    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      setHeader: vi.fn().mockReturnThis(),
    };
  });

  describe('GET /api/staff/[staffId]/projects', () => {
    it('should return projects assigned to a staff member', async () => {
      const mockProjects = [
        {
          id: 'sp-1',
          staff_id: 'staff-123',
          project_id: 'proj-1',
          role: 'Lead Technician',
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          project_name: 'Fiber Project A',
          project_status: 'active',
          project_client: 'Client Corp',
          staff_name: 'John Doe',
        },
        {
          id: 'sp-2',
          staff_id: 'staff-123',
          project_id: 'proj-2',
          role: 'Technician',
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          project_name: 'Fiber Project B',
          project_status: 'active',
          project_client: 'Other Corp',
          staff_name: 'John Doe',
        },
      ];

      mockSql.mockResolvedValueOnce(mockProjects);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          projects: expect.arrayContaining([
            expect.objectContaining({
              id: 'sp-1',
              role: 'Lead Technician',
              project: expect.objectContaining({
                name: 'Fiber Project A',
              }),
            }),
            expect.objectContaining({
              id: 'sp-2',
              role: 'Technician',
            }),
          ]),
          count: 2,
        })
      );
    });

    it('should filter active projects when activeOnly=true', async () => {
      req.query = { staffId: 'staff-123', activeOnly: 'true' };

      const mockProjects = [
        {
          id: 'sp-1',
          staff_id: 'staff-123',
          project_id: 'proj-1',
          role: 'Technician',
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          project_name: 'Active Project',
          project_status: 'active',
          staff_name: 'John Doe',
        },
      ];

      mockSql.mockResolvedValueOnce(mockProjects);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockSql).toHaveBeenCalled();
    });

    it('should return empty array when staff has no projects', async () => {
      mockSql.mockResolvedValueOnce([]);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          projects: [],
          count: 0,
        })
      );
    });

    it('should return 400 when staffId is missing', async () => {
      req.query = {};

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Staff ID is required',
        })
      );
    });

    it('should return 500 on database error', async () => {
      mockSql.mockRejectedValueOnce(new Error('Database error'));

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Failed to fetch projects',
        })
      );
    });
  });

  describe('POST /api/staff/[staffId]/projects', () => {
    beforeEach(() => {
      req.method = 'POST';
    });

    it('should assign staff to a project successfully', async () => {
      req.body = {
        projectId: 'proj-456',
        role: 'Lead Technician',
        startDate: '2024-01-15',
      };

      // Check existing - none found
      mockSql.mockResolvedValueOnce([]);
      // Create new assignment
      mockSql.mockResolvedValueOnce([{
        id: 'sp-new',
        staff_id: 'staff-123',
        project_id: 'proj-456',
        role: 'Lead Technician',
        start_date: '2024-01-15',
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }]);
      // Fetch with joins
      mockSql.mockResolvedValueOnce([{
        id: 'sp-new',
        staff_id: 'staff-123',
        project_id: 'proj-456',
        role: 'Lead Technician',
        start_date: '2024-01-15',
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        project_name: 'New Project',
        project_status: 'active',
        staff_name: 'John Doe',
      }]);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          assignment: expect.objectContaining({
            id: 'sp-new',
            role: 'Lead Technician',
          }),
        })
      );
    });

    it('should reactivate existing inactive assignment', async () => {
      req.body = {
        projectId: 'proj-456',
        role: 'Updated Role',
      };

      // Check existing - found
      mockSql.mockResolvedValueOnce([{ id: 'existing-sp' }]);
      // Update existing
      mockSql.mockResolvedValueOnce([{
        id: 'existing-sp',
        staff_id: 'staff-123',
        project_id: 'proj-456',
        role: 'Updated Role',
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }]);
      // Fetch with joins
      mockSql.mockResolvedValueOnce([{
        id: 'existing-sp',
        staff_id: 'staff-123',
        project_id: 'proj-456',
        role: 'Updated Role',
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        project_name: 'Existing Project',
        project_status: 'active',
        staff_name: 'John Doe',
      }]);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          assignment: expect.objectContaining({
            id: 'existing-sp',
            role: 'Updated Role',
          }),
        })
      );
    });

    it('should return 400 when projectId is missing', async () => {
      req.body = { role: 'Technician' };

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Project ID is required',
        })
      );
    });

    it('should handle assignment with all optional fields', async () => {
      req.body = {
        projectId: 'proj-456',
        role: 'Technician',
        startDate: '2024-01-15',
        endDate: '2024-12-31',
      };

      mockSql.mockResolvedValueOnce([]);
      mockSql.mockResolvedValueOnce([{
        id: 'sp-new',
        staff_id: 'staff-123',
        project_id: 'proj-456',
        role: 'Technician',
        start_date: '2024-01-15',
        end_date: '2024-12-31',
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }]);
      mockSql.mockResolvedValueOnce([{
        id: 'sp-new',
        staff_id: 'staff-123',
        project_id: 'proj-456',
        role: 'Technician',
        start_date: '2024-01-15',
        end_date: '2024-12-31',
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        project_name: 'Project',
        staff_name: 'John',
      }]);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('should return 500 on database error', async () => {
      req.body = { projectId: 'proj-456' };

      mockSql.mockRejectedValueOnce(new Error('Database error'));

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Failed to assign staff to project',
        })
      );
    });
  });

  describe('Method validation', () => {
    it('should return 405 for unsupported methods', async () => {
      req.method = 'DELETE';

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(res.status).toHaveBeenCalledWith(405);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Method not allowed',
        })
      );
    });
  });
});
