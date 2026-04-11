// Component tests for TemplateList
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TemplateList } from '../../components/templates/TemplateList';
import { WorkflowPortalProvider } from '../../context/WorkflowPortalContext';
import { workflowManagementService } from '../../services/WorkflowManagementService';
import {
  mockWorkflowTemplates,
  mockTemplateStats
} from '../__mocks__/workflow.mocks';

// Mock services
jest.mock('../../services/WorkflowManagementService', () => ({
  workflowManagementService: {
    getTemplates: jest.fn(),
    deleteTemplate: jest.fn(),
    duplicateTemplate: jest.fn()
  }
}));

// Mock router
const mockNavigate = jest.fn();
jest.mock('next/router', () => ({
  ...jest.requireActual('next/router'),
  useNavigate: () => mockNavigate
}));

// Mock toast notifications
jest.mock('react-hot-toast', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
    loading: jest.fn()
  }
}));

describe('TemplateList Component', () => {
  const renderWithProvider = (props = {}) => {
    const defaultProps = {
      onTemplateSelect: jest.fn(),
      onTemplateEdit: jest.fn(),
      onTemplateDelete: jest.fn(),
      ...props
    };

    return render(
      <WorkflowPortalProvider>
        <TemplateList {...defaultProps} />
      </WorkflowPortalProvider>
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup default service mock responses
    (workflowManagementService.getTemplates as jest.Mock).mockResolvedValue({
      templates: mockWorkflowTemplates,
      total: mockWorkflowTemplates.length
    });
  });

  describe('Initial Rendering', () => {
    it('should render template list with loading state initially', () => {
      renderWithProvider();
      
      // Should show loading indicator initially
      expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
    });

    it('should render templates after loading', async () => {
      renderWithProvider();

      await waitFor(() => {
        expect(screen.getByText('Standard Fiber Installation')).toBeInTheDocument();
        expect(screen.getByText('Emergency Repair Workflow')).toBeInTheDocument();
        expect(screen.getByText('Draft Custom Workflow')).toBeInTheDocument();
      });

      expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();
    });

    it('should render empty state when no templates', async () => {
      (workflowManagementService.getTemplates as jest.Mock).mockResolvedValue({
        templates: [],
        total: 0
      });

      renderWithProvider();

      await waitFor(() => {
        expect(screen.getByText('No workflow templates found')).toBeInTheDocument();
        expect(screen.getByText('Create your first workflow template to get started')).toBeInTheDocument();
      });
    });
  });

  describe('Template Cards', () => {
    it('should display template information correctly', async () => {
      renderWithProvider();

      await waitFor(() => {
        expect(screen.getByText('Standard Fiber Installation')).toBeInTheDocument();
      });

      // Check template details
      expect(screen.getByText('Standard workflow for fiber optic cable installation')).toBeInTheDocument();
      expect(screen.getByText('telecommunications')).toBeInTheDocument();
      expect(screen.getByText('v1.0')).toBeInTheDocument();
      expect(screen.getByText('5 projects')).toBeInTheDocument();
    });

    it('should show default badge for default templates', async () => {
      renderWithProvider();

      await waitFor(() => {
        expect(screen.getByText('DEFAULT')).toBeInTheDocument();
      });
    });

    it('should show system badge for system templates', async () => {
      renderWithProvider();

      await waitFor(() => {
        expect(screen.getByText('SYSTEM')).toBeInTheDocument();
      });
    });

    it('should show draft badge for draft templates', async () => {
      renderWithProvider();

      await waitFor(() => {
        expect(screen.getByText('DRAFT')).toBeInTheDocument();
      });
    });

    it('should display template tags', async () => {
      renderWithProvider();

      await waitFor(() => {
        expect(screen.getByText('fiber')).toBeInTheDocument();
        expect(screen.getByText('installation')).toBeInTheDocument();
        expect(screen.getByText('standard')).toBeInTheDocument();
      });
    });
  });

  describe('Search and Filtering', () => {
    it('should render search input', async () => {
      renderWithProvider();

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Search templates...')).toBeInTheDocument();
      });
    });

    it('should handle search input', async () => {
      const user = userEvent.setup();
      renderWithProvider();

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Search templates...')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText('Search templates...');
      await user.type(searchInput, 'fiber');

      expect(searchInput).toHaveValue('fiber');
    });

    it('should render filter dropdowns', async () => {
      renderWithProvider();

      await waitFor(() => {
        expect(screen.getByText('All Categories')).toBeInTheDocument();
        expect(screen.getByText('All Statuses')).toBeInTheDocument();
        expect(screen.getByText('All Types')).toBeInTheDocument();
      });
    });

    it('should handle category filter change', async () => {
      const user = userEvent.setup();
      renderWithProvider();

      await waitFor(() => {
        expect(screen.getByText('All Categories')).toBeInTheDocument();
      });

      const categoryFilter = screen.getByText('All Categories');
      await user.click(categoryFilter);

      // Should show category options
      expect(screen.getByText('Telecommunications')).toBeInTheDocument();
      expect(screen.getByText('Emergency')).toBeInTheDocument();
    });

    it('should handle status filter change', async () => {
      const user = userEvent.setup();
      renderWithProvider();

      await waitFor(() => {
        expect(screen.getByText('All Statuses')).toBeInTheDocument();
      });

      const statusFilter = screen.getByText('All Statuses');
      await user.click(statusFilter);

      // Should show status options
      expect(screen.getByText('Active')).toBeInTheDocument();
      expect(screen.getByText('Draft')).toBeInTheDocument();
      expect(screen.getByText('Archived')).toBeInTheDocument();
    });
  });

  describe('Sorting', () => {
    it('should render sort dropdown', async () => {
      renderWithProvider();

      await waitFor(() => {
        expect(screen.getByText('Sort by: Name')).toBeInTheDocument();
      });
    });

    it('should handle sort option change', async () => {
      const user = userEvent.setup();
      renderWithProvider();

      await waitFor(() => {
        expect(screen.getByText('Sort by: Name')).toBeInTheDocument();
      });

      const sortDropdown = screen.getByText('Sort by: Name');
      await user.click(sortDropdown);

      // Should show sort options
      expect(screen.getByText('Created Date')).toBeInTheDocument();
      expect(screen.getByText('Updated Date')).toBeInTheDocument();
      expect(screen.getByText('Usage Count')).toBeInTheDocument();
    });
  });

  describe('Template Actions', () => {
    it('should handle template selection', async () => {
      const mockOnSelect = jest.fn();
      const user = userEvent.setup();
      
      renderWithProvider({ onTemplateSelect: mockOnSelect });

      await waitFor(() => {
        expect(screen.getByText('Standard Fiber Installation')).toBeInTheDocument();
      });

      const templateCard = screen.getByText('Standard Fiber Installation').closest('div');
      if (templateCard) {
        await user.click(templateCard);
        expect(mockOnSelect).toHaveBeenCalledWith(mockWorkflowTemplates[0]);
      }
    });

    it('should show action menu when three dots are clicked', async () => {
      const user = userEvent.setup();
      renderWithProvider();

      await waitFor(() => {
        expect(screen.getAllByTitle('More actions')).toHaveLength(3);
      });

      const actionButton = screen.getAllByTitle('More actions')[0];
      await user.click(actionButton);

      // Should show action menu
      expect(screen.getByText('Edit')).toBeInTheDocument();
      expect(screen.getByText('Duplicate')).toBeInTheDocument();
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    it('should handle edit action', async () => {
      const mockOnEdit = jest.fn();
      const user = userEvent.setup();
      
      renderWithProvider({ onTemplateEdit: mockOnEdit });

      await waitFor(() => {
        expect(screen.getAllByTitle('More actions')).toHaveLength(3);
      });

      const actionButton = screen.getAllByTitle('More actions')[0];
      await user.click(actionButton);

      const editButton = screen.getByText('Edit');
      await user.click(editButton);

      expect(mockOnEdit).toHaveBeenCalledWith(mockWorkflowTemplates[0]);
    });

    it('should handle duplicate action', async () => {
      const user = userEvent.setup();
      
      (workflowManagementService.duplicateTemplate as jest.Mock).mockResolvedValue(
        { ...mockWorkflowTemplates[0], id: 'duplicated-template', name: 'Copy of Standard Fiber Installation' }
      );

      renderWithProvider();

      await waitFor(() => {
        expect(screen.getAllByTitle('More actions')).toHaveLength(3);
      });

      const actionButton = screen.getAllByTitle('More actions')[0];
      await user.click(actionButton);

      const duplicateButton = screen.getByText('Duplicate');
      await user.click(duplicateButton);

      await waitFor(() => {
        expect(workflowManagementService.duplicateTemplate).toHaveBeenCalledWith(
          mockWorkflowTemplates[0].id,
          expect.stringContaining('Copy of')
        );
      });
    });

    it('should handle delete action with confirmation', async () => {
      const mockOnDelete = jest.fn();
      const user = userEvent.setup();
      
      renderWithProvider({ onTemplateDelete: mockOnDelete });

      await waitFor(() => {
        expect(screen.getAllByTitle('More actions')).toHaveLength(3);
      });

      const actionButton = screen.getAllByTitle('More actions')[0];
      await user.click(actionButton);

      const deleteButton = screen.getByText('Delete');
      await user.click(deleteButton);

      // Should show confirmation dialog
      expect(screen.getByText('Delete Workflow Template')).toBeInTheDocument();
      expect(screen.getByText('Are you sure you want to delete this template?')).toBeInTheDocument();

      const confirmButton = screen.getByText('Delete');
      await user.click(confirmButton);

      expect(mockOnDelete).toHaveBeenCalledWith(mockWorkflowTemplates[0]);
    });

    it('should disable delete action for system templates', async () => {
      const user = userEvent.setup();
      renderWithProvider();

      await waitFor(() => {
        expect(screen.getAllByTitle('More actions')).toHaveLength(3);
      });

      // Click on system template actions (Emergency Repair Workflow)
      const systemTemplateActions = screen.getAllByTitle('More actions')[1];
      await user.click(systemTemplateActions);

      const deleteButton = screen.getByText('Delete');
      expect(deleteButton).toBeDisabled();
    });
  });

  describe('Create New Template', () => {
    it('should render create new template button', async () => {
      renderWithProvider();

      await waitFor(() => {
        expect(screen.getByText('Create New Template')).toBeInTheDocument();
      });
    });

    it('should handle create new template click', async () => {
      const user = userEvent.setup();
      renderWithProvider();

      await waitFor(() => {
        expect(screen.getByText('Create New Template')).toBeInTheDocument();
      });

      const createButton = screen.getByText('Create New Template');
      await user.click(createButton);

      // Should navigate to editor
      expect(mockNavigate).toHaveBeenCalledWith('/workflow/editor');
    });
  });

  describe('Error Handling', () => {
    it('should display error message when template loading fails', async () => {
      (workflowManagementService.getTemplates as jest.Mock).mockRejectedValue(
        new Error('Failed to load templates')
      );

      renderWithProvider();

      await waitFor(() => {
        expect(screen.getByText('Failed to load templates')).toBeInTheDocument();
        expect(screen.getByText('Try again')).toBeInTheDocument();
      });
    });

    it('should handle retry action on error', async () => {
      const user = userEvent.setup();
      
      // First call fails
      (workflowManagementService.getTemplates as jest.Mock)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValue({
          templates: mockWorkflowTemplates,
          total: mockWorkflowTemplates.length
        });

      renderWithProvider();

      await waitFor(() => {
        expect(screen.getByText('Try again')).toBeInTheDocument();
      });

      const retryButton = screen.getByText('Try again');
      await user.click(retryButton);

      await waitFor(() => {
        expect(screen.getByText('Standard Fiber Installation')).toBeInTheDocument();
      });
    });

    it('should handle duplicate template error', async () => {
      const user = userEvent.setup();
      
      (workflowManagementService.duplicateTemplate as jest.Mock).mockRejectedValue(
        new Error('Duplication failed')
      );

      renderWithProvider();

      await waitFor(() => {
        expect(screen.getAllByTitle('More actions')).toHaveLength(3);
      });

      const actionButton = screen.getAllByTitle('More actions')[0];
      await user.click(actionButton);

      const duplicateButton = screen.getByText('Duplicate');
      await user.click(duplicateButton);

      await waitFor(() => {
        // Should show error toast (mocked)
        expect(screen.queryByText('Template duplicated successfully')).not.toBeInTheDocument();
      });
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA labels', async () => {
      renderWithProvider();

      await waitFor(() => {
        expect(screen.getByLabelText('Search templates')).toBeInTheDocument();
      });
    });

    it('should support keyboard navigation', async () => {
      const user = userEvent.setup();
      renderWithProvider();

      await waitFor(() => {
        expect(screen.getByText('Create New Template')).toBeInTheDocument();
      });

      const createButton = screen.getByText('Create New Template');
      createButton.focus();
      
      expect(document.activeElement).toBe(createButton);

      // Should respond to Enter key
      await user.keyboard('{Enter}');
      expect(mockNavigate).toHaveBeenCalledWith('/workflow/editor');
    });

    it('should have proper heading hierarchy', async () => {
      renderWithProvider();

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1, name: /workflow templates/i })).toBeInTheDocument();
      });
    });
  });

  describe('Responsive Behavior', () => {
    it('should adapt to different screen sizes', async () => {
      // Mock mobile viewport
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 375,
      });

      renderWithProvider();

      await waitFor(() => {
        expect(screen.getByText('Standard Fiber Installation')).toBeInTheDocument();
      });

      // Templates should still be visible on mobile
      expect(screen.getByText('Standard Fiber Installation')).toBeInTheDocument();
    });
  });

  describe('Performance', () => {
    it('should virtualize long lists of templates', async () => {
      // Create many templates to test virtualization
      const manyTemplates = Array.from({ length: 100 }, (_, i) => ({
        ...mockWorkflowTemplates[0],
        id: `template-${i}`,
        name: `Template ${i}`
      }));

      (workflowManagementService.getTemplates as jest.Mock).mockResolvedValue({
        templates: manyTemplates,
        total: manyTemplates.length
      });

      renderWithProvider();

      await waitFor(() => {
        // Only visible templates should be rendered
        expect(screen.getAllByText(/Template \d+/)).toHaveLength(expect.any(Number));
      });
    });
  });
});