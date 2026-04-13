// Accessibility tests for workflow system components
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe, toHaveNoViolations } from 'jest-axe';
import { WorkflowEditor } from '../../components/editor/WorkflowEditor';
import { TemplateList } from '../../components/templates/TemplateList';
import { ProjectWorkflowList } from '../../components/projects/ProjectWorkflowList';
import { WorkflowEditorProvider } from '../../context/WorkflowEditorContext';
import { WorkflowPortalProvider } from '../../context/WorkflowPortalContext';
import { workflowManagementService } from '../../services/WorkflowManagementService';
import {
  mockWorkflowTemplates,
  mockProjectWorkflows
} from '../__mocks__/workflow.mocks';

// Extend Jest matchers
expect.extend(toHaveNoViolations);

// Mock services
jest.mock('../../services/WorkflowManagementService', () => ({
  workflowManagementService: {
    getTemplates: jest.fn(),
    getTemplateById: jest.fn(),
    getPhases: jest.fn(),
    getSteps: jest.fn(),
    getTasks: jest.fn()
  }
}));

// Mock child components to focus on accessibility testing
jest.mock('../../components/editor/EditorCanvas', () => {
  return {
    EditorCanvas: () => (
      <div 
        data-testid="editor-canvas" 
        role="main" 
        aria-label="Workflow editor canvas"
        tabIndex={0}
      >
        <div role="group" aria-label="Workflow nodes">
          <button 
            data-testid="workflow-node" 
            aria-label="Phase node: Planning"
            aria-describedby="node-description-1"
          >
            Planning Phase
          </button>
          <div id="node-description-1" className="sr-only">
            Phase 1 of 3: Planning and preparation tasks
          </div>
        </div>
      </div>
    )
  };
});

jest.mock('../../components/editor/ComponentPalette', () => {
  return {
    ComponentPalette: () => (
      <nav data-testid="component-palette" aria-label="Component palette">
        <h2>Components</h2>
        <ul role="list">
          <li>
            <button 
              data-testid="palette-phase"
              aria-label="Add phase component"
              aria-describedby="phase-help"
            >
              Phase
            </button>
            <div id="phase-help" className="sr-only">
              Drag to canvas or press Enter to add a new phase
            </div>
          </li>
          <li>
            <button 
              data-testid="palette-step"
              aria-label="Add step component"
              aria-describedby="step-help"
            >
              Step
            </button>
            <div id="step-help" className="sr-only">
              Drag to canvas or press Enter to add a new step
            </div>
          </li>
        </ul>
      </nav>
    )
  };
});

