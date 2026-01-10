// 🟢 WORKING: Custom drag & drop editor canvas component
import React, { useRef, useCallback, useEffect, useState, useMemo } from 'react';
import { useWorkflowEditor } from '../../context/WorkflowEditorContext';
import { WorkflowNode } from './WorkflowNode';
import { NodeConnection } from './NodeConnection';
import type { EditorPosition } from '../../context/WorkflowEditorContext';
import { log } from '@/lib/logger';

interface CanvasTransform {
  scale: number;
  translateX: number;
  translateY: number;
}

export function EditorCanvas() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState<CanvasTransform>({
    scale: 1,
    translateX: 0,
    translateY: 0
  });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number } | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionBox, setSelectionBox] = useState<{
    startX: number;
    startY: number;
    endX: number;
    endY: number;
  } | null>(null);

  const {
    state,
    moveNode,
    startDrag,
    updateDrag,
    endDrag,
    selectNode,
    selectMultipleNodes,
    clearSelection,
    addNode
  } = useWorkflowEditor();

  // Convert screen coordinates to canvas coordinates
  const screenToCanvas = useCallback((screenX: number, screenY: number): EditorPosition => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };

    return {
      x: (screenX - rect.left - transform.translateX) / transform.scale,
      y: (screenY - rect.top - transform.translateY) / transform.scale
    };
  }, [transform]);

  // Convert canvas coordinates to screen coordinates
  const canvasToScreen = useCallback((canvasX: number, canvasY: number): EditorPosition => {
    return {
      x: canvasX * transform.scale + transform.translateX,
      y: canvasY * transform.scale + transform.translateY
    };
  }, [transform]);

  // Snap to grid if enabled
  const snapToGrid = useCallback((position: EditorPosition): EditorPosition => {
    if (!state.settings.snapToGrid) return position;
    
    const gridSize = state.settings.gridSize;
    return {
      x: Math.round(position.x / gridSize) * gridSize,
      y: Math.round(position.y / gridSize) * gridSize
    };
  }, [state.settings.snapToGrid, state.settings.gridSize]);

  // Update zoom level from settings
  useEffect(() => {
    setTransform(prev => ({
      ...prev,
      scale: state.settings.zoomLevel
    }));
  }, [state.settings.zoomLevel]);

  // Handle mouse down on canvas
  const handleMouseDown = useCallback((event: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const screenPos = { x: event.clientX, y: event.clientY };
    const canvasPos = screenToCanvas(screenPos.x, screenPos.y);

    if (event.button === 1 || (event.button === 0 && event.altKey)) {
      // Middle mouse or Alt+click for panning
      event.preventDefault();
      setIsPanning(true);
      setPanStart({ x: event.clientX - transform.translateX, y: event.clientY - transform.translateY });
    } else if (event.button === 0 && !event.shiftKey && !event.ctrlKey) {
      // Left click for selection
      setIsSelecting(true);
      setSelectionBox({
        startX: canvasPos.x,
        startY: canvasPos.y,
        endX: canvasPos.x,
        endY: canvasPos.y
      });
    }
  }, [screenToCanvas, transform]);

  // Handle mouse move
  const handleMouseMove = useCallback((event: React.MouseEvent) => {
    if (isPanning && panStart) {
      setTransform(prev => ({
        ...prev,
        translateX: event.clientX - panStart.x,
        translateY: event.clientY - panStart.y
      }));
    } else if (isSelecting && selectionBox) {
      const canvasPos = screenToCanvas(event.clientX, event.clientY);
      setSelectionBox(prev => prev ? {
        ...prev,
        endX: canvasPos.x,
        endY: canvasPos.y
      } : null);
    } else if (state.isDragging && state.dragState) {
      const canvasPos = screenToCanvas(event.clientX, event.clientY);
      const snappedPos = snapToGrid(canvasPos);
      updateDrag(snappedPos);
      
      // Update node position immediately for visual feedback
      if (state.dragState.nodeId) {
        moveNode(state.dragState.nodeId, snappedPos);
      }
    }
  }, [isPanning, panStart, isSelecting, selectionBox, state.isDragging, state.dragState, screenToCanvas, snapToGrid, updateDrag, moveNode]);

  // Handle mouse up
  const handleMouseUp = useCallback((_event: React.MouseEvent) => {
    if (isPanning) {
      setIsPanning(false);
      setPanStart(null);
    } else if (isSelecting && selectionBox) {
      // Select nodes within selection box
      const box = {
        left: Math.min(selectionBox.startX, selectionBox.endX),
        right: Math.max(selectionBox.startX, selectionBox.endX),
        top: Math.min(selectionBox.startY, selectionBox.endY),
        bottom: Math.max(selectionBox.startY, selectionBox.endY)
      };

      const selectedNodeIds = state.nodes.filter(node => {
        const nodeRight = node.position.x + 200; // Approximate node width
        const nodeBottom = node.position.y + 100; // Approximate node height
        
        return (
          node.position.x < box.right &&
          nodeRight > box.left &&
          node.position.y < box.bottom &&
          nodeBottom > box.top
        );
      }).map(node => node.id);

      if (selectedNodeIds.length > 0) {
        selectMultipleNodes(selectedNodeIds);
      } else {
        clearSelection();
      }

      setIsSelecting(false);
      setSelectionBox(null);
    } else if (state.isDragging) {
      endDrag();
    }
  }, [isPanning, isSelecting, selectionBox, state.isDragging, state.nodes, selectMultipleNodes, clearSelection, endDrag]);

  // Handle mouse leave
  const handleMouseLeave = useCallback(() => {
    setIsPanning(false);
    setPanStart(null);
    setIsSelecting(false);
    setSelectionBox(null);
  }, []);

  // Handle wheel for zooming
  const handleWheel = useCallback((event: React.WheelEvent) => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      
      const delta = -event.deltaY * 0.001;
      const newScale = Math.max(0.3, Math.min(3, transform.scale + delta));
      
      // Zoom towards mouse cursor
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect) {
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        
        const scaleRatio = newScale / transform.scale;
        const newTranslateX = mouseX - (mouseX - transform.translateX) * scaleRatio;
        const newTranslateY = mouseY - (mouseY - transform.translateY) * scaleRatio;
        
        setTransform({
          scale: newScale,
          translateX: newTranslateX,
          translateY: newTranslateY
        });
      }
    } else {
      // Pan with mouse wheel
      setTransform(prev => ({
        ...prev,
        translateX: prev.translateX - event.deltaX * 0.5,
        translateY: prev.translateY - event.deltaY * 0.5
      }));
    }
  }, [transform]);

  // Handle drag and drop from palette
  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    
    const dragData = event.dataTransfer.getData('application/json');
    if (!dragData) return;
    
    try {
      const { type, parentId } = JSON.parse(dragData);
      const canvasPos = screenToCanvas(event.clientX, event.clientY);
      const snappedPos = snapToGrid(canvasPos);
      
      addNode(type, snappedPos, parentId);
    } catch (error) {
      log.error('Failed to handle drop:', { data: error }, 'EditorCanvas');
    }
  }, [screenToCanvas, snapToGrid, addNode]);

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  // Generate grid pattern
  const gridPattern = useMemo(() => {
    if (!state.settings.showGrid) return null;
    
    const gridSize = state.settings.gridSize * transform.scale;
    const offsetX = transform.translateX % gridSize;
    const offsetY = transform.translateY % gridSize;
    
    return (
      <defs>
        <pattern
          id="grid"
          width={gridSize}
          height={gridSize}
          patternUnits="userSpaceOnUse"
          x={offsetX}
          y={offsetY}
        >
          <path
            d={`M ${gridSize} 0 L 0 0 0 ${gridSize}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="0.5"
            opacity="0.3"
          />
        </pattern>
      </defs>
    );
  }, [state.settings.showGrid, state.settings.gridSize, transform]);

  // Render connections
  const renderConnections = useMemo(() => {
    return state.connections.map(connection => {
      const sourceNode = state.nodes.find(n => n.id === connection.sourceNodeId);
      const targetNode = state.nodes.find(n => n.id === connection.targetNodeId);
      
      if (!sourceNode || !targetNode) return null;
      
      const sourcePos = canvasToScreen(sourceNode.position.x + 100, sourceNode.position.y + 50); // Center of node
      const targetPos = canvasToScreen(targetNode.position.x, targetNode.position.y + 50);
      
      return (
        <NodeConnection
          key={connection.id}
          connection={connection}
          sourcePosition={sourcePos}
          targetPosition={targetPos}
        />
      );
    });
  }, [state.connections, state.nodes, canvasToScreen]);

  // Render nodes
  const renderNodes = useMemo(() => {
    return state.nodes.map(node => {
      const screenPos = canvasToScreen(node.position.x, node.position.y);
      
      return (
        <WorkflowNode
          key={node.id}
          node={node}
          position={screenPos}
          scale={transform.scale}
          isSelected={state.selectedNodes.includes(node.id)}
          isDragging={state.isDragging && state.dragState?.nodeId === node.id}
          onMouseDown={(event) => {
            event.stopPropagation();
            
            if (!state.selectedNodes.includes(node.id)) {
              if (event.shiftKey || event.ctrlKey) {
                selectMultipleNodes([...state.selectedNodes, node.id]);
              } else {
                selectNode(node.id);
              }
            }
            
            const canvasPos = screenToCanvas(event.clientX, event.clientY);
            startDrag(node.id, canvasPos);
          }}
        />
      );
    });
  }, [state.nodes, state.selectedNodes, state.isDragging, state.dragState, canvasToScreen, transform.scale, selectNode, selectMultipleNodes, screenToCanvas, startDrag]);

  // Render selection box
  const renderSelectionBox = useMemo(() => {
    if (!selectionBox) return null;
    
    const startScreen = canvasToScreen(selectionBox.startX, selectionBox.startY);
    const endScreen = canvasToScreen(selectionBox.endX, selectionBox.endY);
    
    const left = Math.min(startScreen.x, endScreen.x);
    const top = Math.min(startScreen.y, endScreen.y);
    const width = Math.abs(endScreen.x - startScreen.x);
    const height = Math.abs(endScreen.y - startScreen.y);
    
    return (
      <div
        className="absolute pointer-events-none border-2 border-blue-500 bg-blue-500/10 rounded"
        style={{
          left: `${left}px`,
          top: `${top}px`,
          width: `${width}px`,
          height: `${height}px`
        }}
      />
    );
  }, [selectionBox, canvasToScreen]);

  return (
    <div
      ref={canvasRef}
      className="relative h-full w-full overflow-hidden bg-[var(--ff-bg-tertiary)] cursor-grab active:cursor-grabbing select-none"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onWheel={handleWheel}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      {/* Grid Background */}
      {state.settings.showGrid && (
        <svg
          className="absolute inset-0 w-full h-full text-[var(--ff-border-light)] pointer-events-none"
          style={{ zIndex: 0 }}
        >
          {gridPattern}
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
      )}

      {/* Connections Layer */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ zIndex: 1 }}
      >
        {renderConnections}
      </svg>

      {/* Nodes Layer */}
      <div
        className="absolute"
        style={{
          transform: `translate(${transform.translateX}px, ${transform.translateY}px) scale(${transform.scale})`,
          transformOrigin: '0 0',
          zIndex: 2
        }}
      >
        {renderNodes}
      </div>

      {/* Selection Box */}
      {renderSelectionBox}

      {/* Canvas Info */}
      <div className="absolute bottom-2 left-2 text-xs text-[var(--ff-text-secondary)] bg-[var(--ff-bg-secondary)]/80 px-2 py-1 rounded backdrop-blur-sm">
        Zoom: {Math.round(transform.scale * 100)}% | Nodes: {state.nodes.length}
      </div>

      {/* Instructions */}
      {state.nodes.length === 0 && !state.isLoading && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center max-w-md">
            <div className="text-6xl mb-4">🎯</div>
            <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-2">
              Start Building Your Workflow
            </h3>
            <p className="text-[var(--ff-text-secondary)] mb-4">
              Drag components from the palette or double-click to add phases, steps, and tasks.
            </p>
            <div className="text-sm text-[var(--ff-text-tertiary)] space-y-1">
              <div>• Alt + click and drag to pan</div>
              <div>• Ctrl + scroll to zoom</div>
              <div>• Drag to select multiple nodes</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default EditorCanvas;