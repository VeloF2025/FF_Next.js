// Accessibility tests for workflow system components
// Tests verify ARIA attributes, keyboard navigation, and axe compliance
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe, toHaveNoViolations } from 'jest-axe';
import { vi, describe, expect, beforeEach, test } from 'vitest';
import { WorkflowEditor } from '../../components/editor/WorkflowEditor';
import { TemplateList } from '../../components/templates/TemplateList';
import { ProjectWorkflowList } from '../../components/projects/ProjectWorkflowList';
import { WorkflowEditorProvider } from '../../context/WorkflowEditorContext';
import { workflowManagementService } from '../../services/WorkflowManagementService';
import {
  mockWorkflowTemplates,
  mockProjectWorkflows
} from '../__mocks__/workflow.mocks';

// Extend matchers — jest-axe works with Vitest's expect.extend
expect.extend(toHaveNoViolations);

// Mock services
vi.mock('../../services/WorkflowManagementService', () => ({
  workflowManagementService: {
    getTemplates: vi.fn(),
    getTemplateById: vi.fn(),
    getPhases: vi.fn(),
    getSteps: vi.fn(),
    getTasks: vi.fn()
  }
}));

vi.mock('../../services/WorkflowTemplateService', () => ({
  workflowTemplateService: {
    exportTemplate: vi.fn(),
  }
}));

// Mock child components to isolate accessibility testing
vi.mock('../../components/editor/EditorCanvas', () => ({
  EditorCanvas: () => (
    <div
      data-testid="editor-canvas"
      role="main"
      aria-label="Workflow editor canvas"
      tabIndex={0}
    >
      <div role="group" aria-label="Workflow nodes">
        <button aria-label="Phase node: Planning">Planning Phase</button>
      </div>
    </div>
  )
}));

vi.mock('../../components/editor/ComponentPalette', () => ({
  ComponentPalette: () => (
    <nav data-testid="component-palette" aria-label="Component palette">
      <h2>Components</h2>
      <ul role="list">
        <li><button aria-label="Add phase component">Phase</button></li>
        <li><button aria-label="Add step component">Step</button></li>
      </ul>
    </nav>
  )
}));

vi.mock('../../components/editor/PropertiesPanel', () => ({
  PropertiesPanel: () => <div data-testid="properties-panel">Properties</div>
}));

vi.mock('../../components/editor/ValidationPanel', () => ({
  ValidationPanel: () => <div data-testid="validation-panel">Validation</div>
}));

vi.mock('../../components/editor/EditorToolbar', () => ({
  EditorToolbar: () => <div data-testid="editor-toolbar">Toolbar</div>
}));

vi.mock('../../components/editor/EditorMinimap', () => ({
  EditorMinimap: () => <div data-testid="editor-minimap">Minimap</div>
}));

vi.mock('../../components/editor/forms', () => ({
  WorkflowEditorForms: () => null
}));

// window.confirm used by TemplateList delete
vi.stubGlobal('confirm', vi.fn(() => true));

const getMock = workflowManagementService.getTemplates as ReturnType<typeof vi.fn>;
const getByIdMock = workflowManagementService.getTemplateById as ReturnType<typeof vi.fn>;

