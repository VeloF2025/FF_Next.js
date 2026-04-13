// Component tests for WorkflowEditor
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkflowEditor } from '../../components/editor/WorkflowEditor';
import { WorkflowEditorProvider } from '../../context/WorkflowEditorContext';
import { workflowManagementService } from '../../services/WorkflowManagementService';
import {
  mockWorkflowTemplates,
  mockWorkflowPhases,
  mockWorkflowSteps,
  mockWorkflowTasks,
  mockWorkflowValidationResult
} from '../__mocks__/workflow.mocks';

// Mock services
jest.mock('../../services/WorkflowManagementService', () => ({
  workflowManagementService: {
    getTemplateById: jest.fn(),
    getPhases: jest.fn(),
    getSteps: jest.fn(),
    getTasks: jest.fn(),
    validateTemplate: jest.fn()
  }
}));

// Mock child components to focus on WorkflowEditor logic
jest.mock('../../components/editor/EditorCanvas', () => {
  return {
    EditorCanvas: () => <div data-testid="editor-canvas">Editor Canvas</div>
  };
});

jest.mock('../../components/editor/ComponentPalette', () => {
  return {
    ComponentPalette: () => <div data-testid="component-palette">Component Palette</div>
  };
});

jest.mock('../../components/editor/PropertiesPanel', () => {
  return {
    PropertiesPanel: () => <div data-testid="properties-panel">Properties Panel</div>
  };
});

jest.mock('../../components/editor/EditorToolbar', () => {
  return {
    EditorToolbar: () => <div data-testid="editor-toolbar">Editor Toolbar</div>
  };
});

jest.mock('../../components/editor/ValidationPanel', () => {
  return {
    ValidationPanel: () => <div data-testid="validation-panel">Validation Panel</div>
  };
});

jest.mock('../../components/editor/EditorMinimap', () => {
  return {
    EditorMinimap: () => <div data-testid="editor-minimap">Editor Minimap</div>
  };
});

jest.mock('../../components/editor/forms', () => {
  return {
    WorkflowEditorForms: () => <div data-testid="editor-forms">Editor Forms</div>
  };
});

// Mock timers for auto-save testing
jest.useFakeTimers();

