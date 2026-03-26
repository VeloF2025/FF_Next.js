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
      if (!groups.has(item.concept)) groups.set(item.concept, []);
      groups.get(item.concept)!.push(item);
    });
    return Array.from(groups.entries()).map(([concept, rows]) => ({ concept, rows }));
  }, [filteredData]);

  const handleSort = (key: keyof FieldMapping): void => {
    setSortConfig(current =>
      current?.key === key && current.direction === 'asc'
        ? { key, direction: 'desc' }
        : { key, direction: 'asc' }
    );
  };

  const getAriaSortValue = (key: keyof FieldMapping): 'ascending' | 'descending' | 'none' => {
    if (sortConfig?.key !== key) return 'none';
    return sortConfig.direction === 'asc' ? 'ascending' : 'descending';
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

  const SortIcon = ({ column }: { column: keyof FieldMapping }): React.ReactNode => (
    <ArrowUpDown
      className={`w-4 h-4 ${
        sortConfig?.key === column
          ? 'text-[var(--ff-primary)]'
          : 'text-[var(--ff-text-tertiary)]'
      }`}
      aria-hidden="true"
    />
  );

  return (
    <div className="space-y-4">
      {/* Search + Export */}
      <div className="flex items-center gap-4">
        <input
          type="text"
          placeholder="Search by concept, table, or column..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          aria-label="Search field mappings"
          className="flex-1 px-4 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)]"
        />
        <button
          onClick={handleExportCSV}
          aria-label="Export field mappings as CSV"
          className="flex items-center gap-2 px-4 py-2 bg-[var(--ff-primary)] hover:opacity-90 text-white rounded-lg transition-opacity focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)] focus:ring-offset-2"
        >
          <Download className="w-4 h-4" aria-hidden="true" />
          Export CSV
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-[var(--ff-border-light)]">
        <table
          className="w-full"
          role="table"
          aria-label="Database field mappings"
          aria-rowcount={filteredData.length}
        >
          <thead className="bg-[var(--ff-bg-secondary)] border-b border-[var(--ff-border-light)] sticky top-0">
            <tr role="row">
              {(['concept', 'table', 'column'] as const).map(col => (
                <th
                  key={col}
                  scope="col"
                  aria-sort={getAriaSortValue(col)}
                  className="px-6 py-3 text-left"
                >
                  <button
                    onClick={() => handleSort(col)}
                    className="flex items-center gap-2 font-semibold text-[var(--ff-text-primary)] hover:text-[var(--ff-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)] rounded"
                    aria-label={`Sort by ${col}${sortConfig?.key === col ? `, currently ${sortConfig.direction}ending` : ''}`}
                  >
                    {col.charAt(0).toUpperCase() + col.slice(1).replace('_', ' ')}
                    <SortIcon column={col} />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groupedData.map((group) => (
              <React.Fragment key={group.concept}>
                {group.rows.map((row, rowIdx) => (
                  <tr
                    key={`${group.concept}-${rowIdx}`}
                    role="row"
                    className={
                      rowIdx % 2 === 0
                        ? 'bg-[var(--ff-bg-primary)]'
                        : 'bg-[var(--ff-bg-secondary)]'
                    }
                  >
                    <td className="px-6 py-3 text-[var(--ff-text-primary)] border-b border-[var(--ff-border-light)]">
                      {rowIdx === 0 ? group.concept : ''}
                    </td>
                    <td className="px-6 py-3 text-[var(--ff-text-secondary)] border-b border-[var(--ff-border-light)] font-mono text-sm">
                      {row.table}
                    </td>
                    <td className="px-6 py-3 text-[var(--ff-text-secondary)] border-b border-[var(--ff-border-light)] font-mono text-sm">
                      {row.column}
                    </td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Count */}
      <div className="text-sm text-[var(--ff-text-tertiary)]" aria-live="polite" role="status">
        Showing {filteredData.length} of {data.length} mappings
      </div>
    </div>
  );
};
