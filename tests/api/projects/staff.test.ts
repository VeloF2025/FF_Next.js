/**
 * Tests for Project Staff API endpoints
 * GET, POST, DELETE /api/projects/[projectId]/staff
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
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), getLogs: vi.fn(() => []), clearLogs: vi.fn() },
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('@clerk/nextjs/server', () => ({
  getAuth: vi.fn().mockReturnValue({ userId: null }),
}));

// Import handler after mocks
import handler from '../../../pages/api/projects/[projectId]/staff';

describe('Project Staff API - /api/projects/[projectId]/staff', () => {
  let req: Partial<NextApiRequest>;
  let res: Partial<NextApiResponse>;

  beforeEach(() => {
    vi.clearAllMocks();

    req = {
      method: 'GET',
      query: { projectId: 'proj-123' },
      body: {},
    };

    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      setHeader: vi.fn().mockReturnThis(),
    };
  });

  describe('GET /api/projects/[projectId]/staff', () => {
    it('should return staff assigned to a project', async () => {
      const mockStaff = [
        {
          id: 'sp-1',
          staff_id: 'staff-1',
          project_id: 'proj-123',
          role: 'Lead Technician',
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          project_name: 'Fiber Project',
          project_status: 'active',
          staff_name: 'John Doe',
          staff_email: 'john@example.com',
          staff_position: 'Technician',
        },
        {
          id: 'sp-2',
          staff_id: 'staff-2',
          project_id: 'proj-123',
          role: 'Technician',
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          project_name: 'Fiber Project',
          project_status: 'active',
          staff_name: 'Jane Smith',
          staff_email: 'jane@example.com',
          staff_position: 'Junior Technician',
        },
      ];

      mockSql.mockResolvedValueOnce(mockStaff);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          staff: expect.arrayContaining([
            expect.objectContaining({
              id: 'sp-1',
              role: 'Lead Technician',
            }),
          ]),
          byRole: expect.objectContaining({
            'Lead Technician': expect.any(Array),
            Technician: expect.any(Array),
          }),
          count: 2,
        })
      );
    });

    it('should filter active staff when activeOnly=true', async () => {
      req.query = { projectId: 'proj-123', activeOnly: 'true' };

      const mockStaff = [
        {
          id: 'sp-1',
          staff_id: 'staff-1',
          project_id: 'proj-123',
          role: 'Technician',
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          staff_name: 'Active Staff',
        },
      ];

      mockSql.mockResolvedValueOnce(mockStaff);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockSql).toHaveBeenCalled();
    });

    it('should group staff by role including Unassigned', async () => {
      const mockStaff = [
        {
          id: 'sp-1',
          staff_id: 'staff-1',
          project_id: 'proj-123',
          role: null,
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          staff_name: 'No Role Staff',
        },
        {
          id: 'sp-2',
          staff_id: 'staff-2',
          project_id: 'proj-123',
          role: 'Manager',
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          staff_name: 'Manager Staff',
        },
      ];

      mockSql.mockResolvedValueOnce(mockStaff);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(res.status).toHaveBeenCalledWith(200);
      const jsonCall = (res.json as any).mock.calls[0][0];
      expect(jsonCall.byRole).toHaveProperty('Unassigned');
      expect(jsonCall.byRole).toHaveProperty('Manager');
    });

    it('should return empty array when project has no staff', async () => {
      mockSql.mockResolvedValueOnce([]);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          staff: [],
          byRole: {},
          count: 0,
        })
      );
    });

    it('should return 400 when projectId is missing', async () => {
      req.query = {};

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Project ID is required',
        })
      );
    });

    it('should return 500 on database error', async () => {
      mockSql.mockRejectedValueOnce(new Error('Database error'));

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Failed to fetch staff',
        })
      );
    });
  });

  describe('POST /api/projects/[projectId]/staff', () => {
    beforeEach(() => {
      req.method = 'POST';
    });

    it('should assign staff to project successfully', async () => {
      req.body = {
        staffId: 'staff-456',
        role: 'Technician',
        startDate: '2024-01-15',
      };

      // Check existing - none found
      mockSql.mockResolvedValueOnce([]);
      // Create new
      mockSql.mockResolvedValueOnce([
        {
          id: 'sp-new',
          staff_id: 'staff-456',
          project_id: 'proj-123',
          role: 'Technician',
          start_date: '2024-01-15',
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ]);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          assignment: expect.objectContaining({
            id: 'sp-new',
            role: 'Technician',
          }),
        })
      );
    });

    it('should reactivate existing assignment', async () => {
      req.body = {
        staffId: 'staff-456',
        role: 'Updated Role',
      };

      // Check existing - found
      mockSql.mockResolvedValueOnce([{ id: 'existing-sp' }]);
      // Update existing
      mockSql.mockResolvedValueOnce([
        {
          id: 'existing-sp',
          staff_id: 'staff-456',
          project_id: 'proj-123',
          role: 'Updated Role',
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ]);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should return 400 when staffId is missing', async () => {
      req.body = { role: 'Technician' };

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Staff ID is required',
        })
      );
    });

    it('should return 500 on database error', async () => {
      req.body = { staffId: 'staff-456' };

      mockSql.mockRejectedValueOnce(new Error('Database error'));

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Failed to assign staff',
        })
      );
    });
  });

  describe('DELETE /api/projects/[projectId]/staff', () => {
    beforeEach(() => {
      req.method = 'DELETE';
    });

    it('should remove staff from project (soft delete)', async () => {
      req.query = { projectId: 'proj-123', staffId: 'staff-456' };

      mockSql.mockResolvedValueOnce([
        {
          id: 'sp-1',
          staff_id: 'staff-456',
          project_id: 'proj-123',
          is_active: false,
          updated_at: new Date().toISOString(),
        },
      ]);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'Staff removed from project',
        })
      );
    });

    it('should return 400 when staffId query param is missing', async () => {
      req.query = { projectId: 'proj-123' };

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Staff ID is required in query params',
        })
      );
    });

    it('should return 404 when assignment not found', async () => {
      req.query = { projectId: 'proj-123', staffId: 'non-existent' };

      mockSql.mockResolvedValueOnce([]);

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Assignment not found',
        })
      );
    });

    it('should return 500 on database error', async () => {
      req.query = { projectId: 'proj-123', staffId: 'staff-456' };

      mockSql.mockRejectedValueOnce(new Error('Database error'));

      await handler(req as NextApiRequest, res as NextApiResponse);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Failed to remove staff',
        })
      );
    });
  });

  describe('Method validation', () => {
    it('should return 405 for unsupported methods', async () => {
      req.method = 'PATCH';

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
