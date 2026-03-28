'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  ReactFlow,
  type Node,
  type Edge,
  Controls,
  Panel,
  useNodesState,
  useEdgesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { CircleNode } from './CircleNode';
import type { TableInfo } from '../types';
import { MODULE_COLORS } from '../types';
import { layoutNodes } from '../utils/layout';

interface CircleNodeData {
  label: string;
  module: string;
  connections: number;
  onSelect: () => void;
  isSelected: boolean;
  isHovered: boolean;
  color: string;
}

const nodeTypes = {
  circle: CircleNode,
};

interface SchemaGraphProps {
  tables: TableInfo[];
  onSelectTable: (table: TableInfo) => void;
  selectedTable: TableInfo | null;
}

export function SchemaGraph({ tables, onSelectTable, selectedTable }: SchemaGraphProps) {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  const { nodes: layoutedNodes, edges: layoutedEdges } = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nodes: any[] = tables.map((table) => ({
      id: table.name,
      data: {
        label: table.name,
        module: table.module,
        connections: table.foreignKeys.length,
        onSelect: () => onSelectTable(table),
        isSelected: selectedTable?.name === table.name || false,
        isHovered: hoveredNode === table.name,
        color: MODULE_COLORS[table.module] || MODULE_COLORS.other,
      } as CircleNodeData,
      position: { x: 0, y: 0 },
      type: 'circle',
    }));

    const edges: Edge[] = [];
    const edgeSet = new Set<string>();

    tables.forEach((table) => {
      table.foreignKeys.forEach((fk) => {
        const edgeId = `${table.name}-${fk.referencedTable}`;
        if (!edgeSet.has(edgeId)) {
          const isHighlighted =
            selectedTable &&
            (selectedTable.name === table.name || selectedTable.name === fk.referencedTable);

          edges.push({
            id: edgeId,
            source: table.name,
            target: fk.referencedTable,
            animated: isHighlighted || false,
            style: {
              stroke: isHighlighted ? '#ffffff' : '#4a5568',
              strokeWidth: isHighlighted ? 2 : 1.2,
              opacity: isHighlighted ? 0.8 : 0.35,
            },
          } as Edge);
          edgeSet.add(edgeId);
        }
      });
    });

    const layoutedNodes = layoutNodes(nodes as Node[], edges);
    return { nodes: layoutedNodes, edges };
  }, [tables, onSelectTable, selectedTable, hoveredNode]);

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutedEdges);

  const handleNodeMouseEnter = useCallback(
    (nodeId: string) => {
      setHoveredNode(nodeId);
      setEdges((eds) =>
        eds.map((edge) => {
          const isConnected = edge.source === nodeId || edge.target === nodeId;
          return {
            ...edge,
            style: {
              ...edge.style,
              opacity: isConnected ? 1 : ((edge.style?.opacity as number) || 0.35),
              strokeWidth: isConnected ? 2.5 : ((edge.style?.strokeWidth as number) || 1.2),
            },
          };
        }),
      );
    },
    [setEdges],
  );

  const handleNodeMouseLeave = useCallback(() => {
    setHoveredNode(null);
    setEdges((eds) =>
      eds.map((edge) => {
        const isSelected =
          selectedTable &&
          (selectedTable.name === edge.source || selectedTable.name === edge.target);
        return {
          ...edge,
          style: {
            ...edge.style,
            opacity: isSelected ? 0.8 : 0.35,
            strokeWidth: isSelected ? 2 : 1.2,
          },
        };
      }),
    );
  }, [setEdges, selectedTable]);

  return (
    <div
      className="w-full h-full rounded-lg overflow-hidden"
      style={{ backgroundColor: '#0d1117' }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        onNodeMouseEnter={(_, node) => handleNodeMouseEnter(node.id)}
        onNodeMouseLeave={() => handleNodeMouseLeave()}
        fitView
      >
        <div style={{ backgroundColor: '#0d1117', opacity: 0.5 }} className="absolute inset-0" />
        <Controls />
        <Panel
          position="top-left"
          className="text-xs font-medium px-3 py-2 rounded-lg"
          style={{
            backgroundColor: 'rgba(13, 17, 23, 0.8)',
            color: '#8b949e',
            border: '1px solid #30363d',
          }}
        >
          {tables.length} table{tables.length !== 1 ? 's' : ''} • {hoveredNode ? 'hover: edges highlighted' : 'click to explore'}
        </Panel>
      </ReactFlow>
    </div>
  );
}
