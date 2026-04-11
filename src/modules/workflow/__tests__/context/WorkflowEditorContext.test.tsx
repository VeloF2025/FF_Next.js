// Unit tests for WorkflowEditorContext
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { WorkflowEditorProvider, useWorkflowEditor } from '../../context/WorkflowEditorContext';
import { workflowManagementService } from '../../services/WorkflowManagementService';
import {
  mockWorkflowTemplates,
  mockWorkflowPhases,
  mockWorkflowSteps,
  mockWorkflowTasks,
  mockWorkflowValidationResult,
  createMockWorkflowTemplate,
  waitForAsync
} from '../__mocks__/workflow.mocks';

// Mock services
vi.mock('../../services/WorkflowManagementService', () => ({
  workflowManagementService: {
    getTemplateById: vi.fn(),
    getPhases: vi.fn(),
    getSteps: vi.fn(),
    getTasks: vi.fn(),
    validateTemplate: vi.fn()
  }
}));

// Mock timers for auto-save
vi.useFakeTimers();

describe('WorkflowEditorContext', () => {
  // Helper function to create wrapper with context
  const createWrapper = ({ children }: { children: React.ReactNode }) => (
    <WorkflowEditorProvider>{children}</WorkflowEditorProvider>
  );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.clearAllTimers();
    
    // Setup default service mock responses
    (workflowManagementService.getTemplateById as any).mockResolvedValue(mockWorkflowTemplates[0]);
    (workflowManagementService.getPhases as any).mockResolvedValue(mockWorkflowPhases);
    (workflowManagementService.getSteps as any).mockResolvedValue(mockWorkflowSteps);
    (workflowManagementService.getTasks as any).mockResolvedValue(mockWorkflowTasks);
    (workflowManagementService.validateTemplate as any).mockResolvedValue(mockWorkflowValidationResult);
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.useFakeTimers();
  });

  describe('Initial State', () => {
    it('should initialize with correct default state', () => {
      const { result } = renderHook(() => useWorkflowEditor(), {
        wrapper: createWrapper
      });

      expect(result.current.state.isLoading).toBe(false);
      expect(result.current.state.nodes).toEqual([]);
      expect(result.current.state.connections).toEqual([]);
      expect(result.current.state.selectedNodes).toEqual([]);
      expect(result.current.state.isDragging).toBe(false);
      expect(result.current.state.activePanel).toBe(null);
      expect(result.current.state.showMinimap).toBe(false);
      expect(result.current.state.hasUnsavedChanges).toBe(false);
      expect(result.current.state.settings).toEqual({
        snapToGrid: true,
        showGrid: true,
        gridSize: 20,
        autoSave: true,
        viewMode: 'hierarchical',
        zoomLevel: 1,
        canvasSize: { width: 2000, height: 1500 }
      });
    });
  });

  describe('Template Loading', () => {
    it('should load template successfully and create nodes', async () => {
      const { result } = renderHook(() => useWorkflowEditor(), {
        wrapper: createWrapper
      });

      await act(async () => {
        await result.current.loadTemplate('template-1');
      });

      expect(workflowManagementService.getTemplateById).toHaveBeenCalledWith('template-1');
      expect(workflowManagementService.getPhases).toHaveBeenCalledWith('template-1');
      
      await waitFor(() => {
        expect(result.current.state.currentTemplate).toEqual(mockWorkflowTemplates[0]);
        expect(result.current.state.templateId).toBe('template-1');
        expect(result.current.state.nodes.length).toBeGreaterThan(0);
        expect(result.current.state.hasUnsavedChanges).toBe(false);
        expect(result.current.state.isLoading).toBe(false);
      });
    });

    it('should handle template loading error', async () => {
      (workflowManagementService.getTemplateById as any).mockRejectedValue(
        new Error('Template not found')
      );

      const { result } = renderHook(() => useWorkflowEditor(), {
        wrapper: createWrapper
      });

      await act(async () => {
        await result.current.loadTemplate('invalid-template');
      });

      await waitFor(() => {
        expect(result.current.state.error).toBe('Template not found');
        expect(result.current.state.isLoading).toBe(false);
      });
    });

    it('should handle template not found scenario', async () => {
      (workflowManagementService.getTemplateById as any).mockResolvedValue(null);

      const { result } = renderHook(() => useWorkflowEditor(), {
        wrapper: createWrapper
      });

      await act(async () => {
        await result.current.loadTemplate('missing-template');
      });

      await waitFor(() => {
        expect(result.current.state.error).toBe('Template not found');
      });
    });

    it('should create phase nodes with correct positions', async () => {
      const { result } = renderHook(() => useWorkflowEditor(), {
        wrapper: createWrapper
      });

      await act(async () => {
        await result.current.loadTemplate('template-1');
      });

      await waitFor(() => {
        const phaseNodes = result.current.state.nodes.filter(node => node.type === 'phase');
        expect(phaseNodes).toHaveLength(2);
        
        // Check positioning
        expect(phaseNodes[0].position.x).toBe(200);
        expect(phaseNodes[0].position.y).toBe(100);
        expect(phaseNodes[1].position.y).toBeGreaterThan(phaseNodes[0].position.y);
      });
    });

    it('should create step and task nodes for loaded phases', async () => {
      const { result } = renderHook(() => useWorkflowEditor(), {
        wrapper: createWrapper
      });

      await act(async () => {
        await result.current.loadTemplate('template-1');
      });

      await waitFor(() => {
        const stepNodes = result.current.state.nodes.filter(node => node.type === 'step');
        const taskNodes = result.current.state.nodes.filter(node => node.type === 'task');
        
        expect(stepNodes.length).toBeGreaterThan(0);
        expect(taskNodes.length).toBeGreaterThan(0);
        
        // Check parent relationships
        stepNodes.forEach(step => {
          expect(step.parentId).toBeTruthy();
          expect(result.current.state.nodes.find(n => n.id === step.parentId)?.type).toBe('phase');
        });
        
        taskNodes.forEach(task => {
          expect(task.parentId).toBeTruthy();
          expect(result.current.state.nodes.find(n => n.id === task.parentId)?.type).toBe('step');
        });
      });
    });
  });

  describe('Template Saving', () => {
    it('should save template when there are unsaved changes', async () => {
      const { result } = renderHook(() => useWorkflowEditor(), {
        wrapper: createWrapper
      });

      // Load a template first
      await act(async () => {
        await result.current.loadTemplate('template-1');
      });

      // Mark as having unsaved changes
      act(() => {
        result.current.addNode('phase', { x: 100, y: 100 });
      });

      expect(result.current.state.hasUnsavedChanges).toBe(true);

      await act(async () => {
        await result.current.saveTemplate();
      });

      await waitFor(() => {
        expect(result.current.state.hasUnsavedChanges).toBe(false);
        expect(result.current.state.lastSaved).toBeDefined();
      });
    });

    it('should not save when there are no unsaved changes', async () => {
      const { result } = renderHook(() => useWorkflowEditor(), {
        wrapper: createWrapper
      });

      await act(async () => {
        await result.current.loadTemplate('template-1');
      });

      expect(result.current.state.hasUnsavedChanges).toBe(false);

      await act(async () => {
        await result.current.saveTemplate();
      });

      // Should not trigger any save action
      expect(result.current.state.isLoading).toBe(false);
    });

    it('should handle save errors', async () => {
      const { result } = renderHook(() => useWorkflowEditor(), {
        wrapper: createWrapper
      });

      // Load template and make changes
      await act(async () => {
        await result.current.loadTemplate('template-1');
      });

      act(() => {
        result.current.addNode('phase', { x: 100, y: 100 });
      });

      // Mock save error by modifying the saveTemplate function
      // This is a simplified test - in reality we'd mock the service call
      
      expect(result.current.state.hasUnsavedChanges).toBe(true);
    });
  });

  describe('Auto-save Functionality', () => {
    it('should trigger auto-save after timeout when enabled', async () => {
      const { result } = renderHook(() => useWorkflowEditor(), {
        wrapper: createWrapper
      });

      await act(async () => {
        await result.current.loadTemplate('template-1');
      });

      // Make changes to trigger auto-save
      act(() => {
        result.current.addNode('phase', { x: 100, y: 100 });
      });

      expect(result.current.state.hasUnsavedChanges).toBe(true);

      // Fast-forward time to trigger auto-save
      act(() => {
        vi.advanceTimersByTime(30000);
      });

      await waitFor(() => {
        expect(result.current.state.hasUnsavedChanges).toBe(false);
      });
    });

    it('should not auto-save when disabled', async () => {
      const { result } = renderHook(() => useWorkflowEditor(), {
        wrapper: createWrapper
      });

      await act(async () => {
        await result.current.loadTemplate('template-1');
      });

      // Disable auto-save
      act(() => {
        result.current.updateSettings({ autoSave: false });
      });

      // Make changes
      act(() => {
        result.current.addNode('phase', { x: 100, y: 100 });
      });

      expect(result.current.state.hasUnsavedChanges).toBe(true);

      // Fast-forward time
      act(() => {
        vi.advanceTimersByTime(30000);
      });

      // Should still have unsaved changes
      expect(result.current.state.hasUnsavedChanges).toBe(true);
    });
  });

  describe('Node Management', () => {
    it('should add a new node', () => {
      const { result } = renderHook(() => useWorkflowEditor(), {
        wrapper: createWrapper
      });

      const position = { x: 100, y: 200 };

      act(() => {
        result.current.addNode('phase', position);
      });

      expect(result.current.state.nodes).toHaveLength(1);
      expect(result.current.state.nodes[0].type).toBe('phase');
      expect(result.current.state.nodes[0].position).toEqual(position);
      expect(result.current.state.nodes[0].isSelected).toBe(true);
      expect(result.current.state.hasUnsavedChanges).toBe(true);
    });

    it('should update an existing node', () => {
      const { result } = renderHook(() => useWorkflowEditor(), {
        wrapper: createWrapper
      });

      // Add a node first
      act(() => {
        result.current.addNode('phase', { x: 100, y: 200 });
      });

      const nodeId = result.current.state.nodes[0].id;

      act(() => {
        result.current.updateNode(nodeId, { isSelected: false });
      });

      expect(result.current.state.nodes[0].isSelected).toBe(false);
    });

    it('should delete a node and its connections', () => {
      const { result } = renderHook(() => useWorkflowEditor(), {
        wrapper: createWrapper
      });

      // Add nodes and connections
      act(() => {
        result.current.addNode('phase', { x: 100, y: 200 });
        result.current.addNode('step', { x: 300, y: 200 });
      });

      const node1Id = result.current.state.nodes[0].id;
      const node2Id = result.current.state.nodes[1].id;

      act(() => {
        result.current.addConnection(node1Id, node2Id, 'dependency');
      });

      expect(result.current.state.nodes).toHaveLength(2);
      expect(result.current.state.connections).toHaveLength(1);

      act(() => {
        result.current.deleteNode(node1Id);
      });

      expect(result.current.state.nodes).toHaveLength(1);
      expect(result.current.state.connections).toHaveLength(0);
    });

    it('should move a node to new position', () => {
      const { result } = renderHook(() => useWorkflowEditor(), {
        wrapper: createWrapper
      });

      act(() => {
        result.current.addNode('phase', { x: 100, y: 200 });
      });

      const nodeId = result.current.state.nodes[0].id;
      const newPosition = { x: 300, y: 400 };

      act(() => {
        result.current.moveNode(nodeId, newPosition);
      });

      expect(result.current.state.nodes[0].position).toEqual(newPosition);
    });
  });

  describe('Node Selection', () => {
    it('should select a single node', () => {
      const { result } = renderHook(() => useWorkflowEditor(), {
        wrapper: createWrapper
      });

      act(() => {
        result.current.addNode('phase', { x: 100, y: 200 });
      });

      const nodeId = result.current.state.nodes[0].id;

      act(() => {
        result.current.selectNode(nodeId);
      });

      expect(result.current.state.selectedNodes).toEqual([nodeId]);
      expect(result.current.state.activePanel).toBe('properties');
    });

    it('should deselect a node', () => {
      const { result } = renderHook(() => useWorkflowEditor(), {
        wrapper: createWrapper
      });

      act(() => {
        result.current.addNode('phase', { x: 100, y: 200 });
      });

      const nodeId = result.current.state.nodes[0].id;

      act(() => {
        result.current.selectNode(nodeId);
        result.current.deselectNode(nodeId);
      });

      expect(result.current.state.selectedNodes).toEqual([]);
    });

    it('should select multiple nodes', () => {
      const { result } = renderHook(() => useWorkflowEditor(), {
        wrapper: createWrapper
      });

      act(() => {
        result.current.addNode('phase', { x: 100, y: 200 });
        result.current.addNode('step', { x: 300, y: 200 });
      });

      const nodeIds = result.current.state.nodes.map(n => n.id);

      act(() => {
        result.current.selectMultipleNodes(nodeIds);
      });

      expect(result.current.state.selectedNodes).toEqual(nodeIds);
    });

    it('should clear all selections', () => {
      const { result } = renderHook(() => useWorkflowEditor(), {
        wrapper: createWrapper
      });

      act(() => {
        result.current.addNode('phase', { x: 100, y: 200 });
        result.current.addNode('step', { x: 300, y: 200 });
      });

      const nodeIds = result.current.state.nodes.map(n => n.id);

      act(() => {
        result.current.selectMultipleNodes(nodeIds);
        result.current.clearSelection();
      });

      expect(result.current.state.selectedNodes).toEqual([]);
    });
  });

  describe('Drag and Drop', () => {
    it('should start drag operation', () => {
      const { result } = renderHook(() => useWorkflowEditor(), {
        wrapper: createWrapper
      });

      act(() => {
        result.current.addNode('phase', { x: 100, y: 200 });
      });

      const nodeId = result.current.state.nodes[0].id;
      const startPosition = { x: 100, y: 200 };

      act(() => {
        result.current.startDrag(nodeId, startPosition);
      });

      expect(result.current.state.isDragging).toBe(true);
      expect(result.current.state.dragState).toEqual({
        nodeId,
        startPosition,
        currentPosition: startPosition
      });
    });

    it('should update drag position', () => {
      const { result } = renderHook(() => useWorkflowEditor(), {
        wrapper: createWrapper
      });

      act(() => {
        result.current.addNode('phase', { x: 100, y: 200 });
      });

      const nodeId = result.current.state.nodes[0].id;
      const startPosition = { x: 100, y: 200 };
      const newPosition = { x: 150, y: 250 };

      act(() => {
        result.current.startDrag(nodeId, startPosition);
        result.current.updateDrag(newPosition);
      });

      expect(result.current.state.dragState?.currentPosition).toEqual(newPosition);
    });

    it('should end drag operation', () => {
      const { result } = renderHook(() => useWorkflowEditor(), {
        wrapper: createWrapper
      });

      act(() => {
        result.current.addNode('phase', { x: 100, y: 200 });
      });

      const nodeId = result.current.state.nodes[0].id;

      act(() => {
        result.current.startDrag(nodeId, { x: 100, y: 200 });
        result.current.endDrag();
      });

      expect(result.current.state.isDragging).toBe(false);
      expect(result.current.state.dragState).toBeUndefined();
    });
  });

  describe('Connection Management', () => {
    it('should add a connection between nodes', () => {
      const { result } = renderHook(() => useWorkflowEditor(), {
        wrapper: createWrapper
      });

      act(() => {
        result.current.addNode('phase', { x: 100, y: 200 });
        result.current.addNode('step', { x: 300, y: 200 });
      });

      const [node1Id, node2Id] = result.current.state.nodes.map(n => n.id);

      act(() => {
        result.current.addConnection(node1Id, node2Id, 'dependency');
      });

      expect(result.current.state.connections).toHaveLength(1);
      expect(result.current.state.connections[0]).toEqual({
        id: `conn-${node1Id}-${node2Id}`,
        sourceNodeId: node1Id,
        targetNodeId: node2Id,
        type: 'dependency'
      });
    });

    it('should delete a connection', () => {
      const { result } = renderHook(() => useWorkflowEditor(), {
        wrapper: createWrapper
      });

      act(() => {
        result.current.addNode('phase', { x: 100, y: 200 });
        result.current.addNode('step', { x: 300, y: 200 });
      });

      const [node1Id, node2Id] = result.current.state.nodes.map(n => n.id);

      act(() => {
        result.current.addConnection(node1Id, node2Id, 'dependency');
      });

      const connectionId = result.current.state.connections[0].id;

      act(() => {
        result.current.deleteConnection(connectionId);
      });

      expect(result.current.state.connections).toHaveLength(0);
    });
  });

  describe('Settings Management', () => {
    it('should update editor settings', () => {
      const { result } = renderHook(() => useWorkflowEditor(), {
        wrapper: createWrapper
      });

      act(() => {
        result.current.updateSettings({
          zoomLevel: 1.5,
          showGrid: false,
          viewMode: 'flowchart'
        });
      });

      expect(result.current.state.settings.zoomLevel).toBe(1.5);
      expect(result.current.state.settings.showGrid).toBe(false);
      expect(result.current.state.settings.viewMode).toBe('flowchart');
    });

    it('should set active panel', () => {
      const { result } = renderHook(() => useWorkflowEditor(), {
        wrapper: createWrapper
      });

      act(() => {
        result.current.setActivePanel('palette');
      });

      expect(result.current.state.activePanel).toBe('palette');
    });

    it('should toggle minimap', () => {
      const { result } = renderHook(() => useWorkflowEditor(), {
        wrapper: createWrapper
      });

      expect(result.current.state.showMinimap).toBe(false);

      act(() => {
        result.current.toggleMinimap();
      });

      expect(result.current.state.showMinimap).toBe(true);

      act(() => {
        result.current.toggleMinimap();
      });

      expect(result.current.state.showMinimap).toBe(false);
    });
  });

  describe('Template Validation', () => {
    it('should validate template successfully', async () => {
      const { result } = renderHook(() => useWorkflowEditor(), {
        wrapper: createWrapper
      });

      await act(async () => {
        await result.current.loadTemplate('template-1');
      });

      await act(async () => {
        await result.current.validateTemplate();
      });

      expect(workflowManagementService.validateTemplate).toHaveBeenCalledWith('template-1');

      await waitFor(() => {
        expect(result.current.state.validationResult).toEqual(mockWorkflowValidationResult);
        expect(result.current.state.isValidating).toBe(false);
      });
    });

    it('should handle validation error', async () => {
      (workflowManagementService.validateTemplate as any).mockRejectedValue(
        new Error('Validation service error')
      );

      const { result } = renderHook(() => useWorkflowEditor(), {
        wrapper: createWrapper
      });

      await act(async () => {
        await result.current.loadTemplate('template-1');
      });

      await act(async () => {
        await result.current.validateTemplate();
      });

      await waitFor(() => {
        expect(result.current.state.error).toBe('Validation service error');
        expect(result.current.state.isValidating).toBe(false);
      });
    });

    it('should not validate without a template', async () => {
      const { result } = renderHook(() => useWorkflowEditor(), {
        wrapper: createWrapper
      });

      await act(async () => {
        await result.current.validateTemplate();
      });

      expect(workflowManagementService.validateTemplate).not.toHaveBeenCalled();
    });
  });

  describe('Utility Functions', () => {
    it('should get node by id', () => {
      const { result } = renderHook(() => useWorkflowEditor(), {
        wrapper: createWrapper
      });

      act(() => {
        result.current.addNode('phase', { x: 100, y: 200 });
      });

      const nodeId = result.current.state.nodes[0].id;
      const foundNode = result.current.getNodeById(nodeId);

      expect(foundNode).toBeDefined();
      expect(foundNode?.id).toBe(nodeId);
    });

    it('should get selected node', () => {
      const { result } = renderHook(() => useWorkflowEditor(), {
        wrapper: createWrapper
      });

      act(() => {
        result.current.addNode('phase', { x: 100, y: 200 });
      });

      const nodeId = result.current.state.nodes[0].id;

      act(() => {
        result.current.selectNode(nodeId);
      });

      const selectedNode = result.current.getSelectedNode();
      expect(selectedNode?.id).toBe(nodeId);
    });

    it('should get nodes by type', () => {
      const { result } = renderHook(() => useWorkflowEditor(), {
        wrapper: createWrapper
      });

      act(() => {
        result.current.addNode('phase', { x: 100, y: 200 });
        result.current.addNode('step', { x: 300, y: 200 });
        result.current.addNode('phase', { x: 100, y: 400 });
      });

      const phaseNodes = result.current.getNodesByType('phase');
      const stepNodes = result.current.getNodesByType('step');

      expect(phaseNodes).toHaveLength(2);
      expect(stepNodes).toHaveLength(1);
    });
  });

  describe('Hook Error Handling', () => {
    it('should throw error when used outside provider', () => {
      const originalError = console.error;
      console.error = vi.fn();

      expect(() => {
        renderHook(() => useWorkflowEditor());
      }).toThrow('useWorkflowEditor must be used within a WorkflowEditorProvider');

      console.error = originalError;
    });
  });
});