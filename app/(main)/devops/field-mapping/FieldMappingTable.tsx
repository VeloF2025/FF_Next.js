'use client';

import React, { useMemo, useState } from 'react';
import { ArrowUpDown, Download } from 'lucide-react';
import type { FieldMapping } from './fieldMappingData';

interface GroupedMapping {
  concept: string;
  rows: FieldMapping[];
}

interface FieldMappingTableProps {
  data: FieldMapping[];
}

export const FieldMappingTable: React.FC<FieldMappingTableProps> = ({ data }) => {
  const [sortConfig, setSortConfig] = useState<{
    key: keyof FieldMapping;
    direction: 'asc' | 'desc';
  } | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const filteredData = useMemo(() => {
    let filtered = data;

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = data.filter(
        item =>
          item.concept.toLowerCase().includes(term) ||
          item.table.toLowerCase().includes(term) ||
          item.column.toLowerCase().includes(term)
      );
    }

    if (sortConfig) {
      filtered = [...filtered].sort((a, b) => {
        const aVal = a[sortConfig.key];
        const bVal = b[sortConfig.key];

        if (typeof aVal === 'string' && typeof bVal === 'string') {
          return sortConfig.direction === 'asc'
            ? aVal.localeCompare(bVal)
            : bVal.localeCompare(aVal);
        }

        return 0;
      });
    }

    return filtered;
  }, [data, searchTerm, sortConfig]);

  const groupedData = useMemo((): GroupedMapping[] => {
    const groups = new Map<string, FieldMapping[]>();

    filteredData.forEach(item => {
      if (!groups.has(item.concept)) {
        groups.set(item.concept, []);
      }
      groups.get(item.concept)!.push(item);
    });

    return Array.from(groups.entries()).map(([concept, rows]) => ({
      concept,
      rows,
    }));
  }, [filteredData]);

  const handleSort = (key: keyof FieldMapping): void => {
    setSortConfig(current =>
      current?.key === key && current.direction === 'asc'
        ? { key, direction: 'desc' }
        : { key, direction: 'asc' }
    );
  };

  const handleExportCSV = (): void => {
    const headers = ['Concept', 'Table', 'Column Name'];
    const rows = filteredData.map(item => [
      `"${item.concept.replace(/"/g, '""')}"`,
      `"${item.table.replace(/"/g, '""')}"`,
      `"${item.column.replace(/"/g, '""')}"`,
    ]);

    const csv = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `field-mappings-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const SortIcon = ({ column }: { column: keyof FieldMapping }): React.ReactNode => {
    if (sortConfig?.key !== column) {
      return <ArrowUpDown className="w-4 h-4 text-gray-400" />;
    }
    return (
      <ArrowUpDown className={`w-4 h-4 ${sortConfig.direction === 'asc' ? 'text-blue-400' : 'text-blue-600'}`} />
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <input
          type="text"
          placeholder="Search by concept, table, or column..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="flex-1 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={handleExportCSV}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
        >
          <Download className="w-4 h-4" />
          Export CSV
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-700">
        <table className="w-full">
          <thead className="bg-gray-900 border-b border-gray-700 sticky top-0">
            <tr>
              <th className="px-6 py-3 text-left">
                <button
                  onClick={() => handleSort('concept')}
                  className="flex items-center gap-2 font-semibold text-gray-200 hover:text-white"
                >
                  Concept
                  <SortIcon column="concept" />
                </button>
              </th>
              <th className="px-6 py-3 text-left">
                <button
                  onClick={() => handleSort('table')}
                  className="flex items-center gap-2 font-semibold text-gray-200 hover:text-white"
                >
                  Table
                  <SortIcon column="table" />
                </button>
              </th>
              <th className="px-6 py-3 text-left">
                <button
                  onClick={() => handleSort('column')}
                  className="flex items-center gap-2 font-semibold text-gray-200 hover:text-white"
                >
                  Column Name
                  <SortIcon column="column" />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {groupedData.map((group, groupIdx) => (
              <React.Fragment key={group.concept}>
                {group.rows.map((row, rowIdx) => (
                  <tr
                    key={`${group.concept}-${rowIdx}`}
                    className={rowIdx % 2 === 0 ? 'bg-gray-800' : 'bg-gray-750'}
                  >
                    <td className="px-6 py-3 text-gray-100 border-b border-gray-700">
                      {rowIdx === 0 ? group.concept : ''}
                    </td>
                    <td className="px-6 py-3 text-gray-300 border-b border-gray-700 font-mono text-sm">
                      {row.table}
                    </td>
                    <td className="px-6 py-3 text-gray-300 border-b border-gray-700 font-mono text-sm">
                      {row.column}
                    </td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-sm text-gray-400">
        Showing {filteredData.length} of {data.length} mappings
      </div>
    </div>
  );
};
