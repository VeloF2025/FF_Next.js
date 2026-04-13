// Unit tests for WorkflowPortalContext
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { WorkflowPortalProvider, useWorkflowPortal } from '../../context/WorkflowPortalContext';
import { workflowManagementService } from '../../services/WorkflowManagementService';
import {
  mockWorkflowTemplates,
  mockProjectWorkflows,
  mockTemplateStats as _mockTemplateStats,
  mockProjectWorkflowStats as _mockProjectWorkflowStats,
  mockSessionStorage,
  waitForAsync as _waitForAsync
} from '../__mocks__/workflow.mocks';

// Mock services
vi.mock('../../services/WorkflowManagementService', () => ({
  workflowManagementService: {
    getTemplates: vi.fn()
  }
}));

// Mock session storage
const mockSessionStorageImpl = mockSessionStorage();
Object.defineProperty(window, 'sessionStorage', {
  value: mockSessionStorageImpl
});

// Mock console to avoid noise in tests
const mockConsole = {
  error: vi.fn(),
  log: vi.fn()
};
Object.defineProperty(console, 'error', { value: mockConsole.error });
Object.defineProperty(console, 'log', { value: mockConsole.log });

describe('WorkflowPortalContext', () => {
  // Helper function to create wrapper with context
  const createWrapper = ({ children }: { children: React.ReactNode }) => (
    <WorkflowPortalProvider>{children}</WorkflowPortalProvider>
  );

  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionStorageImpl.clear();
    
    // Setup default service mock responses
    (workflowManagementService.getTemplates as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      templates: mockWorkflowTemplates,
      total: mockWorkflowTemplates.length
    });
  });

  describe('Initial State', () => {
    it('should initialize with correct default state', () => {
      const { result } = renderHook(() => useWorkflowPortal(), {
        wrapper: createWrapper
      });

      expect(result.current.activeTab).toBe('templates');
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBeUndefined();
      expect(result.current.templateStats).toEqual({
        totalTemplates: 0,
        activeTemplates: 0,
        draftTemplates: 0,
        archivedTemplates: 0,
        recentlyUpdated: 0
      });
      expect(result.current.projectWorkflowStats).toEqual({
        totalProjectWorkflows: 0,
        activeWorkflows: 0,
        completedWorkflows: 0,
        pausedWorkflows: 0,
        overdueWorkflows: 0,
        recentlyUpdated: 0
      });
      expect(result.current.projectWorkflows).toEqual([]);
      expect(result.current.templates).toEqual([]);
    });

    it('should restore active tab from session storage', async () => {
      mockSessionStorageImpl.setItem('workflowActiveTab', 'projects');

      const { result } = renderHook(() => useWorkflowPortal(), {
        wrapper: createWrapper
      });

      // Wait for initial effects to complete
      await waitFor(() => {
        expect(result.current.activeTab).toBe('projects');
      });
    });
  });

  describe('Tab Management', () => {
    it('should set active tab and persist to session storage', () => {
      const { result } = renderHook(() => useWorkflowPortal(), {
        wrapper: createWrapper
      });

      act(() => {
        result.current.setActiveTab('editor');
      });

      expect(result.current.activeTab).toBe('editor');
      expect(mockSessionStorageImpl.setItem).toHaveBeenCalledWith('workflowActiveTab', 'editor');
    });

    it('should update tab badges', () => {
      const { result } = renderHook(() => useWorkflowPortal(), {
        wrapper: createWrapper
      });

      act(() => {
        result.current.updateTabBadge('templates', { count: 5, type: 'info' });
      });

      expect(result.current.tabBadges.templates).toEqual({
        count: 5,
        type: 'info'
      });
    });

    it('should clear tab badge when badge is undefined', () => {
      const { result } = renderHook(() => useWorkflowPortal(), {
        wrapper: createWrapper
      });

      // First set a badge
      act(() => {
        result.current.updateTabBadge('templates', { count: 5, type: 'info' });
      });

      // Then clear it
      act(() => {
        result.current.updateTabBadge('templates', undefined);
      });

      expect(result.current.tabBadges.templates).toEqual({});
    });
  });

  describe('Loading and Error State Management', () => {
    it('should set loading state', () => {
      const { result } = renderHook(() => useWorkflowPortal(), {
        wrapper: createWrapper
      });

      act(() => {
        result.current.setLoading(true);
      });

      expect(result.current.isLoading).toBe(true);
    });

    it('should set error state', () => {
      const { result } = renderHook(() => useWorkflowPortal(), {
        wrapper: createWrapper
      });

      act(() => {
        result.current.setError('Test error message');
      });

      expect(result.current.error).toBe('Test error message');
    });

    it('should clear error state', () => {
      const { result } = renderHook(() => useWorkflowPortal(), {
        wrapper: createWrapper
      });

      act(() => {
        result.current.setError('Test error');
      });

      expect(result.current.error).toBe('Test error');

      act(() => {
        result.current.setError(undefined);
      });

      expect(result.current.error).toBeUndefined();
    });
  });

  describe('Template Statistics Loading', () => {
    it('should load template statistics successfully', async () => {
      const { result } = renderHook(() => useWorkflowPortal(), {
        wrapper: createWrapper
      });

      await act(async () => {
        await result.current.loadTemplateStats();
      });

      await waitFor(() => {
        expect(result.current.templateStats.totalTemplates).toBe(3);
        expect(result.current.templateStats.activeTemplates).toBe(2);
        expect(result.current.templateStats.draftTemplates).toBe(1);
        expect(result.current.templateStats.archivedTemplates).toBe(0);
      });

      expect(workflowManagementService.getTemplates).toHaveBeenCalledWith({
        limit: 1000
      });
    });

    it('should handle template statistics loading error', async () => {
      (workflowManagementService.getTemplates as unknown as { mockRejectedValue: (v: unknown) => void }).mockRejectedValue(
        new Error('Failed to load templates')
      );

      const { result } = renderHook(() => useWorkflowPortal(), {
        wrapper: createWrapper
      });

      await act(async () => {
        await result.current.loadTemplateStats();
      });

      await waitFor(() => {
        expect(result.current.error).toBe('Failed to load templates');
      });

      expect(mockConsole.error).toHaveBeenCalledWith(
        'Error loading template stats:',
        expect.any(Error)
      );
    });

    it('should update tab badges based on template statistics', async () => {
      const { result } = renderHook(() => useWorkflowPortal(), {
        wrapper: createWrapper
      });

      await act(async () => {
        await result.current.loadTemplateStats();
      });

      await waitFor(() => {
        expect(result.current.tabBadges.templates).toEqual({
          count: 3,
          type: 'info'
        });
        expect(result.current.tabBadges.editor).toEqual({
          count: 1,
          type: 'warning'
        });
      });
    });
  });

  describe('Project Workflow Statistics', () => {
    it('should load project workflow statistics', async () => {
      const { result } = renderHook(() => useWorkflowPortal(), {
        wrapper: createWrapper
      });

      // First set some project workflows
      act(() => {
        result.current.loadProjectWorkflows();
      });

      await waitFor(() => {
        expect(result.current.projectWorkflows).toHaveLength(2);
      });

      await act(async () => {
        await result.current.loadProjectWorkflowStats();
      });

      await waitFor(() => {
        expect(result.current.projectWorkflowStats.totalProjectWorkflows).toBe(2);
        expect(result.current.projectWorkflowStats.activeWorkflows).toBe(1);
        expect(result.current.projectWorkflowStats.pausedWorkflows).toBe(1);
      });
    });

    it('should update projects tab badge with overdue workflows', async () => {
      // Create a workflow that's overdue
      const overdueWorkflow = {
        ...mockProjectWorkflows[0],
        status: 'active' as const,
        plannedEndDate: '2023-12-31T00:00:00Z' // Past date
      };

      const { result } = renderHook(() => useWorkflowPortal(), {
        wrapper: createWrapper
      });

      // Mock project workflows to include overdue one
      result.current.projectWorkflows.push(overdueWorkflow);

      await act(async () => {
        await result.current.loadProjectWorkflowStats();
      });

      await waitFor(() => {
        expect(result.current.tabBadges.projects?.type).toBe('error');
      });
    });
  });

  describe('Templates Loading', () => {
    it('should load templates successfully', async () => {
      const { result } = renderHook(() => useWorkflowPortal(), {
        wrapper: createWrapper
      });

      await act(async () => {
        await result.current.loadTemplates();
      });

      await waitFor(() => {
        expect(result.current.templates).toEqual(mockWorkflowTemplates);
      });

      expect(workflowManagementService.getTemplates).toHaveBeenCalledWith({
        status: 'active',
        limit: 100
      });
    });

    it('should handle templates loading error', async () => {
      (workflowManagementService.getTemplates as unknown as { mockRejectedValue: (v: unknown) => void }).mockRejectedValue(
        new Error('Network error')
      );

      const { result } = renderHook(() => useWorkflowPortal(), {
        wrapper: createWrapper
      });

      await act(async () => {
        await result.current.loadTemplates();
      });

      await waitFor(() => {
        expect(result.current.error).toBe('Network error');
      });
    });
  });

  describe('Project Workflow Management', () => {
    it('should load project workflows', async () => {
      const { result } = renderHook(() => useWorkflowPortal(), {
        wrapper: createWrapper
      });

      await act(async () => {
        await result.current.loadProjectWorkflows();
      });

      await waitFor(() => {
        expect(result.current.projectWorkflows).toHaveLength(2);
        expect(result.current.projectWorkflows[0].name).toBe('Fiber Installation Workflow - Downtown Project');
      });
    });

    it('should create project workflow', async () => {
      const { result } = renderHook(() => useWorkflowPortal(), {
        wrapper: createWrapper
      });

      const newWorkflowData = {
        projectId: 'proj-3',
        workflowTemplateId: 'template-1',
        name: 'New Test Workflow',
        assignedTo: 'user-1'
      };

      await act(async () => {
        await result.current.createProjectWorkflow(newWorkflowData);
      });

      // Should call loadProjectWorkflows and loadProjectWorkflowStats
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
    });

    it('should handle project workflow creation error', async () => {
      const { result } = renderHook(() => useWorkflowPortal(), {
        wrapper: createWrapper
      });

      // Mock console.error to throw an error
      const originalError = console.error;
      console.error = vi.fn().mockImplementation(() => {
        throw new Error('Creation failed');
      });

      const newWorkflowData = {
        projectId: 'proj-3',
        workflowTemplateId: 'template-1',
        name: 'New Test Workflow'
      };

      await act(async () => {
        await result.current.createProjectWorkflow(newWorkflowData);
      });

      console.error = originalError;
    });
  });

  describe('Data Refresh', () => {
    it('should refresh all data', async () => {
      const { result } = renderHook(() => useWorkflowPortal(), {
        wrapper: createWrapper
      });

      await act(async () => {
        await result.current.refreshData();
      });

      await waitFor(() => {
        expect(result.current.templates).toHaveLength(3);
        expect(result.current.projectWorkflows).toHaveLength(2);
        expect(result.current.templateStats.totalTemplates).toBe(3);
      });
    });

    it('should refresh templates only', async () => {
      const { result } = renderHook(() => useWorkflowPortal(), {
        wrapper: createWrapper
      });

      await act(async () => {
        await result.current.refreshTemplates();
      });

      await waitFor(() => {
        expect(result.current.templates).toHaveLength(3);
      });

      expect(workflowManagementService.getTemplates).toHaveBeenCalledWith({
        status: 'active',
        limit: 100
      });
    });
  });

  describe('Hook Error Handling', () => {
    it('should throw error when used outside provider', () => {
      // Mock console.error to suppress test output
      const originalError = console.error;
      console.error = vi.fn();

      expect(() => {
        renderHook(() => useWorkflowPortal());
      }).toThrow('useWorkflowPortal must be used within a WorkflowPortalProvider');

      console.error = originalError;
    });
  });

  describe('Initial Data Loading', () => {
    it('should load initial data on mount', async () => {
      renderHook(() => useWorkflowPortal(), {
        wrapper: createWrapper
      });

      // Wait for initial data loading
      await waitFor(() => {
        expect(workflowManagementService.getTemplates).toHaveBeenCalled();
      });
    });

    it('should handle service rejection gracefully', async () => {
      (workflowManagementService.getTemplates as unknown as { mockRejectedValue: (v: unknown) => void }).mockRejectedValue(
        new Error('Service unavailable')
      );

      const { result } = renderHook(() => useWorkflowPortal(), {
        wrapper: createWrapper
      });

      await waitFor(() => {
        expect(result.current.error).toBeTruthy();
      });
    });
  });
});