// E2E tests for workflow drag and drop functionality
import { test, expect, Page } from '@playwright/test';

test.describe('Workflow Editor Drag and Drop', () => {
  let page: Page;

  test.beforeEach(async ({ browser }) => {
    page = await browser.newPage();
    
    // Navigate to workflow editor
    await page.goto('/workflow/editor');
    
    // Wait for editor to load
    await page.waitForSelector('[data-testid="workflow-editor"]');
    
    // Mock API responses for workflow data
    await page.route('**/api/workflow/**', async (route) => {
      const url = route.request().url();
      
      if (url.includes('/templates')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            templates: [
              {
                id: 'template-1',
                name: 'Test Template',
                description: 'Test workflow template',
                category: 'project',
                type: 'custom',
                status: 'active',
                version: '1.0',
                isDefault: false,
                isSystem: false,
                tags: [],
                metadata: {},
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
              }
            ],
            total: 1
          })
        });
      }
      
      if (url.includes('/phases')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              id: 'phase-1',
              workflowTemplateId: 'template-1',
              name: 'Planning Phase',
              description: 'Initial planning phase',
              orderIndex: 0,
              color: '#3b82f6',
              estimatedDuration: 5,
              requiredRoles: [],
              dependencies: [],
              completionCriteria: [],
              isOptional: false,
              isParallel: false,
              metadata: {},
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            }
          ])
        });
      }
    });
  });

  test.describe('Phase Node Drag and Drop', () => {
    test('should drag and drop phase node to new position', async () => {
      // Wait for canvas to load
      await page.waitForSelector('[data-testid="editor-canvas"]');
      
      // Create a new phase node
      await page.click('[data-testid="component-palette-toggle"]');
      await page.waitForSelector('[data-testid="component-palette"]');
      
      // Drag phase component from palette to canvas
      const phaseComponent = page.locator('[data-testid="palette-phase"]');
      const canvas = page.locator('[data-testid="editor-canvas"]');
      
      await phaseComponent.dragTo(canvas, {
        targetPosition: { x: 200, y: 150 }
      });
      
      // Verify phase node is created
      const phaseNode = page.locator('[data-testid="workflow-node"][data-type="phase"]');
      await expect(phaseNode).toBeVisible();
      
      // Get initial position
      const initialBox = await phaseNode.boundingBox();
      expect(initialBox).toBeTruthy();
      
      // Drag node to new position
      await phaseNode.dragTo(canvas, {
        targetPosition: { x: 400, y: 300 }
      });
      
      // Verify node moved to new position
      const newBox = await phaseNode.boundingBox();
      expect(newBox).toBeTruthy();
      expect(newBox!.x).not.toBe(initialBox!.x);
      expect(newBox!.y).not.toBe(initialBox!.y);
      
      // Verify position is approximately correct (allowing for some tolerance)
      expect(newBox!.x).toBeCloseTo(400, -1);
      expect(newBox!.y).toBeCloseTo(300, -1);
    });

    test('should snap to grid when snap-to-grid is enabled', async () => {
      await page.waitForSelector('[data-testid="editor-canvas"]');
      
      // Ensure snap-to-grid is enabled
      const snapToggle = page.locator('[data-testid="snap-to-grid-toggle"]');
      const isEnabled = await snapToggle.getAttribute('aria-pressed');
      
      if (isEnabled !== 'true') {
        await snapToggle.click();
      }
      
      // Create phase node
      await page.click('[data-testid="component-palette-toggle"]');
      const phaseComponent = page.locator('[data-testid="palette-phase"]');
      const canvas = page.locator('[data-testid="editor-canvas"]');
      
      await phaseComponent.dragTo(canvas, {
        targetPosition: { x: 157, y: 243 } // Non-grid position
      });
      
      const phaseNode = page.locator('[data-testid="workflow-node"][data-type="phase"]');
      await expect(phaseNode).toBeVisible();
      
      // Verify node snapped to grid (assuming 20px grid)
      const box = await phaseNode.boundingBox();
      expect(box).toBeTruthy();
      expect(box!.x % 20).toBe(0);
      expect(box!.y % 20).toBe(0);
    });

    test('should show drag preview during drag operation', async () => {
      await page.waitForSelector('[data-testid="editor-canvas"]');
      
      // Create phase node first
      await page.click('[data-testid="component-palette-toggle"]');
      const phaseComponent = page.locator('[data-testid="palette-phase"]');
      const canvas = page.locator('[data-testid="editor-canvas"]');
      
      await phaseComponent.dragTo(canvas, {
        targetPosition: { x: 200, y: 150 }
      });
      
      const phaseNode = page.locator('[data-testid="workflow-node"][data-type="phase"]');
      await expect(phaseNode).toBeVisible();
      
      // Start drag operation
      await phaseNode.hover();
      await page.mouse.down();
      
      // Move mouse to show drag preview
      await page.mouse.move(300, 250);
      
      // Verify drag preview is shown
      const dragPreview = page.locator('[data-testid="drag-preview"]');
      await expect(dragPreview).toBeVisible();
      
      // Complete drag
      await page.mouse.up();
      
      // Verify drag preview is hidden
      await expect(dragPreview).not.toBeVisible();
    });

    test('should constrain drag within canvas boundaries', async () => {
      await page.waitForSelector('[data-testid="editor-canvas"]');
      
      const canvas = page.locator('[data-testid="editor-canvas"]');
      const canvasBox = await canvas.boundingBox();
      expect(canvasBox).toBeTruthy();
      
      // Create phase node near edge
      await page.click('[data-testid="component-palette-toggle"]');
      const phaseComponent = page.locator('[data-testid="palette-phase"]');
      
      await phaseComponent.dragTo(canvas, {
        targetPosition: { x: 50, y: 50 }
      });
      
      const phaseNode = page.locator('[data-testid="workflow-node"][data-type="phase"]');
      await expect(phaseNode).toBeVisible();
      
      // Try to drag outside canvas boundaries
      await phaseNode.dragTo(canvas, {
        targetPosition: { x: -100, y: -100 } // Outside canvas
      });
      
      // Verify node stayed within boundaries
      const nodeBox = await phaseNode.boundingBox();
      expect(nodeBox).toBeTruthy();
      expect(nodeBox!.x).toBeGreaterThanOrEqual(canvasBox!.x);
      expect(nodeBox!.y).toBeGreaterThanOrEqual(canvasBox!.y);
    });
  });

  test.describe('Multi-Node Drag Operations', () => {
    test('should drag multiple selected nodes together', async () => {
      await page.waitForSelector('[data-testid="editor-canvas"]');
      
      // Create multiple phase nodes
      await page.click('[data-testid="component-palette-toggle"]');
      const phaseComponent = page.locator('[data-testid="palette-phase"]');
      const canvas = page.locator('[data-testid="editor-canvas"]');
      
      // Create first node
      await phaseComponent.dragTo(canvas, {
        targetPosition: { x: 100, y: 100 }
      });
      
      // Create second node
      await phaseComponent.dragTo(canvas, {
        targetPosition: { x: 300, y: 100 }
      });
      
      const phaseNodes = page.locator('[data-testid="workflow-node"][data-type="phase"]');
      await expect(phaseNodes).toHaveCount(2);
      
      // Select multiple nodes using Ctrl+click
      const firstNode = phaseNodes.first();
      const secondNode = phaseNodes.last();
      
      await firstNode.click();
      await secondNode.click({ modifiers: ['Control'] });
      
      // Verify both nodes are selected
      await expect(firstNode).toHaveClass(/selected/);
      await expect(secondNode).toHaveClass(/selected/);
      
      // Get initial positions
      const firstInitialBox = await firstNode.boundingBox();
      const secondInitialBox = await secondNode.boundingBox();
      
      // Drag first node (should move both)
      await firstNode.dragTo(canvas, {
        targetPosition: { x: 200, y: 200 }
      });
      
      // Verify both nodes moved
      const firstNewBox = await firstNode.boundingBox();
      const secondNewBox = await secondNode.boundingBox();
      
      expect(firstNewBox!.x).not.toBe(firstInitialBox!.x);
      expect(firstNewBox!.y).not.toBe(firstInitialBox!.y);
      expect(secondNewBox!.x).not.toBe(secondInitialBox!.x);
      expect(secondNewBox!.y).not.toBe(secondInitialBox!.y);
      
      // Verify relative positions maintained
      const deltaX = firstNewBox!.x - firstInitialBox!.x;
      const deltaY = firstNewBox!.y - firstInitialBox!.y;
      
      expect(secondNewBox!.x - secondInitialBox!.x).toBeCloseTo(deltaX, 0);
      expect(secondNewBox!.y - secondInitialBox!.y).toBeCloseTo(deltaY, 0);
    });

    test('should show selection rectangle for area selection', async () => {
      await page.waitForSelector('[data-testid="editor-canvas"]');
      
      // Create multiple nodes
      await page.click('[data-testid="component-palette-toggle"]');
      const phaseComponent = page.locator('[data-testid="palette-phase"]');
      const canvas = page.locator('[data-testid="editor-canvas"]');
      
      await phaseComponent.dragTo(canvas, { targetPosition: { x: 100, y: 100 } });
      await phaseComponent.dragTo(canvas, { targetPosition: { x: 200, y: 150 } });
      await phaseComponent.dragTo(canvas, { targetPosition: { x: 300, y: 200 } });
      
      // Start area selection
      await page.mouse.move(50, 50);
      await page.mouse.down();
      await page.mouse.move(350, 250);
      
      // Verify selection rectangle is visible
      const selectionRect = page.locator('[data-testid="selection-rectangle"]');
      await expect(selectionRect).toBeVisible();
      
      await page.mouse.up();
      
      // Verify nodes within selection are selected
      const selectedNodes = page.locator('[data-testid="workflow-node"].selected');
      await expect(selectedNodes).toHaveCount(3);
    });
  });

  test.describe('Step and Task Node Operations', () => {
    test('should create step node within phase', async () => {
      await page.waitForSelector('[data-testid="editor-canvas"]');
      
      // Create phase node first
      await page.click('[data-testid="component-palette-toggle"]');
      const phaseComponent = page.locator('[data-testid="palette-phase"]');
      const stepComponent = page.locator('[data-testid="palette-step"]');
      const canvas = page.locator('[data-testid="editor-canvas"]');
      
      await phaseComponent.dragTo(canvas, {
        targetPosition: { x: 200, y: 150 }
      });
      
      const phaseNode = page.locator('[data-testid="workflow-node"][data-type="phase"]');
      await expect(phaseNode).toBeVisible();
      
      // Drag step into phase
      await stepComponent.dragTo(phaseNode, {
        targetPosition: { x: 250, y: 180 }
      });
      
      // Verify step node is created within phase
      const stepNode = page.locator('[data-testid="workflow-node"][data-type="step"]');
      await expect(stepNode).toBeVisible();
      
      // Verify parent-child relationship
      const stepParent = await stepNode.getAttribute('data-parent-id');
      const phaseId = await phaseNode.getAttribute('data-node-id');
      expect(stepParent).toBe(phaseId);
    });

    test('should prevent invalid parent-child relationships', async () => {
      await page.waitForSelector('[data-testid="editor-canvas"]');
      
      // Create step node first
      await page.click('[data-testid="component-palette-toggle"]');
      const stepComponent = page.locator('[data-testid="palette-step"]');
      const _taskComponent = page.locator('[data-testid="palette-task"]');
      const canvas = page.locator('[data-testid="editor-canvas"]');
      
      await stepComponent.dragTo(canvas, {
        targetPosition: { x: 200, y: 150 }
      });
      
      const stepNode = page.locator('[data-testid="workflow-node"][data-type="step"]');
      await expect(stepNode).toBeVisible();
      
      // Try to drag phase into step (invalid)
      const phaseComponent = page.locator('[data-testid="palette-phase"]');
      await phaseComponent.dragTo(stepNode);
      
      // Verify phase is not created within step
      const phaseInStep = page.locator('[data-testid="workflow-node"][data-type="phase"][data-parent-id]');
      await expect(phaseInStep).not.toBeVisible();
      
      // Verify error message or visual feedback
      const errorMessage = page.locator('[data-testid="drop-error"]');
      await expect(errorMessage).toBeVisible();
    });
  });

  test.describe('Connection Creation via Drag', () => {
    test('should create connection by dragging from connection handle', async () => {
      await page.waitForSelector('[data-testid="editor-canvas"]');
      
      // Create two phase nodes
      await page.click('[data-testid="component-palette-toggle"]');
      const phaseComponent = page.locator('[data-testid="palette-phase"]');
      const canvas = page.locator('[data-testid="editor-canvas"]');
      
      await phaseComponent.dragTo(canvas, {
        targetPosition: { x: 100, y: 150 }
      });
      
      await phaseComponent.dragTo(canvas, {
        targetPosition: { x: 300, y: 150 }
      });
      
      const phaseNodes = page.locator('[data-testid="workflow-node"][data-type="phase"]');
      await expect(phaseNodes).toHaveCount(2);
      
      const firstPhase = phaseNodes.first();
      const secondPhase = phaseNodes.last();
      
      // Hover over first phase to show connection handles
      await firstPhase.hover();
      const connectionHandle = firstPhase.locator('[data-testid="connection-handle-output"]');
      await expect(connectionHandle).toBeVisible();
      
      // Drag from connection handle to second phase
      await connectionHandle.dragTo(secondPhase);
      
      // Verify connection is created
      const connection = page.locator('[data-testid="workflow-connection"]');
      await expect(connection).toBeVisible();
      
      // Verify connection properties
      const sourceId = await connection.getAttribute('data-source-id');
      const targetId = await connection.getAttribute('data-target-id');
      const firstPhaseId = await firstPhase.getAttribute('data-node-id');
      const secondPhaseId = await secondPhase.getAttribute('data-node-id');
      
      expect(sourceId).toBe(firstPhaseId);
      expect(targetId).toBe(secondPhaseId);
    });

    test('should show connection preview while dragging', async () => {
      await page.waitForSelector('[data-testid="editor-canvas"]');
      
      // Create phase node
      await page.click('[data-testid="component-palette-toggle"]');
      const phaseComponent = page.locator('[data-testid="palette-phase"]');
      const canvas = page.locator('[data-testid="editor-canvas"]');
      
      await phaseComponent.dragTo(canvas, {
        targetPosition: { x: 100, y: 150 }
      });
      
      const phaseNode = page.locator('[data-testid="workflow-node"][data-type="phase"]');
      await expect(phaseNode).toBeVisible();
      
      // Start connection drag
      await phaseNode.hover();
      const connectionHandle = phaseNode.locator('[data-testid="connection-handle-output"]');
      
      await connectionHandle.hover();
      await page.mouse.down();
      
      // Move mouse to show preview
      await page.mouse.move(300, 200);
      
      // Verify connection preview is shown
      const connectionPreview = page.locator('[data-testid="connection-preview"]');
      await expect(connectionPreview).toBeVisible();
      
      await page.mouse.up();
      
      // Verify preview is removed
      await expect(connectionPreview).not.toBeVisible();
    });

    test('should highlight valid drop targets during connection drag', async () => {
      await page.waitForSelector('[data-testid="editor-canvas"]');
      
      // Create multiple nodes
      await page.click('[data-testid="component-palette-toggle"]');
      const phaseComponent = page.locator('[data-testid="palette-phase"]');
      const stepComponent = page.locator('[data-testid="palette-step"]');
      const canvas = page.locator('[data-testid="editor-canvas"]');
      
      await phaseComponent.dragTo(canvas, { targetPosition: { x: 100, y: 150 } });
      await phaseComponent.dragTo(canvas, { targetPosition: { x: 300, y: 150 } });
      await stepComponent.dragTo(canvas, { targetPosition: { x: 200, y: 250 } });
      
      const firstPhase = page.locator('[data-testid="workflow-node"][data-type="phase"]').first();
      const secondPhase = page.locator('[data-testid="workflow-node"][data-type="phase"]').last();
      const stepNode = page.locator('[data-testid="workflow-node"][data-type="step"]');
      
      // Start connection drag from first phase
      await firstPhase.hover();
      const connectionHandle = firstPhase.locator('[data-testid="connection-handle-output"]');
      
      await connectionHandle.hover();
      await page.mouse.down();
      await page.mouse.move(250, 200);
      
      // Verify valid targets are highlighted
      await expect(secondPhase).toHaveClass(/drop-target-valid/);
      
      // Verify invalid targets are not highlighted or dimmed
      await expect(stepNode).not.toHaveClass(/drop-target-valid/);
      
      await page.mouse.up();
    });
  });

  test.describe('Performance and Smooth Interactions', () => {
    test('should maintain smooth drag performance with many nodes', async () => {
      await page.waitForSelector('[data-testid="editor-canvas"]');
      
      // Create many nodes to test performance
      await page.click('[data-testid="component-palette-toggle"]');
      const phaseComponent = page.locator('[data-testid="palette-phase"]');
      const canvas = page.locator('[data-testid="editor-canvas"]');
      
      // Create 20 nodes
      for (let i = 0; i < 20; i++) {
        const x = 100 + (i % 5) * 150;
        const y = 100 + Math.floor(i / 5) * 120;
        
        await phaseComponent.dragTo(canvas, {
          targetPosition: { x, y }
        });
      }
      
      const phaseNodes = page.locator('[data-testid="workflow-node"][data-type="phase"]');
      await expect(phaseNodes).toHaveCount(20);
      
      // Test drag performance
      const firstNode = phaseNodes.first();
      
      // Measure drag operation time
      const startTime = Date.now();
      
      await firstNode.dragTo(canvas, {
        targetPosition: { x: 500, y: 300 }
      });
      
      const endTime = Date.now();
      const dragTime = endTime - startTime;
      
      // Drag should complete within reasonable time (< 2 seconds)
      expect(dragTime).toBeLessThan(2000);
      
      // Verify node moved successfully
      const nodeBox = await firstNode.boundingBox();
      expect(nodeBox!.x).toBeCloseTo(500, -1);
      expect(nodeBox!.y).toBeCloseTo(300, -1);
    });

    test('should handle rapid drag operations without errors', async () => {
      await page.waitForSelector('[data-testid="editor-canvas"]');
      
      // Create node
      await page.click('[data-testid="component-palette-toggle"]');
      const phaseComponent = page.locator('[data-testid="palette-phase"]');
      const canvas = page.locator('[data-testid="editor-canvas"]');
      
      await phaseComponent.dragTo(canvas, {
        targetPosition: { x: 100, y: 150 }
      });
      
      const phaseNode = page.locator('[data-testid="workflow-node"][data-type="phase"]');
      await expect(phaseNode).toBeVisible();
      
      // Perform rapid drag operations
      for (let i = 0; i < 5; i++) {
        const x = 150 + i * 50;
        const y = 150 + i * 30;
        
        await phaseNode.dragTo(canvas, {
          targetPosition: { x, y }
        });
        
        // Small delay between drags
        await page.waitForTimeout(100);
      }
      
      // Verify node is still responsive
      const finalBox = await phaseNode.boundingBox();
      expect(finalBox).toBeTruthy();
      expect(finalBox!.x).toBeCloseTo(350, -1);
      expect(finalBox!.y).toBeCloseTo(270, -1);
      
      // Verify no error dialogs appeared
      const errorDialog = page.locator('[data-testid="error-dialog"]');
      await expect(errorDialog).not.toBeVisible();
    });
  });

  test.describe('Accessibility', () => {
    test('should support keyboard-based drag operations', async () => {
      await page.waitForSelector('[data-testid="editor-canvas"]');
      
      // Create phase node
      await page.click('[data-testid="component-palette-toggle"]');
      const phaseComponent = page.locator('[data-testid="palette-phase"]');
      const canvas = page.locator('[data-testid="editor-canvas"]');
      
      await phaseComponent.dragTo(canvas, {
        targetPosition: { x: 200, y: 150 }
      });
      
      const phaseNode = page.locator('[data-testid="workflow-node"][data-type="phase"]');
      await expect(phaseNode).toBeVisible();
      
      // Focus the node
      await phaseNode.focus();
      
      // Use keyboard to move node
      await page.keyboard.press('Space'); // Enter drag mode
      await page.keyboard.press('ArrowRight'); // Move right
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowDown'); // Move down
      await page.keyboard.press('Enter'); // Confirm new position
      
      // Verify node moved
      const nodeBox = await phaseNode.boundingBox();
      expect(nodeBox!.x).toBeGreaterThan(200);
      expect(nodeBox!.y).toBeGreaterThan(150);
    });

    test('should announce drag operations to screen readers', async () => {
      await page.waitForSelector('[data-testid="editor-canvas"]');
      
      // Create phase node
      await page.click('[data-testid="component-palette-toggle"]');
      const phaseComponent = page.locator('[data-testid="palette-phase"]');
      const canvas = page.locator('[data-testid="editor-canvas"]');
      
      await phaseComponent.dragTo(canvas, {
        targetPosition: { x: 200, y: 150 }
      });
      
      const phaseNode = page.locator('[data-testid="workflow-node"][data-type="phase"]');
      
      // Start drag operation
      await phaseNode.dragTo(canvas, {
        targetPosition: { x: 300, y: 200 }
      });
      
      // Verify aria-live region updates
      const announcement = page.locator('[data-testid="drag-announcement"]');
      await expect(announcement).toContainText(/moved to position/i);
    });
  });
});