describe('Workflow System Accessibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getMock.mockResolvedValue({
      templates: mockWorkflowTemplates,
      total: mockWorkflowTemplates.length
    });
    getByIdMock.mockResolvedValue(mockWorkflowTemplates[0]);
    (workflowManagementService.getPhases as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (workflowManagementService.getSteps as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (workflowManagementService.getTasks as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  // ─── WorkflowEditor Accessibility ─────────────────────────────

  describe('WorkflowEditor Accessibility', () => {
    const renderEditor = () =>
      render(
        <WorkflowEditorProvider>
          <WorkflowEditor templateId="template-1" />
        </WorkflowEditorProvider>
      );

    test('should have no axe violations', async () => {
      const { container } = renderEditor();
      await screen.findByTestId('editor-canvas');

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    test('should have proper heading hierarchy', async () => {
      renderEditor();
      await screen.findByTestId('editor-canvas');

      const heading = screen.getByRole('heading', { level: 1 });
      expect(heading).toBeInTheDocument();
    });

    test('should have toolbar with proper role and label', async () => {
      renderEditor();
      await screen.findByTestId('editor-canvas');

      const toolbar = screen.getByRole('toolbar', { name: /editor controls/i });
      expect(toolbar).toBeInTheDocument();
    });

    test('should have ARIA labels on zoom buttons', async () => {
      renderEditor();
      await screen.findByTestId('editor-canvas');

      expect(screen.getByTitle('Zoom In')).toBeInTheDocument();
      expect(screen.getByTitle('Zoom Out')).toBeInTheDocument();
      expect(screen.getByTitle('Save Template')).toBeInTheDocument();
    });

    test('should have status live region', async () => {
      renderEditor();
      await screen.findByTestId('editor-canvas');

      const statusElements = screen.getAllByRole('status');
      expect(statusElements.length).toBeGreaterThanOrEqual(1);
      const withAriaLive = statusElements.filter(el => el.getAttribute('aria-live') === 'polite');
      expect(withAriaLive.length).toBeGreaterThanOrEqual(1);
    });

    test('should show alert with aria-live on error', async () => {
      getByIdMock.mockRejectedValue(new Error('Template not found'));

      renderEditor();

      await waitFor(() => {
        const alert = screen.getByRole('alert');
        expect(alert).toBeInTheDocument();
        expect(alert).toHaveAttribute('aria-live', 'polite');
      });
    });

    test('should support keyboard navigation through buttons', async () => {
      const user = userEvent.setup();
      renderEditor();
      await screen.findByTestId('editor-canvas');

      await user.tab();
      expect(document.activeElement?.tagName).toMatch(/BUTTON|INPUT|A/i);
    });
  });

  // ─── TemplateList Accessibility ────────────────────────────────

  describe('TemplateList Accessibility', () => {
    const renderTemplateList = () =>
      render(<TemplateList onTemplateSelect={vi.fn()} onTemplateEdit={vi.fn()} />);

    test('should have no axe violations', async () => {
      const { container } = renderTemplateList();

      await waitFor(() => {
        expect(screen.getByText(mockWorkflowTemplates[0].name)).toBeInTheDocument();
      });

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    test('should have list with proper role and label', async () => {
      renderTemplateList();

      await waitFor(() => {
        const list = screen.getByRole('list', { name: /workflow templates/i });
        expect(list).toBeInTheDocument();
      });
    });

    test('should render template cards as listitems', async () => {
      renderTemplateList();

      await waitFor(() => {
        const items = screen.getAllByRole('listitem');
        expect(items.length).toBe(mockWorkflowTemplates.length);
      });
    });

    test('should have accessible search input', async () => {
      const user = userEvent.setup();
      renderTemplateList();

      await waitFor(() => {
        const search = screen.getByRole('searchbox', { name: /search templates/i });
        expect(search).toBeInTheDocument();
      });

      const search = screen.getByRole('searchbox');
      await user.type(search, 'fiber');
      expect(search).toHaveValue('fiber');
    });

    test('should have status live region for result count', async () => {
      renderTemplateList();

      await waitFor(() => {
        const status = screen.getByRole('status');
        expect(status).toBeInTheDocument();
        expect(status).toHaveAttribute('aria-live', 'polite');
      });
    });

    test('should have menu role on action dropdowns', async () => {
      const user = userEvent.setup();
      renderTemplateList();

      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /template actions/i })).toHaveLength(mockWorkflowTemplates.length);
      });

      await user.click(screen.getAllByRole('button', { name: /template actions/i })[0]);

      const menu = screen.getByRole('menu');
      expect(menu).toBeInTheDocument();

      const menuItems = screen.getAllByRole('menuitem');
      expect(menuItems.length).toBeGreaterThanOrEqual(3); // Edit, Duplicate, Export (+ Delete for non-system)
    });

    test('should have keyboard-accessible search', async () => {
      renderTemplateList();

      await waitFor(() => {
        expect(screen.getByRole('searchbox')).toBeInTheDocument();
      });

      const searchbox = screen.getByRole('searchbox');
      searchbox.focus();
      expect(document.activeElement).toBe(searchbox);
    });
  });

  // ─── ProjectWorkflowList Accessibility ─────────────────────────

  describe('ProjectWorkflowList Accessibility', () => {
    const renderProjectList = () =>
      render(
        <ProjectWorkflowList
          workflows={mockProjectWorkflows}
          onAssignWorkflow={vi.fn()}
          onEditWorkflow={vi.fn()}
          onViewDetails={vi.fn()}
        />
      );

    test('should have no axe violations', async () => {
      const { container } = renderProjectList();

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    test('should have accessible progress indicators', async () => {
      renderProjectList();

      const progressBars = screen.getAllByRole('progressbar');
      expect(progressBars.length).toBeGreaterThan(0);

      progressBars.forEach(bar => {
        expect(bar).toHaveAttribute('aria-valuenow');
        expect(bar).toHaveAttribute('aria-valuemin', '0');
        expect(bar).toHaveAttribute('aria-valuemax', '100');
        expect(bar).toHaveAttribute('aria-label');
      });
    });

    test('should have accessible status indicators', async () => {
      renderProjectList();

      const statusElements = screen.getAllByText(/active|paused|completed/i);
      expect(statusElements.length).toBeGreaterThan(0);

      statusElements.forEach(el => {
        expect(el).toHaveAttribute('aria-label');
        expect(el.getAttribute('aria-label')).toContain('Status');
      });
    });
  });

  // ─── Color and Visual Accessibility ────────────────────────────

  describe('Color and Visual Accessibility', () => {
    test('should not rely solely on color for status info in editor', async () => {
      const { container } = render(
        <WorkflowEditorProvider>
          <WorkflowEditor templateId="template-1" />
        </WorkflowEditorProvider>
      );

      await screen.findByTestId('editor-canvas');

      const buttons = container.querySelectorAll('button');
      buttons.forEach(btn => {
        const hasText = btn.textContent && btn.textContent.trim().length > 0;
        const hasIcon = btn.querySelector('svg');
        const hasTitle = btn.getAttribute('title');
        const hasAriaLabel = btn.getAttribute('aria-label');
        expect(hasText || hasIcon || hasTitle || hasAriaLabel).toBeTruthy();
      });
    });
  });
});
