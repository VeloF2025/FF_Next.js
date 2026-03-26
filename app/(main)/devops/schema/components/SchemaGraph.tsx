'use client';

import { useCallback, useMemo } from 'react';
import {
  ReactFlow,
  type Node,
  type Edge,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  Panel,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { TableNode } from './TableNode';
import type { TableInfo } from '../types';
import { MODULE_COLORS } from '../types';
import { layoutNodes } from '../utils/layout';

const nodeTypes = {
  table: TableNode,
};

interface SchemaGraphProps {
  tables: TableInfo[];
  onSelectTable: (table: TableInfo) => void;
  selectedTable: TableInfo | null;
}

export function SchemaGraph({ tables, onSelectTable, selectedTable }: SchemaGraphProps) {
  const { nodes: layoutedNodes, edges: layoutedEdges } = useMemo(() => {
    const nodes: Node[] = tables.map((table) => ({
      id: table.name,
      data: {
        label: table.name,
        module: table.module,
        columns: table.columns.length,
        onSelect: () => onSelectTable(table),
        isSelected: selectedTable?.name === table.name,
      },
      position: { x: 0, y: 0 },
      type: 'table',
      style: {
        background: MODULE_COLORS[table.module] || MODULE_COLORS.other,
        opacity: selectedTable && selectedTable.name !== table.name ? 0.3 : 1,
      },
    }));

    const edges: Edge[] = [];
    const edgeSet = new Set<string>();

    tables.forEach((table) => {
      table.foreignKeys.forEach((fk) => {
        const edgeId = `${table.name}-${fk.referencedTable}`;
        if (!edgeSet.has(edgeId)) {
          edges.push({
            id: edgeId,
            source: table.name,
            target: fk.referencedTable,
            animated: selectedTable && (selectedTable.name === table.name || selectedTable.name === fk.referencedTable),
            style: {
              stroke: selectedTable && (selectedTable.name === table.name || selectedTable.name === fk.referencedTable) ? '#3b82f6' : '#d1d5db',
              strokeWidth: selectedTable && (selectedTable.name === table.name || selectedTable.name === fk.referencedTable) ? 3 : 2,
            },
          });
          edgeSet.add(edgeId);
        }
      });
    });

    const layoutedNodes = layoutNodes(nodes, edges);
    return { nodes: layoutedNodes, edges };
  }, [tables, onSelectTable, selectedTable]);

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutedEdges);

  // Update nodes when layout changes
  useCallback(() => {
    setNodes(layoutedNodes);
    setEdges(layoutedEdges);
  }, [layoutedNodes, layoutedEdges, setNodes, setEdges]);

  return (
    <div className="w-full h-full border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
      >
        <Background />
        <Controls />
        <Panel position="top-left" className="text-xs text-[var(--ff-text-tertiary)]">
          {tables.length} table{tables.length !== 1 ? 's' : ''} visible
        </Panel>
      </ReactFlow>
    </div>
  );
}