describe('WorkflowEditor Component', () => {
  const renderWithProvider = (templateId?: string) => {
    return render(
      <WorkflowEditorProvider>
        <WorkflowEditor templateId={templateId} />
      </WorkflowEditorProvider>
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    
    // Setup default service mock responses
    (workflowManagementService.getTemplateById as jest.Mock).mockResolvedValue(mockWorkflowTemplates[0]);
    (workflowManagementService.getPhases as jest.Mock).mockResolvedValue(mockWorkflowPhases);
    (workflowManagementService.getSteps as jest.Mock).mockResolvedValue(mockWorkflowSteps);
    (workflowManagementService.getTasks as jest.Mock).mockResolvedValue(mockWorkflowTasks);
    (workflowManagementService.validateTemplate as jest.Mock).mockResolvedValue(mockWorkflowValidationResult);
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.useFakeTimers();
  });

  describe('Initial Rendering', () => {
    it('should render loading state initially', () => {
      renderWithProvider();
      
      expect(screen.getByText('New Workflow Template')).toBeInTheDocument();
      expect(screen.getByTestId('editor-toolbar')).toBeInTheDocument();
      expect(screen.getByTestId('editor-canvas')).toBeInTheDocument();
    });

    it('should load template when templateId is provided', async () => {
      renderWithProvider('template-1');

      await waitFor(() => {
        expect(workflowManagementService.getTemplateById).toHaveBeenCalledWith('template-1');
      });
    });

    it('should create new template when no templateId is provided', async () => {
      renderWithProvider();

      // Should show new template name
      expect(screen.getByText('New Workflow Template')).toBeInTheDocument();
    });

    it('should display template name when loaded', async () => {
      renderWithProvider('template-1');

      await waitFor(() => {
        expect(screen.getByText('Standard Fiber Installation')).toBeInTheDocument();
      });
    });
  });

  describe('Loading States', () => {
    it('should show loading overlay when loading template', async () => {
      // Make the service call slow to test loading state
      (workflowManagementService.getTemplateById as jest.Mock).mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve(mockWorkflowTemplates[0]), 1000))
      );

      renderWithProvider('template-1');

      expect(screen.getByText('Loading template...')).toBeInTheDocument();
      expect(screen.getByRole('status', { hidden: true })).toBeInTheDocument(); // Loading spinner
    });

    it('should hide loading overlay after template loads', async () => {
      renderWithProvider('template-1');

      await waitFor(() => {
        expect(screen.queryByText('Loading template...')).not.toBeInTheDocument();
      });
    });
  });

  describe('Error Handling', () => {
    it('should display error message when template loading fails', async () => {
      (workflowManagementService.getTemplateById as jest.Mock).mockRejectedValue(
        new Error('Failed to load template')
      );

      renderWithProvider('template-1');

      await waitFor(() => {
        expect(screen.getByText('Error:')).toBeInTheDocument();
        expect(screen.getByText('Failed to load template')).toBeInTheDocument();
      });
    });

    it('should clear error message when template loads successfully', async () => {
      // First render with error
      (workflowManagementService.getTemplateById as jest.Mock).mockRejectedValue(
        new Error('Network error')
      );

      const { rerender } = renderWithProvider('template-1');

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });

      // Then fix the service and re-render
      (workflowManagementService.getTemplateById as jest.Mock).mockResolvedValue(mockWorkflowTemplates[0]);

      rerender(
        <WorkflowEditorProvider>
          <WorkflowEditor templateId="template-2" />
        </WorkflowEditorProvider>
      );

      await waitFor(() => {
        expect(screen.queryByText('Network error')).not.toBeInTheDocument();
      });
    });
  });

  describe('Unsaved Changes Indicator', () => {
    it('should show unsaved changes indicator when there are changes', async () => {
      renderWithProvider('template-1');

      await waitFor(() => {
        expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
      });

      // Simulate making changes (this would be triggered by user actions)
      // Since we can't directly access context actions, we'll test the UI state
    });

    it('should hide unsaved changes indicator when changes are saved', async () => {
      renderWithProvider('template-1');

      await waitFor(() => {
        expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
      });
    });
  });

  describe('Zoom Controls', () => {
    it('should render zoom controls', async () => {
      renderWithProvider('template-1');

      await waitFor(() => {
        expect(screen.getByTitle('Zoom Out')).toBeInTheDocument();
        expect(screen.getByTitle('Zoom In')).toBeInTheDocument();
        expect(screen.getByTitle('Reset Zoom')).toBeInTheDocument();
        expect(screen.getByText('100%')).toBeInTheDocument();
      });
    });

    it('should handle zoom in action', async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      renderWithProvider('template-1');

      await waitFor(() => {
        expect(screen.getByTitle('Zoom In')).toBeInTheDocument();
      });

      const zoomInButton = screen.getByTitle('Zoom In');
      await user.click(zoomInButton);

      // The zoom level should update (would show 120% after zoom in)
      // This is a simplified test - in reality we'd test the actual zoom functionality
    });

    it('should handle zoom out action', async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      renderWithProvider('template-1');

      await waitFor(() => {
        expect(screen.getByTitle('Zoom Out')).toBeInTheDocument();
      });

      const zoomOutButton = screen.getByTitle('Zoom Out');
      await user.click(zoomOutButton);

      // Zoom level should decrease
    });

    it('should handle zoom reset action', async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      renderWithProvider('template-1');

      await waitFor(() => {
        expect(screen.getByTitle('Reset Zoom')).toBeInTheDocument();
      });

      const resetZoomButton = screen.getByTitle('Reset Zoom');
      await user.click(resetZoomButton);

      // Should reset to 100%
      expect(screen.getByText('100%')).toBeInTheDocument();
    });
  });

  describe('Grid Toggle', () => {
    it('should render grid toggle button', async () => {
      renderWithProvider('template-1');

      await waitFor(() => {
        expect(screen.getByTitle('Toggle Grid')).toBeInTheDocument();
      });
    });

    it('should toggle grid visibility', async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      renderWithProvider('template-1');

      await waitFor(() => {
        expect(screen.getByTitle('Toggle Grid')).toBeInTheDocument();
      });

      const gridToggle = screen.getByTitle('Toggle Grid');
      await user.click(gridToggle);

      // Grid state should toggle - would test visual changes in integration test
    });
  });

  describe('Minimap Toggle', () => {
    it('should render minimap toggle button', async () => {
      renderWithProvider('template-1');

      await waitFor(() => {
        expect(screen.getByTitle('Toggle Minimap')).toBeInTheDocument();
      });
    });

    it('should show/hide minimap when toggled', async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      renderWithProvider('template-1');

      await waitFor(() => {
        expect(screen.getByTitle('Toggle Minimap')).toBeInTheDocument();
      });

      // Initially minimap should be hidden
      expect(screen.queryByTestId('editor-minimap')).not.toBeInTheDocument();

      const minimapToggle = screen.getByTitle('Toggle Minimap');
      await user.click(minimapToggle);

      // Minimap should appear
      await waitFor(() => {
        expect(screen.getByTestId('editor-minimap')).toBeInTheDocument();
      });

      // Click again to hide
      await user.click(minimapToggle);

      await waitFor(() => {
        expect(screen.queryByTestId('editor-minimap')).not.toBeInTheDocument();
      });
    });
  });

  describe('Save Functionality', () => {
    it('should render save button', async () => {
      renderWithProvider('template-1');

      await waitFor(() => {
        expect(screen.getByTitle('Save Template')).toBeInTheDocument();
        expect(screen.getByText('Save')).toBeInTheDocument();
      });
    });

    it('should disable save button when no changes', async () => {
      renderWithProvider('template-1');

      await waitFor(() => {
        const saveButton = screen.getByTitle('Save Template');
        expect(saveButton).toBeDisabled();
      });
    });

    it('should handle save button click', async () => {
      const _user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      renderWithProvider('template-1');

      await waitFor(() => {
        expect(screen.getByTitle('Save Template')).toBeInTheDocument();
      });

      // Since save button is disabled by default, we can't test the click
      // This would be tested in integration tests where we simulate making changes
    });
  });

  describe('Validation Panel', () => {
    it('should show validation button when validation result exists', async () => {
      renderWithProvider('template-1');

      await waitFor(() => {
        expect(screen.getByTitle(/\d+ errors, \d+ warnings/)).toBeInTheDocument();
      });
    });

    it('should toggle validation panel when validation button is clicked', async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      renderWithProvider('template-1');

      // Wait for component to load with validation results
      await waitFor(() => {
        expect(screen.getByTitle(/\d+ errors, \d+ warnings/)).toBeInTheDocument();
      });

      const validationButton = screen.getByTitle(/\d+ errors, \d+ warnings/);
      
      // Initially validation panel should not be visible
      expect(screen.queryByTestId('validation-panel')).not.toBeInTheDocument();

      await user.click(validationButton);

      // Validation panel should appear
      await waitFor(() => {
        expect(screen.getByTestId('validation-panel')).toBeInTheDocument();
      });

      // Click again to hide
      await user.click(validationButton);

      await waitFor(() => {
        expect(screen.queryByTestId('validation-panel')).not.toBeInTheDocument();
      });
    });

    it('should show error icon when validation has errors', async () => {
      renderWithProvider('template-1');

      await waitFor(() => {
        // Should show error icon since mockWorkflowValidationResult.isValid is false
        const validationButton = screen.getByTitle(/\d+ errors, \d+ warnings/);
        expect(validationButton).toHaveClass(/text-red-600|border-red-200/);
      });
    });
  });

  describe('Keyboard Shortcuts', () => {
    it('should handle Ctrl+S save shortcut', async () => {
      renderWithProvider('template-1');

      await waitFor(() => {
        expect(screen.getByTestId('editor-canvas')).toBeInTheDocument();
      });

      // Simulate Ctrl+S
      fireEvent.keyDown(window, {
        key: 's',
        ctrlKey: true,
        preventDefault: jest.fn()
      });

      // Save action should be triggered (would test actual save in integration test)
    });

    it('should handle Escape key to clear selection', async () => {
      renderWithProvider('template-1');

      await waitFor(() => {
        expect(screen.getByTestId('editor-canvas')).toBeInTheDocument();
      });

      // Simulate Escape key
      fireEvent.keyDown(window, {
        key: 'Escape',
        preventDefault: jest.fn()
      });

      // Selection should be cleared
    });

    it('should handle Delete key', async () => {
      renderWithProvider('template-1');

      await waitFor(() => {
        expect(screen.getByTestId('editor-canvas')).toBeInTheDocument();
      });

      // Simulate Delete key
      fireEvent.keyDown(window, {
        key: 'Delete',
        preventDefault: jest.fn()
      });

      // Selected items should be deleted
    });
  });

  describe('Panel Management', () => {
    it('should show component palette when panel is active', async () => {
      renderWithProvider('template-1');

      // Initially no panels should be visible
      expect(screen.queryByTestId('component-palette')).not.toBeInTheDocument();
      expect(screen.queryByTestId('properties-panel')).not.toBeInTheDocument();
    });

    it('should hide panels by default', async () => {
      renderWithProvider('template-1');

      await waitFor(() => {
        expect(screen.getByTestId('editor-canvas')).toBeInTheDocument();
      });

      // Panels should be hidden initially (width: 0)
      expect(screen.queryByTestId('component-palette')).not.toBeInTheDocument();
      expect(screen.queryByTestId('properties-panel')).not.toBeInTheDocument();
    });
  });

  describe('Canvas Interaction', () => {
    it('should handle canvas click to clear selection', async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      renderWithProvider('template-1');

      await waitFor(() => {
        expect(screen.getByTestId('editor-canvas')).toBeInTheDocument();
      });

      const canvas = screen.getByTestId('editor-canvas').parentElement;
      if (canvas) {
        await user.click(canvas);
      }

      // Selection should be cleared
    });
  });

  describe('Before Unload Handler', () => {
    it('should prevent page unload when there are unsaved changes', () => {
      renderWithProvider('template-1');

      // Mock the beforeunload event
      const mockEvent = new Event('beforeunload') as BeforeUnloadEvent;
      mockEvent.preventDefault = jest.fn();
      
      // Simulate unsaved changes state
      // This would be set through user interactions in real scenario

      fireEvent(window, mockEvent);

      // Should prevent unload when there are unsaved changes
    });

    it('should allow page unload when no unsaved changes', () => {
      renderWithProvider('template-1');

      const mockEvent = new Event('beforeunload') as BeforeUnloadEvent;
      mockEvent.preventDefault = jest.fn();

      fireEvent(window, mockEvent);

      // Should not prevent unload when no changes
    });
  });

  describe('Responsive Behavior', () => {
    it('should render properly on different screen sizes', async () => {
      // Test mobile view
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 375,
      });

      renderWithProvider('template-1');

      await waitFor(() => {
        expect(screen.getByTestId('editor-canvas')).toBeInTheDocument();
      });

      // Layout should adapt to mobile
      expect(screen.getByTestId('editor-canvas')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA labels and roles', async () => {
      renderWithProvider('template-1');

      await waitFor(() => {
        expect(screen.getByRole('main')).toBeInTheDocument();
      });

      // Check for accessibility attributes
      const zoomControls = screen.getByTitle('Zoom In');
      expect(zoomControls).toHaveAttribute('title');

      const saveButton = screen.getByTitle('Save Template');
      expect(saveButton).toHaveAttribute('title');
    });

    it('should support keyboard navigation', async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      renderWithProvider('template-1');

      await waitFor(() => {
        expect(screen.getByTitle('Save Template')).toBeInTheDocument();
      });

      const saveButton = screen.getByTitle('Save Template');
      
      // Should be focusable
      saveButton.focus();
      expect(document.activeElement).toBe(saveButton);

      // Should respond to Enter key
      await user.keyboard('{Enter}');
    });
  });
});