describe('Workflow System Accessibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup default service responses
    (workflowManagementService.getTemplates as jest.Mock).mockResolvedValue({
      templates: mockWorkflowTemplates,
      total: mockWorkflowTemplates.length
    });
    
    (workflowManagementService.getTemplateById as jest.Mock).mockResolvedValue(mockWorkflowTemplates[0]);
    (workflowManagementService.getPhases as jest.Mock).mockResolvedValue([]);
    (workflowManagementService.getSteps as jest.Mock).mockResolvedValue([]);
    (workflowManagementService.getTasks as jest.Mock).mockResolvedValue([]);
  });

  describe('WorkflowEditor Accessibility', () => {
    const renderWorkflowEditor = () => {
      return render(
        <WorkflowEditorProvider>
          <WorkflowEditor templateId="template-1" />
        </WorkflowEditorProvider>
      );
    };

    test('should have no accessibility violations', async () => {
      const { container } = renderWorkflowEditor();
      
      // Wait for component to fully render
      await screen.findByRole('main');
      
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    test('should have proper heading hierarchy', async () => {
      renderWorkflowEditor();
      
      await screen.findByRole('main');
      
      // Check for proper heading structure
      const mainHeading = screen.getByRole('heading', { level: 1 });
      expect(mainHeading).toBeInTheDocument();
      expect(mainHeading).toHaveTextContent(/workflow template/i);
      
      // Check for section headings
      const sectionHeadings = screen.getAllByRole('heading', { level: 2 });
      expect(sectionHeadings.length).toBeGreaterThan(0);
    });

    test('should have proper ARIA labels and roles', async () => {
      renderWorkflowEditor();
      
      await screen.findByRole('main');
      
      // Check main content area
      const mainContent = screen.getByRole('main');
      expect(mainContent).toHaveAttribute('aria-label', expect.stringContaining('editor'));
      
      // Check toolbar has proper role
      const toolbar = screen.getByRole('toolbar', { name: /editor controls/i });
      expect(toolbar).toBeInTheDocument();
      
      // Check buttons have proper labels
      const saveButton = screen.getByRole('button', { name: /save template/i });
      expect(saveButton).toBeInTheDocument();
      
      const zoomInButton = screen.getByRole('button', { name: /zoom in/i });
      expect(zoomInButton).toBeInTheDocument();
    });

    test('should support keyboard navigation', async () => {
      const user = userEvent.setup();
      renderWorkflowEditor();
      
      await screen.findByRole('main');
      
      // Tab through controls
      await user.tab();
      expect(document.activeElement).toHaveAttribute('role', 'button');
      
      // Check that all interactive elements are reachable
      const interactiveElements = screen.getAllByRole('button');
      
      for (const _element of interactiveElements.slice(0, 5)) { // Test first 5
        await user.tab();
        // Should be able to reach each element
      }
    });

    test('should have proper focus management', async () => {
      const _user = userEvent.setup();
      renderWorkflowEditor();
      
      await screen.findByRole('main');
      
      // Focus should start on a logical element
      const firstFocusable = screen.getAllByRole('button')[0];
      firstFocusable.focus();
      expect(document.activeElement).toBe(firstFocusable);
      
      // Focus should be visible
      expect(document.activeElement).toHaveClass(/focus:/);
    });

    test('should provide meaningful error messages', async () => {
      // Mock an error scenario
      (workflowManagementService.getTemplateById as jest.Mock).mockRejectedValue(
        new Error('Template not found')
      );
      
      renderWorkflowEditor();
      
      await screen.findByRole('alert');
      
      const errorMessage = screen.getByRole('alert');
      expect(errorMessage).toBeInTheDocument();
      expect(errorMessage).toHaveAttribute('aria-live', 'polite');
      expect(errorMessage).toHaveTextContent(/error/i);
    });

    test('should announce status changes', async () => {
      renderWorkflowEditor();
      
      await screen.findByRole('main');
      
      // Check for status announcements
      const statusRegion = screen.getByRole('status');
      expect(statusRegion).toBeInTheDocument();
      expect(statusRegion).toHaveAttribute('aria-live');
    });

    test('should support high contrast mode', async () => {
      // Mock high contrast media query
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: jest.fn().mockImplementation(query => ({
          matches: query.includes('prefers-contrast: high'),
          media: query,
          onchange: null,
          addListener: jest.fn(),
          removeListener: jest.fn(),
          addEventListener: jest.fn(),
          removeEventListener: jest.fn(),
          dispatchEvent: jest.fn(),
        })),
      });
      
      renderWorkflowEditor();
      
      await screen.findByRole('main');
      
      // Verify high contrast styles are applied
      const mainContent = screen.getByRole('main');
      const computedStyles = window.getComputedStyle(mainContent);
      
      // In high contrast mode, ensure proper color contrast
      expect(computedStyles.getPropertyValue('background-color')).toBeTruthy();
      expect(computedStyles.getPropertyValue('color')).toBeTruthy();
    });

    test('should support reduced motion preferences', async () => {
      // Mock reduced motion preference
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: jest.fn().mockImplementation(query => ({
          matches: query.includes('prefers-reduced-motion: reduce'),
          media: query,
          onchange: null,
          addListener: jest.fn(),
          removeListener: jest.fn(),
          addEventListener: jest.fn(),
          removeEventListener: jest.fn(),
          dispatchEvent: jest.fn(),
        })),
      });
      
      renderWorkflowEditor();
      
      await screen.findByRole('main');
      
      // Check that animations are disabled or reduced
      const animatedElements = screen.getAllByRole('button');
      animatedElements.forEach(element => {
        const computedStyles = window.getComputedStyle(element);
        const animationDuration = computedStyles.getPropertyValue('animation-duration');
        
        if (animationDuration) {
          expect(animationDuration).toBe('0.01ms'); // Reduced motion fallback
        }
      });
    });
  });

  describe('TemplateList Accessibility', () => {
    const renderTemplateList = () => {
      return render(
        <WorkflowPortalProvider>
          <TemplateList 
            onTemplateSelect={jest.fn()}
            onTemplateEdit={jest.fn()}
            onTemplateDelete={jest.fn()}
          />
        </WorkflowPortalProvider>
      );
    };

    test('should have no accessibility violations', async () => {
      const { container } = renderTemplateList();
      
      await screen.findByRole('list');
      
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    test('should have proper list structure', async () => {
      renderTemplateList();
      
      await screen.findByRole('list');
      
      const list = screen.getByRole('list', { name: /templates/i });
      expect(list).toBeInTheDocument();
      
      const listItems = screen.getAllByRole('listitem');
      expect(listItems.length).toBeGreaterThan(0);
      
      // Each list item should have proper content
      listItems.forEach(item => {
        expect(item).toHaveTextContent(/.+/); // Non-empty content
      });
    });

    test('should have accessible search functionality', async () => {
      const user = userEvent.setup();
      renderTemplateList();
      
      await screen.findByRole('list');
      
      const searchInput = screen.getByRole('searchbox', { name: /search templates/i });
      expect(searchInput).toBeInTheDocument();
      expect(searchInput).toHaveAttribute('aria-label');
      
      // Test search interaction
      await user.type(searchInput, 'fiber');
      expect(searchInput).toHaveValue('fiber');
      
      // Search results should be announced
      const resultsAnnouncement = screen.getByRole('status');
      expect(resultsAnnouncement).toBeInTheDocument();
    });

    test('should have accessible filter controls', async () => {
      const user = userEvent.setup();
      renderTemplateList();
      
      await screen.findByRole('list');
      
      // Check filter dropdowns
      const categoryFilter = screen.getByRole('combobox', { name: /category/i });
      expect(categoryFilter).toBeInTheDocument();
      expect(categoryFilter).toHaveAttribute('aria-expanded');
      
      // Test filter interaction
      await user.click(categoryFilter);
      
      const options = screen.getAllByRole('option');
      expect(options.length).toBeGreaterThan(0);
      
      // Options should have proper labels
      options.forEach(option => {
        expect(option).toHaveAttribute('aria-label');
      });
    });

    test('should have accessible action menus', async () => {
      const user = userEvent.setup();
      renderTemplateList();
      
      await screen.findByRole('list');
      
      const menuButtons = screen.getAllByRole('button', { name: /more actions/i });
      expect(menuButtons.length).toBeGreaterThan(0);
      
      // Test menu interaction
      await user.click(menuButtons[0]);
      
      const menu = screen.getByRole('menu');
      expect(menu).toBeInTheDocument();
      
      const menuItems = screen.getAllByRole('menuitem');
      expect(menuItems.length).toBeGreaterThan(0);
      
      // Menu items should have proper labels
      menuItems.forEach(item => {
        expect(item).toHaveTextContent(/.+/);
        expect(item).toHaveAttribute('role', 'menuitem');
      });
    });

    test('should support keyboard navigation in lists', async () => {
      const user = userEvent.setup();
      renderTemplateList();
      
      await screen.findByRole('list');
      
      const firstItem = screen.getAllByRole('listitem')[0];
      const firstButton = firstItem.querySelector('button');
      
      if (firstButton) {
        firstButton.focus();
        expect(document.activeElement).toBe(firstButton);
        
        // Arrow keys should navigate between items
        await user.keyboard('{ArrowDown}');
        expect(document.activeElement).not.toBe(firstButton);
      }
    });
  });

  describe('ProjectWorkflowList Accessibility', () => {
    const renderProjectWorkflowList = () => {
      return render(
        <WorkflowPortalProvider>
          <ProjectWorkflowList 
            workflows={mockProjectWorkflows}
            onWorkflowSelect={jest.fn()}
            onStatusUpdate={jest.fn()}
          />
        </WorkflowPortalProvider>
      );
    };

    test('should have no accessibility violations', async () => {
      const { container } = renderProjectWorkflowList();
      
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    test('should have accessible progress indicators', async () => {
      renderProjectWorkflowList();
      
      const progressBars = screen.getAllByRole('progressbar');
      expect(progressBars.length).toBeGreaterThan(0);
      
      progressBars.forEach(progress => {
        expect(progress).toHaveAttribute('aria-valuenow');
        expect(progress).toHaveAttribute('aria-valuemin', '0');
        expect(progress).toHaveAttribute('aria-valuemax', '100');
        expect(progress).toHaveAttribute('aria-label');
      });
    });

    test('should have accessible status indicators', async () => {
      renderProjectWorkflowList();
      
      const statusElements = screen.getAllByText(/active|paused|completed/i);
      expect(statusElements.length).toBeGreaterThan(0);
      
      statusElements.forEach(status => {
        expect(status).toHaveAttribute('aria-label');
        expect(status.getAttribute('aria-label')).toContain('status');
      });
    });
  });

  describe('Color and Visual Accessibility', () => {
    test('should not rely solely on color for information', async () => {
      const { container } = render(
        <WorkflowEditorProvider>
          <WorkflowEditor templateId="template-1" />
        </WorkflowEditorProvider>
      );
      
      await screen.findByRole('main');
      
      // Check that status indicators use more than just color
      const statusElements = container.querySelectorAll('[class*="status"], [class*="badge"]');
      
      statusElements.forEach(element => {
        const hasIcon = element.querySelector('svg') || element.querySelector('[class*="icon"]');
        const hasText = element.textContent && element.textContent.trim().length > 0;
        
        // Should have either icon or text in addition to color
        expect(hasIcon || hasText).toBeTruthy();
      });
    });

    test('should have sufficient color contrast', async () => {
      const { container } = render(
        <WorkflowPortalProvider>
          <TemplateList 
            onTemplateSelect={jest.fn()}
            onTemplateEdit={jest.fn()}
            onTemplateDelete={jest.fn()}
          />
        </WorkflowPortalProvider>
      );
      
      await screen.findByRole('list');
      
      // Check text elements have sufficient contrast
      const textElements = container.querySelectorAll('p, span, div[class*="text"]');
      
      textElements.forEach(element => {
        const computedStyle = window.getComputedStyle(element);
        const color = computedStyle.color;
        const backgroundColor = computedStyle.backgroundColor;
        
        // Basic check that color and background color are different
        if (color && backgroundColor && color !== 'rgba(0, 0, 0, 0)') {
          expect(color).not.toBe(backgroundColor);
        }
      });
    });
  });

  describe('Screen Reader Support', () => {
    test('should provide meaningful alternative text', async () => {
      render(
        <WorkflowEditorProvider>
          <WorkflowEditor templateId="template-1" />
        </WorkflowEditorProvider>
      );
      
      await screen.findByRole('main');
      
      // Check images have alt text
      const images = screen.getAllByRole('img');
      images.forEach(img => {
        expect(img).toHaveAttribute('alt');
        expect(img.getAttribute('alt')).not.toBe('');
      });
      
      // Check icons have labels or are marked as decorative
      const svgElements = screen.getByRole('main').querySelectorAll('svg');
      svgElements.forEach(svg => {
        const hasLabel = svg.getAttribute('aria-label') || svg.getAttribute('aria-labelledby');
        const isDecorative = svg.getAttribute('aria-hidden') === 'true';
        
        expect(hasLabel || isDecorative).toBeTruthy();
      });
    });

    test('should provide live region updates', async () => {
      const user = userEvent.setup();
      render(
        <WorkflowPortalProvider>
          <TemplateList 
            onTemplateSelect={jest.fn()}
            onTemplateEdit={jest.fn()}
            onTemplateDelete={jest.fn()}
          />
        </WorkflowPortalProvider>
      );
      
      await screen.findByRole('list');
      
      // Search for templates
      const searchInput = screen.getByRole('searchbox');
      await user.type(searchInput, 'test');
      
      // Should have live region for search results
      const liveRegions = screen.getAllByRole('status');
      expect(liveRegions.length).toBeGreaterThan(0);
      
      liveRegions.forEach(region => {
        expect(region).toHaveAttribute('aria-live');
      });
    });
  });

  describe('Mobile and Touch Accessibility', () => {
    test('should have adequate touch targets', async () => {
      const { container } = render(
        <WorkflowPortalProvider>
          <TemplateList 
            onTemplateSelect={jest.fn()}
            onTemplateEdit={jest.fn()}
            onTemplateDelete={jest.fn()}
          />
        </WorkflowPortalProvider>
      );
      
      await screen.findByRole('list');
      
      const buttons = container.querySelectorAll('button');
      
      buttons.forEach(button => {
        const rect = button.getBoundingClientRect();
        const size = Math.min(rect.width, rect.height);
        
        // Touch targets should be at least 44px (WCAG recommendation)
        expect(size).toBeGreaterThanOrEqual(44);
      });
    });

    test('should support zoom up to 200%', async () => {
      // Mock viewport zoom
      Object.defineProperty(window, 'devicePixelRatio', {
        writable: true,
        value: 2.0
      });
      
      const { container } = render(
        <WorkflowEditorProvider>
          <WorkflowEditor templateId="template-1" />
        </WorkflowEditorProvider>
      );
      
      await screen.findByRole('main');
      
      // Content should remain accessible at 200% zoom
      const mainContent = container.querySelector('[role="main"]');
      expect(mainContent).toBeInTheDocument();
      
      // Text should remain readable
      const textElements = container.querySelectorAll('p, span, div');
      textElements.forEach(element => {
        const computedStyle = window.getComputedStyle(element);
        const fontSize = parseFloat(computedStyle.fontSize);
        
        if (fontSize > 0) {
          // Font should be readable at zoom level
          expect(fontSize).toBeGreaterThanOrEqual(12);
        }
      });
    });
  });
});