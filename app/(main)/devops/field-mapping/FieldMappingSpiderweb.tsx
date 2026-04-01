'use client';

import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { SOHSpiderView } from '@/components/procurement/soh/SOHSpiderView';

type MappingGroup = {
  id: string;
  label: string;
  description: string;
  component: React.ReactNode;
};

const MAPPING_GROUPS: MappingGroup[] = [
  {
    id: 'soh',
    label: 'SOH (Stock on Hand)',
    description:
      'All DB tables and modules that read or write Stock on Hand data — GRN, Odoo sync, field stock, BOQ, accounting.',
    component: <SOHSpiderView />,
  },
  // Future mapping groups will be added here iteratively
];

export function FieldMappingSpiderweb(): React.ReactNode {
  const [selectedGroupId, setSelectedGroupId] = useState<string>(
    MAPPING_GROUPS[0]!.id
  );

  const selectedGroup =
    MAPPING_GROUPS.find(g => g.id === selectedGroupId) ?? MAPPING_GROUPS[0]!;

  return (
    <div className="space-y-4">
      {/* Dropdown */}
      <div className="flex items-center gap-3 flex-wrap">
        <label
          htmlFor="mapping-group-select"
          className="text-sm font-medium text-gray-300 whitespace-nowrap"
        >
          Mapping Group:
        </label>
        <div className="relative">
          <select
            id="mapping-group-select"
            value={selectedGroupId}
            onChange={e => setSelectedGroupId(e.target.value)}
            aria-label="Select mapping group"
            className="appearance-none h-9 pl-3 pr-9 rounded-lg border border-gray-700 bg-gray-800 text-sm text-white cursor-pointer min-w-[240px] focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {MAPPING_GROUPS.map(group => (
              <option key={group.id} value={group.id}>
                {group.label}
              </option>
            ))}
          </select>
          <ChevronDown
            className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"
            aria-hidden="true"
          />
        </div>
        <p className="text-xs text-gray-500 italic">{selectedGroup.description}</p>
      </div>

      {/* Diagram */}
      <div key={selectedGroupId}>{selectedGroup.component}</div>
    </div>
  );
}
