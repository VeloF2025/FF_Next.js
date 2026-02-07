/**
 * Tests for Staff Project Service
 * Tests all staff-project assignment operations
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StaffProjectServiceClass } from '../staffProjectService';
import type { StaffProject, StaffProjectAssignment } from '@/types/staff-project.types';

// Mock logger
vi.mock('@/lib/logger', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), getLogs: vi.fn(() => []), clearLogs: vi.fn() },
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Create a fresh instance for testing
const createService = () => new StaffProjectServiceClass();

// Mock data factories
const createMockStaffProject = (overrides: Partial<StaffProject> = {}): StaffProject => ({
  id: 'sp-123',
  staffId: 'staff-456',
  projectId: 'proj-789',
  role: 'Technician',
  startDate: '2024-01-15',
  endDate: undefined,
  isActive: true,
  assignedBy: 'admin-123',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  project: {
    id: 'proj-789',
    name: 'Fiber Installation Project',
    status: 'active',
  },
  staff: {
    id: 'staff-456',
    name: 'John Doe',
  },
  ...overrides,
});

describe('StaffProjectService', () => {
  let service: StaffProjectServiceClass;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    service = createService();
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getByStaffId', () => {
    it('should fetch projects for a staff member', async () => {
      const mockProjects = [
        createMockStaffProject({ id: 'sp-1', projectId: 'proj-1' }),
        createMockStaffProject({ id: 'sp-2', projectId: 'proj-2' }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ projects: mockProjects }),
      });

      const result = await service.getByStaffId('staff-456');

      expect(mockFetch).toHaveBeenCalledWith('/api/staff/staff-456/projects');
      expect(result).toEqual(mockProjects);
    });

    it('should fetch only active projects when activeOnly is true', async () => {
      const mockProjects = [createMockStaffProject({ isActive: true })];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ projects: mockProjects }),
      });

      const result = await service.getByStaffId('staff-456', true);

      expect(mockFetch).toHaveBeenCalledWith('/api/staff/staff-456/projects?activeOnly=true');
      expect(result).toEqual(mockProjects);
    });

    it('should return empty array when staff has no projects', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ projects: [] }),
      });

      const result = await service.getByStaffId('staff-456');

      expect(result).toEqual([]);
    });

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ message: 'Staff not found' }),
      });

      await expect(service.getByStaffId('invalid-staff')).rejects.toThrow('Staff not found');
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(service.getByStaffId('staff-456')).rejects.toThrow('Network error');
    });
  });

  describe('getByProjectId', () => {
    it('should fetch staff assigned to a project', async () => {
      const mockStaff = [
        createMockStaffProject({ staffId: 'staff-1' }),
        createMockStaffProject({ staffId: 'staff-2' }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ staff: mockStaff }),
      });

      const result = await service.getByProjectId('proj-789');

      expect(mockFetch).toHaveBeenCalledWith('/api/projects/proj-789/staff');
      expect(result).toEqual(mockStaff);
    });

    it('should fetch only active staff when activeOnly is true', async () => {
      const mockStaff = [createMockStaffProject({ isActive: true })];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ staff: mockStaff }),
      });

      const result = await service.getByProjectId('proj-789', true);

      expect(mockFetch).toHaveBeenCalledWith('/api/projects/proj-789/staff?activeOnly=true');
      expect(result).toEqual(mockStaff);
    });

    it('should return empty array when project has no staff', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ staff: [] }),
      });

      const result = await service.getByProjectId('proj-789');

      expect(result).toEqual([]);
    });

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ message: 'Project not found' }),
      });

      await expect(service.getByProjectId('invalid-proj')).rejects.toThrow('Project not found');
    });
  });

  describe('assign', () => {
    it('should assign staff to project successfully', async () => {
      const assignment: StaffProjectAssignment = {
        staffId: 'staff-456',
        projectId: 'proj-789',
        role: 'Lead Technician',
        startDate: '2024-01-15',
      };

      const mockAssignment = createMockStaffProject({
        ...assignment,
        id: 'new-sp-id',
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ assignment: mockAssignment }),
      });

      const result = await service.assign(assignment);

      expect(mockFetch).toHaveBeenCalledWith('/api/staff/staff-456/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(assignment),
      });
      expect(result).toEqual(mockAssignment);
    });

    it('should assign staff to project with minimal data', async () => {
      const assignment: StaffProjectAssignment = {
        staffId: 'staff-456',
        projectId: 'proj-789',
      };

      const mockAssignment = createMockStaffProject({
        ...assignment,
        role: undefined,
        startDate: undefined,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ assignment: mockAssignment }),
      });

      const result = await service.assign(assignment);

      expect(result.staffId).toBe('staff-456');
      expect(result.projectId).toBe('proj-789');
    });

    it('should handle duplicate assignment error', async () => {
      const assignment: StaffProjectAssignment = {
        staffId: 'staff-456',
        projectId: 'proj-789',
      };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ message: 'Staff already assigned to project' }),
      });

      await expect(service.assign(assignment)).rejects.toThrow('Staff already assigned to project');
    });

    it('should handle staff not found error', async () => {
      const assignment: StaffProjectAssignment = {
        staffId: 'invalid-staff',
        projectId: 'proj-789',
      };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ message: 'Staff not found' }),
      });

      await expect(service.assign(assignment)).rejects.toThrow('Staff not found');
    });

    it('should handle project not found error', async () => {
      const assignment: StaffProjectAssignment = {
        staffId: 'staff-456',
        projectId: 'invalid-proj',
      };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ message: 'Project not found' }),
      });

      await expect(service.assign(assignment)).rejects.toThrow('Project not found');
    });
  });

  describe('update', () => {
    it('should update assignment successfully', async () => {
      const updatedAssignment = createMockStaffProject({
        role: 'Senior Technician',
        endDate: '2024-12-31',
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ assignment: updatedAssignment }),
      });

      const result = await service.update('sp-123', {
        role: 'Senior Technician',
        endDate: '2024-12-31',
      });

      expect(mockFetch).toHaveBeenCalledWith('/api/staff-projects/sp-123', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: 'Senior Technician',
          endDate: '2024-12-31',
        }),
      });
      expect(result).toEqual(updatedAssignment);
    });

    it('should handle update errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ message: 'Assignment not found' }),
      });

      await expect(service.update('invalid-sp', { role: 'New Role' })).rejects.toThrow(
        'Assignment not found'
      );
    });
  });

  describe('unassign', () => {
    it('should unassign staff from project successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      await service.unassign('staff-456', 'proj-789');

      expect(mockFetch).toHaveBeenCalledWith('/api/projects/proj-789/staff/staff-456', {
        method: 'DELETE',
      });
    });

    it('should handle unassignment errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ message: 'Assignment not found' }),
      });

      await expect(service.unassign('staff-456', 'proj-789')).rejects.toThrow('Assignment not found');
    });
  });

  describe('deactivate', () => {
    it('should deactivate assignment by calling update with isActive: false', async () => {
      const deactivatedAssignment = createMockStaffProject({ isActive: false });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ assignment: deactivatedAssignment }),
      });

      const result = await service.deactivate('sp-123');

      expect(mockFetch).toHaveBeenCalledWith('/api/staff-projects/sp-123', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: false }),
      });
      expect(result.isActive).toBe(false);
    });
  });

  describe('reactivate', () => {
    it('should reactivate assignment by calling update with isActive: true', async () => {
      const reactivatedAssignment = createMockStaffProject({ isActive: true });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ assignment: reactivatedAssignment }),
      });

      const result = await service.reactivate('sp-123');

      expect(mockFetch).toHaveBeenCalledWith('/api/staff-projects/sp-123', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: true }),
      });
      expect(result.isActive).toBe(true);
    });
  });

  describe('updateRole', () => {
    it('should update role by calling update with role', async () => {
      const updatedAssignment = createMockStaffProject({ role: 'Project Manager' });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ assignment: updatedAssignment }),
      });

      const result = await service.updateRole('sp-123', 'Project Manager');

      expect(mockFetch).toHaveBeenCalledWith('/api/staff-projects/sp-123', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'Project Manager' }),
      });
      expect(result.role).toBe('Project Manager');
    });
  });

  describe('getProjectStaffSummary', () => {
    it('should return project staff summary', async () => {
      const mockStaff = [
        createMockStaffProject({ role: 'Technician', isActive: true }),
        createMockStaffProject({ role: 'Technician', isActive: true }),
        createMockStaffProject({ role: 'Lead', isActive: true }),
        createMockStaffProject({ role: 'Manager', isActive: false }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ staff: mockStaff }),
      });

      const result = await service.getProjectStaffSummary('proj-789');

      expect(result.projectId).toBe('proj-789');
      expect(result.totalStaff).toBe(4);
      expect(result.activeStaff).toBe(3);
      expect(result.staffByRole).toEqual({
        Technician: 2,
        Lead: 1,
      });
    });

    it('should handle unassigned roles', async () => {
      const mockStaff = [
        createMockStaffProject({ role: undefined, isActive: true }),
        createMockStaffProject({ role: '', isActive: true }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ staff: mockStaff }),
      });

      const result = await service.getProjectStaffSummary('proj-789');

      expect(result.staffByRole).toEqual({
        Unassigned: 2,
      });
    });

    it('should return empty summary for project with no staff', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ staff: [] }),
      });

      const result = await service.getProjectStaffSummary('proj-789');

      expect(result.projectId).toBe('proj-789');
      expect(result.totalStaff).toBe(0);
      expect(result.activeStaff).toBe(0);
      expect(result.staffByRole).toEqual({});
    });

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ message: 'Project not found' }),
      });

      await expect(service.getProjectStaffSummary('invalid-proj')).rejects.toThrow('Project not found');
    });
  });

  describe('getStaffProjectSummary', () => {
    it('should return staff project summary', async () => {
      const mockProjects = [
        createMockStaffProject({
          isActive: true,
          project: { id: 'proj-1', name: 'Project A', status: 'active' },
        }),
        createMockStaffProject({
          isActive: true,
          project: { id: 'proj-2', name: 'Project B', status: 'active' },
        }),
        createMockStaffProject({
          isActive: false,
          project: { id: 'proj-3', name: 'Project C', status: 'completed' },
        }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ projects: mockProjects }),
      });

      const result = await service.getStaffProjectSummary('staff-456');

      expect(result.staffId).toBe('staff-456');
      expect(result.totalProjects).toBe(3);
      expect(result.activeProjects).toBe(2);
      expect(result.projectNames).toEqual(['Project A', 'Project B']);
    });

    it('should return empty summary for staff with no projects', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ projects: [] }),
      });

      const result = await service.getStaffProjectSummary('staff-456');

      expect(result.staffId).toBe('staff-456');
      expect(result.totalProjects).toBe(0);
      expect(result.activeProjects).toBe(0);
      expect(result.projectNames).toEqual([]);
    });

    it('should handle missing project names', async () => {
      const mockProjects = [
        createMockStaffProject({ isActive: true, project: undefined }),
        createMockStaffProject({
          isActive: true,
          project: { id: 'proj-1', name: 'Project A', status: 'active' },
        }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ projects: mockProjects }),
      });

      const result = await service.getStaffProjectSummary('staff-456');

      expect(result.projectNames).toEqual(['Unknown', 'Project A']);
    });

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ message: 'Staff not found' }),
      });

      await expect(service.getStaffProjectSummary('invalid-staff')).rejects.toThrow('Staff not found');
    });
  });

  describe('bulkAssign', () => {
    it('should assign multiple staff to a project', async () => {
      const assignments = [
        { staffId: 'staff-1', role: 'Technician' },
        { staffId: 'staff-2', role: 'Lead' },
        { staffId: 'staff-3' },
      ];

      const mockResults = assignments.map((a, i) =>
        createMockStaffProject({
          id: `sp-${i}`,
          staffId: a.staffId,
          role: a.role,
          projectId: 'proj-789',
        })
      );

      // Mock each assignment call
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ assignment: mockResults[0] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ assignment: mockResults[1] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ assignment: mockResults[2] }),
        });

      const result = await service.bulkAssign('proj-789', assignments);

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(result).toHaveLength(3);
      expect(result[0].staffId).toBe('staff-1');
      expect(result[1].staffId).toBe('staff-2');
      expect(result[2].staffId).toBe('staff-3');
    });

    it('should handle partial failures in bulk assign', async () => {
      const assignments = [
        { staffId: 'staff-1' },
        { staffId: 'invalid-staff' },
      ];

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ assignment: createMockStaffProject({ staffId: 'staff-1' }) }),
        })
        .mockResolvedValueOnce({
          ok: false,
          json: async () => ({ message: 'Staff not found' }),
        });

      await expect(service.bulkAssign('proj-789', assignments)).rejects.toThrow('Staff not found');
    });

    it('should handle empty assignments array', async () => {
      const result = await service.bulkAssign('proj-789', []);

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });
});
