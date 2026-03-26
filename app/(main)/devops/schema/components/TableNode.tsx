'use client';

import { Handle, Position } from '@xyflow/react';

interface TableNodeData {
  label: string;
  module: string;
  columns: number;
  onSelect: () => void;
  isSelected: boolean;
}

export function TableNode({ data }: { data: TableNodeData }) {
  return (
    <div
      onClick={data.onSelect}
      className={`px-4 py-2 rounded-lg text-white font-semibold cursor-pointer transition-all text-sm ${
        data.isSelected ? 'ring-2 ring-blue-400' : ''
      }`}
    >
      <div className="font-bold text-xs text-white/80 mb-1">{data.module.toUpperCase()}</div>
      <div className="truncate">{data.label}</div>
      <div className="text-xs text-white/70 mt-1">{data.columns} col{data.columns !== 1 ? 's' : ''}</div>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
