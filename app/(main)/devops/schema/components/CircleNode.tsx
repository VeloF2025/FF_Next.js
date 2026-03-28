'use client';

import { memo, type CSSProperties } from 'react';
import { Handle, Position } from '@xyflow/react';

interface CircleNodeData {
  label: string;
  module: string;
  connections: number;
  onSelect: () => void;
  isSelected: boolean;
  isHovered: boolean;
  color: string;
}

interface CircleNodeProps {
  data: CircleNodeData;
  isSelected?: boolean;
}

export const CircleNode = memo(({ data, isSelected }: CircleNodeProps) => {
  const baseRadius = 14;
  const scaledRadius = Math.min(baseRadius + data.connections * 1.5, 28);
  const diameter = scaledRadius * 2;

  const containerStyle: CSSProperties = {
    width: `${diameter}px`,
    height: `${diameter}px`,
  };

  const circleStyle: CSSProperties = {
    backgroundColor: data.color,
    boxShadow:
      isSelected || data.isHovered
        ? `0 0 ${scaledRadius * 2}px rgba(255,255,255,0.5), inset 0 0 ${scaledRadius}px rgba(255,255,255,0.2)`
        : 'none',
  };

  return (
    <div
      onClick={data.onSelect}
      className="cursor-pointer transition-all duration-200"
      style={containerStyle}
    >
      <div
        className={`w-full h-full rounded-full transition-all duration-200 ${
          isSelected
            ? 'ring-2 ring-offset-1 ring-white shadow-lg'
            : data.isHovered
              ? 'shadow-md'
              : ''
        }`}
        style={circleStyle}
        role="button"
        aria-label={data.label}
      />
      {isSelected && (
        <div className="absolute top-full mt-2 left-1/2 transform -translate-x-1/2 whitespace-nowrap text-white text-xs font-medium pointer-events-none">
          {data.label}
        </div>
      )}
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
});

CircleNode.displayName = 'CircleNode';
