/**
 * Tests for StaffProjectAssignment component
 * Manages staff-project assignments with role selection
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StaffProjectAssignment } from '../../../src/components/staff/StaffProjectAssignment';

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

// Mock confirm
const mockConfirm = vi.fn();

describe('StaffProjectAssignment', () => {
  const defaultProps = {
    staffId: 'staff-123',
    staffName: 'John Doe',
  };

  const mockAssignments = [
    {
      id: 'sp-1',
      staffId: 'staff-123',
      projectId: 'proj-1',
      role: 'Team Lead',
      isActive: true,
      startDate: '2024-01-15',
      endDate: '2024-12-31',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      project: {
        id: 'proj-1',
        name: 'Fiber Network Alpha',
        status: 'active',
        client: 'Client Corp',
      },
    },
    {
      id: 'sp-2',
      staffId: 'staff-123',
      projectId: 'proj-2',
      role: 'Technician',
      isActive: true,
      startDate: '2024-02-01',
      createdAt: '2024-02-01T00:00:00Z',
      updatedAt: '2024-02-01T00:00:00Z',
      project: {
        id: 'proj-2',
        name: 'Metro Expansion',
        status: 'active',
      },
    },
  ];

  const mockProjects = [
    { id: 'proj-1', name: 'Fiber Network Alpha', status: 'active', client: 'Client Corp' },
    { id: 'proj-2', name: 'Metro Expansion', status: 'active' },
    { id: 'proj-3', name: 'Rural Connect', status: 'planning', client: 'County Gov' },
    { id: 'proj-4', name: 'City Backbone', status: 'active' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    global.confirm = mockConfirm;
    mockConfirm.mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const setupFetchMock = (assignmentsResponse: unknown, projectsResponse: unknown) => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/staff/') && url.includes('/projects')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(assignmentsResponse),
        });
      }
      if (url === '/api/projects') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(projectsResponse),
        });
      }
      return Promise.reject(new Error('Unknown URL'));
    });
  };

  describe('Loading state', () => {
    it('should show loading spinner while fetching data', async () => {
      // Never resolve the promise to keep it in loading state
      global.fetch = vi.fn().mockImplementation(() => new Promise(() => {}));

      const { container } = render(<StaffProjectAssignment {...defaultProps} />);

      expect(container.querySelector('.animate-spin')).toBeTruthy();
    });

    it('should hide loading spinner after data loads', async () => {
      setupFetchMock({ projects: mockAssignments }, { projects: mockProjects });

      render(<StaffProjectAssignment {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Project Assignments')).toBeInTheDocument();
      });

      // Loading spinner should be gone
      expect(document.querySelector('.animate-spin')).not.toBeInTheDocument();
    });
  });

  describe('Empty state', () => {
    it('should show empty state when no assignments exist', async () => {
      setupFetchMock({ projects: [] }, { projects: mockProjects });

      render(<StaffProjectAssignment {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('No project assignments')).toBeInTheDocument();
      });

      expect(
        screen.getByText('Click "Assign to Project" to add this staff member to a project')
      ).toBeInTheDocument();
    });

    it('should show 0 active projects in summary', async () => {
      setupFetchMock({ projects: [] }, { projects: mockProjects });

      render(<StaffProjectAssignment {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('0 active projects')).toBeInTheDocument();
      });
    });
  });

  describe('Rendering assignments', () => {
    it('should display assignment project names', async () => {
      setupFetchMock({ projects: mockAssignments }, { projects: mockProjects });

      render(<StaffProjectAssignment {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Fiber Network Alpha')).toBeInTheDocument();
        expect(screen.getByText('Metro Expansion')).toBeInTheDocument();
      });
    });

    it('should display assignment roles', async () => {
      setupFetchMock({ projects: mockAssignments }, { projects: mockProjects });

      render(<StaffProjectAssignment {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Team Lead')).toBeInTheDocument();
        expect(screen.getByText('Technician')).toBeInTheDocument();
      });
    });

    it('should display client information when available', async () => {
      setupFetchMock({ projects: mockAssignments }, { projects: mockProjects });

      render(<StaffProjectAssignment {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Client Corp')).toBeInTheDocument();
      });
    });

    it('should display formatted dates', async () => {
      setupFetchMock({ projects: mockAssignments }, { projects: mockProjects });

      render(<StaffProjectAssignment {...defaultProps} />);

      await waitFor(() => {
        // Check for date presence (format may vary by locale — day-first,
        // month-first, or abbreviated month name, all accepted).
        expect(
          screen.getByText(/1\/15\/2024|15\/1\/2024|jan|january|2024[-/]0?1[-/]15|15[-/]0?1[-/]2024/i)
        ).toBeInTheDocument();
      });
    });

    it('should show correct active project count', async () => {
      setupFetchMock({ projects: mockAssignments }, { projects: mockProjects });

      render(<StaffProjectAssignment {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('2 active projects')).toBeInTheDocument();
      });
    });

    it('should use singular form for 1 project', async () => {
      const singleAssignment = [mockAssignments[0]];
      setupFetchMock({ projects: singleAssignment }, { projects: mockProjects });

      render(<StaffProjectAssignment {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('1 active project')).toBeInTheDocument();
      });
    });

    it('should show "Unknown Project" when project data is missing', async () => {
      const assignmentWithoutProject = [
        {
          id: 'sp-3',
          staffId: 'staff-123',
          projectId: 'proj-unknown',
          isActive: true,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ];
      setupFetchMock({ projects: assignmentWithoutProject }, { projects: mockProjects });

      render(<StaffProjectAssignment {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Unknown Project')).toBeInTheDocument();
      });
    });

    it('should only show active assignments', async () => {
      const mixedAssignments = [
        ...mockAssignments,
        {
          id: 'sp-inactive',
          staffId: 'staff-123',
          projectId: 'proj-3',
          isActive: false,
          project: { id: 'proj-3', name: 'Inactive Project' },
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ];
      setupFetchMock({ projects: mixedAssignments }, { projects: mockProjects });

      render(<StaffProjectAssignment {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('2 active projects')).toBeInTheDocument();
        expect(screen.queryByText('Inactive Project')).not.toBeInTheDocument();
      });
    });
  });

  describe('Add assignment form toggle', () => {
    it('should show "Assign to Project" button', async () => {
      setupFetchMock({ projects: mockAssignments }, { projects: mockProjects });

      render(<StaffProjectAssignment {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /assign to project/i })).toBeInTheDocument();
      });
    });

    it('should show form when "Assign to Project" button is clicked', async () => {
      setupFetchMock({ projects: mockAssignments }, { projects: mockProjects });
      const user = userEvent.setup();

      render(<StaffProjectAssignment {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /assign to project/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /assign to project/i }));

      expect(screen.getByText(/Assign John Doe to Project/i)).toBeInTheDocument();
    });

    it('should hide form when Cancel is clicked', async () => {
      setupFetchMock({ projects: mockAssignments }, { projects: mockProjects });
      const user = userEvent.setup();

      render(<StaffProjectAssignment {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /assign to project/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /assign to project/i }));
      expect(screen.getByText(/Assign John Doe to Project/i)).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /cancel/i }));
      expect(screen.queryByText(/Assign John Doe to Project/i)).not.toBeInTheDocument();
    });

    it('should toggle form when button is clicked multiple times', async () => {
      setupFetchMock({ projects: mockAssignments }, { projects: mockProjects });
      const user = userEvent.setup();

      render(<StaffProjectAssignment {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /assign to project/i })).toBeInTheDocument();
      });

      // Open
      await user.click(screen.getByRole('button', { name: /assign to project/i }));
      expect(screen.getByText(/Assign John Doe to Project/i)).toBeInTheDocument();

      // Close via button toggle
      await user.click(screen.getByRole('button', { name: /assign to project/i }));
      expect(screen.queryByText(/Assign John Doe to Project/i)).not.toBeInTheDocument();
    });
  });

  // Helper to find select by its label text (looks for labels in form structure)
  const findSelectByLabel = (labelText: string): HTMLSelectElement => {
    const labels = screen.getAllByText((content, element) => {
      return (
        element?.tagName.toLowerCase() === 'label' &&
        content.includes(labelText)
      );
    });
    const label = labels[0];
    const parent = label.closest('div');
    return parent?.querySelector('select') as HTMLSelectElement;
  };

  describe('Add assignment form fields', () => {
    it('should display project dropdown with unassigned projects only', async () => {
      setupFetchMock({ projects: mockAssignments }, { projects: mockProjects });
      const user = userEvent.setup();

      render(<StaffProjectAssignment {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /assign to project/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /assign to project/i }));

      await waitFor(() => {
        expect(screen.getByText('Project *')).toBeInTheDocument();
      });

      const projectSelect = findSelectByLabel('Project');
      expect(projectSelect).toBeInTheDocument();

      // Get all options
      const options = within(projectSelect).getAllByRole('option');
      const optionTexts = options.map((opt) => opt.textContent);

      // Should have placeholder + unassigned projects only (proj-3, proj-4)
      expect(optionTexts).toContain('Select a project...');
      expect(optionTexts.some((t) => t?.includes('Rural Connect'))).toBe(true);
      expect(optionTexts.some((t) => t?.includes('City Backbone'))).toBe(true);
      // Should NOT have already assigned projects
      expect(optionTexts.some((t) => t?.includes('Fiber Network Alpha'))).toBe(false);
      expect(optionTexts.some((t) => t?.includes('Metro Expansion'))).toBe(false);
    });

    it('should show message when all projects are assigned', async () => {
      // All projects in mockProjects are assigned
      const allAssigned = mockProjects.map((p, idx) => ({
        id: `sp-${idx}`,
        staffId: 'staff-123',
        projectId: p.id,
        isActive: true,
        project: p,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }));
      setupFetchMock({ projects: allAssigned }, { projects: mockProjects });
      const user = userEvent.setup();

      render(<StaffProjectAssignment {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /assign to project/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /assign to project/i }));

      await waitFor(() => {
        expect(screen.getByText('All projects are already assigned')).toBeInTheDocument();
      });
    });

    it('should display role dropdown with all roles', async () => {
      setupFetchMock({ projects: [] }, { projects: mockProjects });
      const user = userEvent.setup();

      render(<StaffProjectAssignment {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /assign to project/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /assign to project/i }));

      await waitFor(() => {
        expect(screen.getByText('Role')).toBeInTheDocument();
      });

      const roleSelect = findSelectByLabel('Role');
      const options = within(roleSelect).getAllByRole('option');
      const optionTexts = options.map((opt) => opt.textContent);

      expect(optionTexts).toContain('Select a role...');
      expect(optionTexts).toContain('Project Manager');
      expect(optionTexts).toContain('Site Manager');
      expect(optionTexts).toContain('Team Lead');
      expect(optionTexts).toContain('Technician');
    });

    it('should display date inputs', async () => {
      setupFetchMock({ projects: [] }, { projects: mockProjects });
      const user = userEvent.setup();

      render(<StaffProjectAssignment {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /assign to project/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /assign to project/i }));

      await waitFor(() => {
        expect(screen.getByText('Start Date')).toBeInTheDocument();
        expect(screen.getByText('End Date')).toBeInTheDocument();
      });
    });

    it('should show project client in dropdown option', async () => {
      setupFetchMock({ projects: [] }, { projects: mockProjects });
      const user = userEvent.setup();

      render(<StaffProjectAssignment {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /assign to project/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /assign to project/i }));

      await waitFor(() => {
        expect(screen.getByText('Project *')).toBeInTheDocument();
      });

      const projectSelect = findSelectByLabel('Project');
      const options = within(projectSelect).getAllByRole('option');
      const optionTexts = options.map((opt) => opt.textContent);

      // Should show client in parentheses
      expect(optionTexts.some((t) => t?.includes('Rural Connect (County Gov)'))).toBe(true);
    });
  });

  describe('Form submission', () => {
    it('should submit form with selected values', async () => {
      // Track POST calls
      const fetchCalls: { url: string; options?: RequestInit }[] = [];
      global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
        fetchCalls.push({ url, options });
        if (url.includes('/api/staff/') && url.includes('/projects')) {
          if (options?.method === 'POST') {
            return Promise.resolve({
              ok: true,
              json: () =>
                Promise.resolve({
                  success: true,
                  assignment: { id: 'new-sp', projectId: 'proj-3' },
                }),
            });
          }
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ projects: [] }),
          });
        }
        if (url === '/api/projects') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ projects: mockProjects }),
          });
        }
        return Promise.reject(new Error('Unknown URL'));
      });

      const user = userEvent.setup();
      render(<StaffProjectAssignment {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /assign to project/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /assign to project/i }));

      await waitFor(() => {
        expect(screen.getByText('Project *')).toBeInTheDocument();
      });

      // Fill form using helper
      const projectSelect = findSelectByLabel('Project');
      const roleSelect = findSelectByLabel('Role');

      await user.selectOptions(projectSelect, 'proj-3');
      await user.selectOptions(roleSelect, 'Technician');

      // Find date inputs by their label
      const startDateLabel = screen.getByText('Start Date');
      const startDateInput = startDateLabel.closest('div')?.querySelector('input') as HTMLInputElement;
      fireEvent.change(startDateInput, { target: { value: '2024-03-01' } });

      const endDateLabel = screen.getByText('End Date');
      const endDateInput = endDateLabel.closest('div')?.querySelector('input') as HTMLInputElement;
      fireEvent.change(endDateInput, { target: { value: '2024-06-30' } });

      // Submit
      await user.click(screen.getByRole('button', { name: /^assign$/i }));

      await waitFor(() => {
        const postCall = fetchCalls.find(
          (c) => c.options?.method === 'POST' && c.url.includes('/projects')
        );
        expect(postCall).toBeDefined();
        const body = JSON.parse(postCall!.options!.body as string);
        expect(body.projectId).toBe('proj-3');
        expect(body.role).toBe('Technician');
        expect(body.startDate).toBe('2024-03-01');
        expect(body.endDate).toBe('2024-06-30');
      });
    });

    it('should show error when no project is selected', async () => {
      setupFetchMock({ projects: [] }, { projects: mockProjects });
      const user = userEvent.setup();

      render(<StaffProjectAssignment {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /assign to project/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /assign to project/i }));

      await waitFor(() => {
        expect(screen.getByText('Project *')).toBeInTheDocument();
      });

      // Submit without selecting project - button should be disabled
      const assignButton = screen.getByRole('button', { name: /^assign$/i });
      expect(assignButton).toBeDisabled();
    });

    it('should disable submit button while submitting', async () => {
      // Delay the POST response
      let resolvePost: (value: unknown) => void;
      global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
        if (url.includes('/api/staff/') && url.includes('/projects')) {
          if (options?.method === 'POST') {
            return new Promise((resolve) => {
              resolvePost = resolve;
            });
          }
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ projects: [] }),
          });
        }
        if (url === '/api/projects') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ projects: mockProjects }),
          });
        }
        return Promise.reject(new Error('Unknown URL'));
      });

      const user = userEvent.setup();
      render(<StaffProjectAssignment {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /assign to project/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /assign to project/i }));

      await waitFor(() => {
        expect(screen.getByText('Project *')).toBeInTheDocument();
      });

      const projectSelect = findSelectByLabel('Project');
      await user.selectOptions(projectSelect, 'proj-1');

      const assignButton = screen.getByRole('button', { name: /^assign$/i });
      await user.click(assignButton);

      await waitFor(() => {
        expect(screen.getByText('Assigning...')).toBeInTheDocument();
      });

      // Resolve the promise
      resolvePost!({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });
    });

    it('should close form and refresh after successful submission', async () => {
      let fetchCount = 0;
      global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
        if (url.includes('/api/staff/') && url.includes('/projects')) {
          if (options?.method === 'POST') {
            return Promise.resolve({
              ok: true,
              json: () => Promise.resolve({ success: true, assignment: { id: 'new' } }),
            });
          }
          fetchCount++;
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ projects: fetchCount > 1 ? mockAssignments : [] }),
          });
        }
        if (url === '/api/projects') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ projects: mockProjects }),
          });
        }
        return Promise.reject(new Error('Unknown URL'));
      });

      const user = userEvent.setup();
      render(<StaffProjectAssignment {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /assign to project/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /assign to project/i }));

      await waitFor(() => {
        expect(screen.getByText('Project *')).toBeInTheDocument();
      });

      const projectSelect = findSelectByLabel('Project');
      await user.selectOptions(projectSelect, 'proj-3');
      await user.click(screen.getByRole('button', { name: /^assign$/i }));

      await waitFor(() => {
        // Form should be closed
        expect(screen.queryByText(/Assign John Doe to Project/i)).not.toBeInTheDocument();
      });
    });

    it('should show error message on submission failure', async () => {
      global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
        if (url.includes('/api/staff/') && url.includes('/projects')) {
          if (options?.method === 'POST') {
            return Promise.resolve({
              ok: false,
              json: () => Promise.resolve({ error: 'Assignment failed' }),
            });
          }
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ projects: [] }),
          });
        }
        if (url === '/api/projects') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ projects: mockProjects }),
          });
        }
        return Promise.reject(new Error('Unknown URL'));
      });

      const user = userEvent.setup();
      render(<StaffProjectAssignment {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /assign to project/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /assign to project/i }));

      await waitFor(() => {
        expect(screen.getByText('Project *')).toBeInTheDocument();
      });

      const projectSelect = findSelectByLabel('Project');
      await user.selectOptions(projectSelect, 'proj-3');
      await user.click(screen.getByRole('button', { name: /^assign$/i }));

      await waitFor(() => {
        expect(screen.getByText('Assignment failed')).toBeInTheDocument();
      });
    });
  });

  describe('Remove assignment', () => {
    it('should show confirmation dialog when remove is clicked', async () => {
      setupFetchMock({ projects: mockAssignments }, { projects: mockProjects });
      const user = userEvent.setup();

      render(<StaffProjectAssignment {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Fiber Network Alpha')).toBeInTheDocument();
      });

      const removeButtons = screen.getAllByTitle('Remove from project');
      await user.click(removeButtons[0]);

      expect(mockConfirm).toHaveBeenCalledWith('Remove this staff member from the project?');
    });

    it('should not remove when confirmation is cancelled', async () => {
      mockConfirm.mockReturnValue(false);
      setupFetchMock({ projects: mockAssignments }, { projects: mockProjects });
      const user = userEvent.setup();

      render(<StaffProjectAssignment {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Fiber Network Alpha')).toBeInTheDocument();
      });

      const removeButtons = screen.getAllByTitle('Remove from project');
      await user.click(removeButtons[0]);

      // Project should still be visible
      expect(screen.getByText('Fiber Network Alpha')).toBeInTheDocument();
    });

    it('should call DELETE API when confirmed', async () => {
      const fetchCalls: { url: string; options?: RequestInit }[] = [];
      global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
        fetchCalls.push({ url, options });
        if (options?.method === 'DELETE') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ success: true }),
          });
        }
        if (url.includes('/api/staff/') && url.includes('/projects')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ projects: mockAssignments }),
          });
        }
        if (url === '/api/projects') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ projects: mockProjects }),
          });
        }
        return Promise.reject(new Error('Unknown URL'));
      });

      const user = userEvent.setup();
      render(<StaffProjectAssignment {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Fiber Network Alpha')).toBeInTheDocument();
      });

      const removeButtons = screen.getAllByTitle('Remove from project');
      await user.click(removeButtons[0]);

      await waitFor(() => {
        const deleteCall = fetchCalls.find((c) => c.options?.method === 'DELETE');
        expect(deleteCall).toBeDefined();
        expect(deleteCall!.url).toContain('/api/projects/proj-1/staff');
        expect(deleteCall!.url).toContain('staffId=staff-123');
      });
    });

    it('should update UI to hide removed assignment', async () => {
      global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
        if (options?.method === 'DELETE') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ success: true }),
          });
        }
        if (url.includes('/api/staff/') && url.includes('/projects')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ projects: mockAssignments }),
          });
        }
        if (url === '/api/projects') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ projects: mockProjects }),
          });
        }
        return Promise.reject(new Error('Unknown URL'));
      });

      const user = userEvent.setup();
      render(<StaffProjectAssignment {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Fiber Network Alpha')).toBeInTheDocument();
        expect(screen.getByText('2 active projects')).toBeInTheDocument();
      });

      const removeButtons = screen.getAllByTitle('Remove from project');
      await user.click(removeButtons[0]);

      await waitFor(() => {
        expect(screen.getByText('1 active project')).toBeInTheDocument();
      });
    });

    it('should show error on remove failure', async () => {
      global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
        if (options?.method === 'DELETE') {
          return Promise.resolve({
            ok: false,
            json: () => Promise.resolve({ error: 'Remove failed' }),
          });
        }
        if (url.includes('/api/staff/') && url.includes('/projects')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ projects: mockAssignments }),
          });
        }
        if (url === '/api/projects') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ projects: mockProjects }),
          });
        }
        return Promise.reject(new Error('Unknown URL'));
      });

      const user = userEvent.setup();
      render(<StaffProjectAssignment {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Fiber Network Alpha')).toBeInTheDocument();
      });

      const removeButtons = screen.getAllByTitle('Remove from project');
      await user.click(removeButtons[0]);

      await waitFor(() => {
        expect(screen.getByText('Remove failed')).toBeInTheDocument();
      });
    });

    it('should show loading state on remove button while removing', async () => {
      let resolveDelete: (value: unknown) => void;
      global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
        if (options?.method === 'DELETE') {
          return new Promise((resolve) => {
            resolveDelete = resolve;
          });
        }
        if (url.includes('/api/staff/') && url.includes('/projects')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ projects: mockAssignments }),
          });
        }
        if (url === '/api/projects') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ projects: mockProjects }),
          });
        }
        return Promise.reject(new Error('Unknown URL'));
      });

      const user = userEvent.setup();
      render(<StaffProjectAssignment {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Fiber Network Alpha')).toBeInTheDocument();
      });

      const removeButtons = screen.getAllByTitle('Remove from project');
      await user.click(removeButtons[0]);

      // Check for spinner in the first assignment's row
      await waitFor(() => {
        const firstAssignmentRow = screen.getByText('Fiber Network Alpha').closest('div[class*="p-4"]');
        expect(firstAssignmentRow?.querySelector('.animate-spin')).toBeInTheDocument();
      });

      // Cleanup
      resolveDelete!({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });
    });
  });

  describe('Error handling', () => {
    it('should display error when fetching assignments fails', async () => {
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/staff/') && url.includes('/projects')) {
          return Promise.resolve({
            ok: false,
            json: () => Promise.resolve({ error: 'Server error' }),
          });
        }
        if (url === '/api/projects') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ projects: mockProjects }),
          });
        }
        return Promise.reject(new Error('Unknown URL'));
      });

      render(<StaffProjectAssignment {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Failed to fetch assignments')).toBeInTheDocument();
      });
    });

    it('should handle network errors gracefully', async () => {
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/staff/') && url.includes('/projects')) {
          return Promise.reject(new Error('Network error'));
        }
        if (url === '/api/projects') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ projects: mockProjects }),
          });
        }
        return Promise.reject(new Error('Unknown URL'));
      });

      render(<StaffProjectAssignment {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });
    });
  });

  describe('Data fetching', () => {
    it('should fetch assignments for the correct staffId', async () => {
      const fetchCalls: string[] = [];
      global.fetch = vi.fn().mockImplementation((url: string) => {
        fetchCalls.push(url);
        if (url.includes('/api/staff/') && url.includes('/projects')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ projects: [] }),
          });
        }
        if (url === '/api/projects') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ projects: mockProjects }),
          });
        }
        return Promise.reject(new Error('Unknown URL'));
      });

      render(<StaffProjectAssignment staffId="custom-staff-id" staffName="Jane Doe" />);

      await waitFor(() => {
        expect(fetchCalls.some((url) => url.includes('/api/staff/custom-staff-id/projects'))).toBe(true);
      });
    });

    it('should handle both data and projects response formats', async () => {
      // Test with 'data' key instead of 'projects'
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/staff/') && url.includes('/projects')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ projects: [] }), // No assignments so all projects are available
          });
        }
        if (url === '/api/projects') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ data: mockProjects }), // Using 'data' key
          });
        }
        return Promise.reject(new Error('Unknown URL'));
      });

      const user = userEvent.setup();
      render(<StaffProjectAssignment {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /assign to project/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /assign to project/i }));

      await waitFor(() => {
        expect(screen.getByText('Project *')).toBeInTheDocument();
      });

      // Should still show unassigned projects using the helper function
      const projectSelect = findSelectByLabel('Project');
      const options = within(projectSelect).getAllByRole('option');
      expect(options.length).toBeGreaterThan(1);
    });
  });
});
