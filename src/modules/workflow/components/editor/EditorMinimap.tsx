// 🟢 WORKING: Editor minimap for workflow navigation
import React, { useMemo, useCallback } from 'react';
import { useWorkflowEditor } from '../../context/WorkflowEditorContext';

export function EditorMinimap() {
  const { state, selectNode } = useWorkflowEditor();

  // Calculate minimap dimensions and scale
  const minimapConfig = useMemo(() => {
    const minimapWidth = 200;
    const minimapHeight = 150;
    
    if (state.nodes.length === 0) {
      return {
        width: minimapWidth,
        height: minimapHeight,
        scale: 1,
        offsetX: 0,
        offsetY: 0,
        viewportX: 0,
        viewportY: 0,
        viewportWidth: minimapWidth,
        viewportHeight: minimapHeight
      };
    }

    // Calculate bounds of all nodes
    const bounds = state.nodes.reduce(
      (acc, node) => {
        const nodeRight = node.position.x + 200; // Approximate node width
        const nodeBottom = node.position.y + 100; // Approximate node height
        
        return {
          minX: Math.min(acc.minX, node.position.x),
          minY: Math.min(acc.minY, node.position.y),
          maxX: Math.max(acc.maxX, nodeRight),
          maxY: Math.max(acc.maxY, nodeBottom)
        };
      },
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
    );

    const contentWidth = bounds.maxX - bounds.minX + 100; // Add padding
    const contentHeight = bounds.maxY - bounds.minY + 100;
    
    // Calculate scale to fit content in minimap
    const scaleX = minimapWidth / contentWidth;
    const scaleY = minimapHeight / contentHeight;
    const scale = Math.min(scaleX, scaleY, 1); // Don't scale up
    
    const scaledWidth = contentWidth * scale;
    const scaledHeight = contentHeight * scale;
    
    // Center the scaled content
    const offsetX = (minimapWidth - scaledWidth) / 2;
    const offsetY = (minimapHeight - scaledHeight) / 2;

    // Calculate viewport representation
    const canvasWidth = state.settings.canvasSize.width;
    const canvasHeight = state.settings.canvasSize.height;
    const viewportWidth = Math.min((canvasWidth / contentWidth) * scaledWidth, minimapWidth);
    const viewportHeight = Math.min((canvasHeight / contentHeight) * scaledHeight, minimapHeight);
    
    return {
      width: minimapWidth,
      height: minimapHeight,
      scale,
      offsetX,
      offsetY,
      boundsMinX: bounds.minX,
      boundsMinY: bounds.minY,
      contentWidth,
      contentHeight,
      scaledWidth,
      scaledHeight,
      viewportX: offsetX,
      viewportY: offsetY,
      viewportWidth,
      viewportHeight
    };
  }, [state.nodes, state.settings.canvasSize]);

  // Handle minimap click to navigate
  const handleMinimapClick = useCallback((event: React.MouseEvent) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const clickY = event.clientY - rect.top;
    
    // Convert minimap coordinates to canvas coordinates
    if (minimapConfig.scale > 0) {
      const canvasX = ((clickX - minimapConfig.offsetX) / minimapConfig.scale) + (minimapConfig.boundsMinX || 0);
      const canvasY = ((clickY - minimapConfig.offsetY) / minimapConfig.scale) + (minimapConfig.boundsMinY || 0);
      
      // Find closest node to click
      const clickedNode = state.nodes.find(node => {
        const nodeRight = node.position.x + 200;
        const nodeBottom = node.position.y + 100;
        
        return canvasX >= node.position.x && 
               canvasX <= nodeRight &&
               canvasY >= node.position.y && 
               canvasY <= nodeBottom;
      });
      
      if (clickedNode) {
        selectNode(clickedNode.id);
      }
    }
  }, [minimapConfig, state.nodes, selectNode]);

  // Render minimap nodes
  const renderNodes = useMemo(() => {
    return state.nodes.map(node => {
      const x = (node.position.x - (minimapConfig.boundsMinX || 0)) * minimapConfig.scale + minimapConfig.offsetX;
      const y = (node.position.y - (minimapConfig.boundsMinY || 0)) * minimapConfig.scale + minimapConfig.offsetY;
      const width = 200 * minimapConfig.scale; // Node width scaled
      const height = 100 * minimapConfig.scale; // Node height scaled
      
      const isSelected = state.selectedNodes.includes(node.id);
      
      // Get node color based on type
      const getNodeColor = () => {
        if (isSelected) return '#3B82F6'; // Blue for selected
        
        switch (node.type) {
          case 'phase': return '#6366F1'; // Indigo
          case 'step': return '#10B981'; // Emerald
          case 'task': return '#8B5CF6'; // Violet
          default: return '#6B7280'; // Gray
        }
      };

      return (
        <rect
          key={node.id}
          x={Math.max(0, x)}
          y={Math.max(0, y)}
          width={Math.max(2, width)}
          height={Math.max(2, height)}
          fill={getNodeColor()}
          stroke={isSelected ? '#1D4ED8' : 'transparent'}
          strokeWidth={isSelected ? 2 : 0}
          rx={2}
          opacity={isSelected ? 1 : 0.8}
          className="cursor-pointer"
        />
      );
    });
  }, [state.nodes, state.selectedNodes, minimapConfig]);

  // Render connections
  const renderConnections = useMemo(() => {
    return state.connections.map(connection => {
      const sourceNode = state.nodes.find(n => n.id === connection.sourceNodeId);
      const targetNode = state.nodes.find(n => n.id === connection.targetNodeId);
      
      if (!sourceNode || !targetNode) return null;
      
      const sourceX = (sourceNode.position.x + 100 - (minimapConfig.boundsMinX || 0)) * minimapConfig.scale + minimapConfig.offsetX;
      const sourceY = (sourceNode.position.y + 50 - (minimapConfig.boundsMinY || 0)) * minimapConfig.scale + minimapConfig.offsetY;
      const targetX = (targetNode.position.x + 100 - (minimapConfig.boundsMinX || 0)) * minimapConfig.scale + minimapConfig.offsetX;
      const targetY = (targetNode.position.y + 50 - (minimapConfig.boundsMinY || 0)) * minimapConfig.scale + minimapConfig.offsetY;
      
      return (
        <line
          key={connection.id}
          x1={sourceX}
          y1={sourceY}
          x2={targetX}
          y2={targetY}
          stroke={connection.type === 'dependency' ? '#EF4444' : '#6B7280'}
          strokeWidth={1}
          opacity={0.6}
          strokeDasharray={connection.type === 'dependency' ? '2,2' : 'none'}
        />
      );
    });
  }, [state.connections, state.nodes, minimapConfig]);

  return (
    <div className="bg-card border border-border rounded-lg shadow-lg p-2">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-muted-foreground">
          Minimap
        </span>
        <span className="text-xs text-muted-foreground dark:text-gray-400">
          {state.nodes.length} nodes
        </span>
      </div>

      {/* Minimap Canvas */}
      <div className="relative">
        <svg
          width={minimapConfig.width}
          height={minimapConfig.height}
          className="border border-gray-200 dark:border-gray-600 rounded cursor-pointer"
          onClick={handleMinimapClick}
        >
          {/* Background */}
          <rect
            width="100%"
            height="100%"
            fill="currentColor"
            className="text-gray-50 dark:text-foreground"
          />
          
          {/* Grid pattern */}
          <defs>
            <pattern id="minimap-grid" width="10" height="10" patternUnits="userSpaceOnUse">
              <path d="M 10 0 L 0 0 0 10" fill="none" stroke="currentColor" strokeWidth="0.5" className="text-gray-200 dark:text-muted-foreground" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#minimap-grid)" opacity="0.5" />
          
          {/* Connections */}
          {renderConnections}
          
          {/* Nodes */}
          {renderNodes}
          
          {/* Viewport indicator */}
          <rect
            x={minimapConfig.viewportX}
            y={minimapConfig.viewportY}
            width={minimapConfig.viewportWidth}
            height={minimapConfig.viewportHeight}
            fill="transparent"
            stroke="#3B82F6"
            strokeWidth="1"
            strokeDasharray="3,3"
            opacity="0.8"
            rx="2"
          />
        </svg>

        {/* Empty state */}
        {state.nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="text-2xl mb-1">🗺️</div>
              <div className="text-xs text-muted-foreground">
                No nodes
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="mt-2 flex items-center justify-between text-xs">
        <div className="flex items-center space-x-2">
          <div className="flex items-center space-x-1">
            <div className="w-2 h-2 bg-indigo-500 rounded"></div>
            <span className="text-muted-foreground">Phase</span>
          </div>
          <div className="flex items-center space-x-1">
            <div className="w-2 h-2 bg-emerald-500 rounded"></div>
            <span className="text-muted-foreground">Step</span>
          </div>
          <div className="flex items-center space-x-1">
            <div className="w-2 h-2 bg-violet-500 rounded"></div>
            <span className="text-muted-foreground">Task</span>
          </div>
        </div>
        
        <span className="text-muted-foreground dark:text-gray-400">
          Click to navigate
        </span>
      </div>
    </div>
  );
}

export default EditorMinimap;