// Integration tests for WorkflowManagementService
import { workflowManagementService } from '../../services/WorkflowManagementService';
import {
  mockWorkflowTemplates,
  mockWorkflowPhases,
  mockWorkflowSteps,
  mockWorkflowTasks,
  mockProjectWorkflows,
  mockWorkflowValidationResult,
  mockWorkflowAnalytics,
  createMockWorkflowTemplate,
  createMockWorkflowPhase,
  createMockWorkflowStep,
  createMockProjectWorkflow
} from '../__mocks__/workflow.mocks';
import type {
  WorkflowTemplateQuery,
  CreateWorkflowTemplateRequest,
  UpdateWorkflowTemplateRequest,
  CreateWorkflowPhaseRequest,
  CreateWorkflowStepRequest,
  CreateProjectWorkflowRequest,
  UpdateProjectWorkflowRequest,
  BulkUpdateOrderRequest
} from '../../types/workflow.types';

// Mock fetch API for HTTP requests
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock environment variables
process.env.VITE_API_BASE_URL = 'http://localhost:3001';

describe('WorkflowManagementService Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockClear();
  });

  describe('Template Management', () => {
    describe('getTemplates', () => {
      it('should fetch templates with default parameters', async () => {
        const mockResponse = {
          templates: mockWorkflowTemplates,
          total: mockWorkflowTemplates.length,
          page: 1,
          limit: 20
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => mockResponse
        });

        const result = await workflowManagementService.getTemplates();

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:3001/api/workflow/templates?limit=20&offset=0',
          {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json'
            }
          }
        );

        expect(result).toEqual(mockResponse);
      });

      it('should fetch templates with query parameters', async () => {
        const query: WorkflowTemplateQuery = {
          category: 'telecommunications',
          status: 'active',
          search: 'fiber',
          tags: ['installation'],
          isDefault: true,
          limit: 10,
          offset: 20,
          orderBy: 'name',
          orderDirection: 'asc'
        };

        const mockResponse = {
          templates: [mockWorkflowTemplates[0]],
          total: 1,
          page: 3,
          limit: 10
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => mockResponse
        });

        const result = await workflowManagementService.getTemplates(query);

        const expectedUrl = new URL('http://localhost:3001/api/workflow/templates');
        expectedUrl.searchParams.set('category', 'telecommunications');
        expectedUrl.searchParams.set('status', 'active');
        expectedUrl.searchParams.set('search', 'fiber');
        expectedUrl.searchParams.set('tags', 'installation');
        expectedUrl.searchParams.set('isDefault', 'true');
        expectedUrl.searchParams.set('limit', '10');
        expectedUrl.searchParams.set('offset', '20');
        expectedUrl.searchParams.set('orderBy', 'name');
        expectedUrl.searchParams.set('orderDirection', 'asc');

        expect(mockFetch).toHaveBeenCalledWith(
          expectedUrl.toString(),
          {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json'
            }
          }
        );

        expect(result).toEqual(mockResponse);
      });

      it('should handle API errors gracefully', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: async () => ({ error: 'Database connection failed' })
        });

        await expect(workflowManagementService.getTemplates()).rejects.toThrow(
          'Failed to fetch templates: Internal Server Error'
        );
      });

      it('should handle network errors', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Network error'));

        await expect(workflowManagementService.getTemplates()).rejects.toThrow(
          'Network error'
        );
      });
    });

    describe('getTemplateById', () => {
      it('should fetch template by ID with full data', async () => {
        const templateWithRelations = {
          ...mockWorkflowTemplates[0],
          phases: mockWorkflowPhases
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => templateWithRelations
        });

        const result = await workflowManagementService.getTemplateById('template-1');

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:3001/api/workflow/templates/template-1?include=phases,steps,tasks',
          {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json'
            }
          }
        );

        expect(result).toEqual(templateWithRelations);
      });

      it('should return null for non-existent template', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found'
        });

        const result = await workflowManagementService.getTemplateById('non-existent');

        expect(result).toBeNull();
      });

      it('should throw error for other HTTP errors', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error'
        });

        await expect(
          workflowManagementService.getTemplateById('template-1')
        ).rejects.toThrow('Failed to fetch template: Internal Server Error');
      });
    });

    describe('createTemplate', () => {
      it('should create new template successfully', async () => {
        const templateData: CreateWorkflowTemplateRequest = {
          name: 'New Test Template',
          description: 'Test template description',
          category: 'project',
          type: 'custom',
          tags: ['test', 'custom']
        };

        const createdTemplate = createMockWorkflowTemplate(templateData);

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => createdTemplate
        });

        const result = await workflowManagementService.createTemplate(templateData);

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:3001/api/workflow/templates',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(templateData)
          }
        );

        expect(result).toEqual(createdTemplate);
      });

      it('should handle validation errors', async () => {
        const templateData: CreateWorkflowTemplateRequest = {
          name: '', // Invalid empty name
          category: 'project'
        };

        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          json: async () => ({
            error: 'Validation failed',
            details: ['Name is required']
          })
        });

        await expect(
          workflowManagementService.createTemplate(templateData)
        ).rejects.toThrow('Failed to create template: Bad Request');
      });
    });

    describe('updateTemplate', () => {
      it('should update template successfully', async () => {
        const updateData: UpdateWorkflowTemplateRequest = {
          name: 'Updated Template Name',
          description: 'Updated description',
          status: 'active'
        };

        const updatedTemplate = {
          ...mockWorkflowTemplates[0],
          ...updateData,
          updatedAt: new Date().toISOString()
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => updatedTemplate
        });

        const result = await workflowManagementService.updateTemplate('template-1', updateData);

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:3001/api/workflow/templates/template-1',
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(updateData)
          }
        );

        expect(result).toEqual(updatedTemplate);
      });

      it('should handle non-existent template', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found'
        });

        await expect(
          workflowManagementService.updateTemplate('non-existent', { name: 'Updated' })
        ).rejects.toThrow('Failed to update template: Not Found');
      });
    });

    describe('deleteTemplate', () => {
      it('should delete template successfully', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 204
        });

        await workflowManagementService.deleteTemplate('template-1');

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:3001/api/workflow/templates/template-1',
          {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json'
            }
          }
        );
      });

      it('should handle template with active projects', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 409,
          statusText: 'Conflict',
          json: async () => ({
            error: 'Template has active projects',
            activeProjects: 3
          })
        });

        await expect(
          workflowManagementService.deleteTemplate('template-1')
        ).rejects.toThrow('Failed to delete template: Conflict');
      });
    });

    describe('duplicateTemplate', () => {
      it('should duplicate template successfully', async () => {
        const duplicatedTemplate = {
          ...mockWorkflowTemplates[0],
          id: 'duplicated-template',
          name: 'Copy of Standard Fiber Installation',
          isDefault: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => duplicatedTemplate
        });

        const result = await workflowManagementService.duplicateTemplate(
          'template-1',
          'Copy of Standard Fiber Installation'
        );

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:3001/api/workflow/templates/template-1/duplicate',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              name: 'Copy of Standard Fiber Installation'
            })
          }
        );

        expect(result).toEqual(duplicatedTemplate);
      });
    });
  });

  describe('Phase Management', () => {
    describe('getPhases', () => {
      it('should fetch phases for template', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => mockWorkflowPhases
        });

        const result = await workflowManagementService.getPhases('template-1');

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:3001/api/workflow/templates/template-1/phases',
          {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json'
            }
          }
        );

        expect(result).toEqual(mockWorkflowPhases);
      });
    });

    describe('createPhase', () => {
      it('should create phase successfully', async () => {
        const phaseData: CreateWorkflowPhaseRequest = {
          workflowTemplateId: 'template-1',
          name: 'New Phase',
          description: 'Test phase',
          orderIndex: 2,
          color: '#ff0000',
          requiredRoles: ['technician'],
          completionCriteria: ['All tasks complete']
        };

        const createdPhase = createMockWorkflowPhase(phaseData);

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => createdPhase
        });

        const result = await workflowManagementService.createPhase(phaseData);

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:3001/api/workflow/phases',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(phaseData)
          }
        );

        expect(result).toEqual(createdPhase);
      });
    });

    describe('reorderPhases', () => {
      it('should reorder phases successfully', async () => {
        const reorderData: BulkUpdateOrderRequest = {
          items: [
            { id: 'phase-1', orderIndex: 1 },
            { id: 'phase-2', orderIndex: 0 }
          ]
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 204
        });

        await workflowManagementService.reorderPhases('template-1', reorderData);

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:3001/api/workflow/templates/template-1/phases/reorder',
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(reorderData)
          }
        );
      });
    });
  });

  describe('Step Management', () => {
    describe('getSteps', () => {
      it('should fetch steps for phase', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => mockWorkflowSteps
        });

        const result = await workflowManagementService.getSteps('phase-1');

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:3001/api/workflow/phases/phase-1/steps',
          {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json'
            }
          }
        );

        expect(result).toEqual(mockWorkflowSteps);
      });
    });

    describe('createStep', () => {
      it('should create step successfully', async () => {
        const stepData: CreateWorkflowStepRequest = {
          workflowPhaseId: 'phase-1',
          name: 'New Step',
          description: 'Test step',
          orderIndex: 1,
          stepType: 'task',
          estimatedDuration: 4,
          preconditions: ['Previous step complete'],
          postconditions: ['Task verified']
        };

        const createdStep = createMockWorkflowStep(stepData);

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => createdStep
        });

        const result = await workflowManagementService.createStep(stepData);

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:3001/api/workflow/steps',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(stepData)
          }
        );

        expect(result).toEqual(createdStep);
      });
    });
  });

  describe('Task Management', () => {
    describe('getTasks', () => {
      it('should fetch tasks for step', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => mockWorkflowTasks
        });

        const result = await workflowManagementService.getTasks('step-1');

        expect(result).toEqual(mockWorkflowTasks);
      });
    });

    describe('bulkDeleteTasks', () => {
      it('should delete multiple tasks', async () => {
        const taskIds = ['task-1', 'task-2', 'task-3'];

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 204
        });

        await workflowManagementService.bulkDeleteTasks(taskIds);

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:3001/api/workflow/tasks/bulk-delete',
          {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ ids: taskIds })
          }
        );
      });
    });
  });

  describe('Project Workflow Management', () => {
    describe('createProjectWorkflow', () => {
      it('should create project workflow successfully', async () => {
        const workflowData: CreateProjectWorkflowRequest = {
          projectId: 'proj-1',
          workflowTemplateId: 'template-1',
          name: 'New Project Workflow',
          assignedTo: 'user-1',
          teamMembers: ['user-1', 'user-2']
        };

        const createdWorkflow = createMockProjectWorkflow(workflowData);

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => createdWorkflow
        });

        const result = await workflowManagementService.createProjectWorkflow(workflowData);

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:3001/api/project-workflows',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(workflowData)
          }
        );

        expect(result).toEqual(createdWorkflow);
      });
    });

    describe('updateProjectWorkflow', () => {
      it('should update project workflow status', async () => {
        const updateData: UpdateProjectWorkflowRequest = {
          status: 'completed',
          progressPercentage: 100,
          actualEndDate: new Date().toISOString()
        };

        const updatedWorkflow = {
          ...mockProjectWorkflows[0],
          ...updateData,
          updatedAt: new Date().toISOString()
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => updatedWorkflow
        });

        const result = await workflowManagementService.updateProjectWorkflow(
          'proj-workflow-1',
          updateData
        );

        expect(result).toEqual(updatedWorkflow);
      });
    });
  });

  describe('Validation and Analytics', () => {
    describe('validateTemplate', () => {
      it('should validate template and return results', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => mockWorkflowValidationResult
        });

        const result = await workflowManagementService.validateTemplate('template-1');

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:3001/api/workflow/templates/template-1/validate',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            }
          }
        );

        expect(result).toEqual(mockWorkflowValidationResult);
      });

      it('should handle validation service errors', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error'
        });

        await expect(
          workflowManagementService.validateTemplate('template-1')
        ).rejects.toThrow('Failed to validate template: Internal Server Error');
      });
    });

    describe('getAnalytics', () => {
      it('should fetch analytics with date range', async () => {
        const dateFrom = '2024-01-01';
        const dateTo = '2024-12-31';

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => mockWorkflowAnalytics
        });

        const result = await workflowManagementService.getAnalytics(dateFrom, dateTo);

        expect(mockFetch).toHaveBeenCalledWith(
          `http://localhost:3001/api/workflow/analytics?dateFrom=${dateFrom}&dateTo=${dateTo}`,
          {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json'
            }
          }
        );

        expect(result).toEqual(mockWorkflowAnalytics);
      });

      it('should fetch analytics without date range', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => mockWorkflowAnalytics
        });

        const result = await workflowManagementService.getAnalytics();

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:3001/api/workflow/analytics',
          {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json'
            }
          }
        );

        expect(result).toEqual(mockWorkflowAnalytics);
      });
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle malformed JSON responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error('Invalid JSON');
        }
      });

      await expect(workflowManagementService.getTemplates()).rejects.toThrow('Invalid JSON');
    });

    it('should handle rate limiting', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        json: async () => ({
          error: 'Rate limit exceeded',
          retryAfter: 60
        })
      });

      await expect(workflowManagementService.getTemplates()).rejects.toThrow(
        'Failed to fetch templates: Too Many Requests'
      );
    });

    it('should handle request timeout', async () => {
      mockFetch.mockImplementationOnce(() => {
        return new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Request timeout')), 100);
        });
      });

      await expect(workflowManagementService.getTemplates()).rejects.toThrow('Request timeout');
    });
  });

  describe('Authentication Integration', () => {
    it('should include authorization header when token is present', async () => {
      // Mock getting auth token from local storage or context
      const mockToken = 'mock-jwt-token';
      Object.defineProperty(window, 'localStorage', {
        value: {
          getItem: vi.fn(() => mockToken)
        }
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ templates: [], total: 0 })
      });

      await workflowManagementService.getTemplates();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${mockToken}`
          })
        })
      );
    });
  });
});