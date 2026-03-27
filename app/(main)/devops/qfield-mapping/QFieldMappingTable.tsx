'use client';

import React, { useMemo, useState } from 'react';
import { ArrowUpDown, Download, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import type { QFieldMapping, TableOverlap } from './qfieldMappingData';

type SortKey = 'layer' | 'qfieldAttribute' | 'ffTable' | 'ffColumn' | 'importPath' | 'status';

interface QFieldMappingTableProps {
  data: QFieldMapping[];
  overlaps: TableOverlap[];
}

const STATUS_STYLES: Record<QFieldMapping['status'], { bg: string; text: string; icon: React.ReactNode }> = {
  mapped: { bg: 'bg-emerald-900/30', text: 'text-emerald-400', icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
  gap: { bg: 'bg-amber-900/30', text: 'text-amber-400', icon: <AlertTriangle className="w-3.5 h-3.5" /> },
  planned: { bg: 'bg-blue-900/30', text: 'text-blue-400', icon: <Clock className="w-3.5 h-3.5" /> },
};

export const QFieldMappingTable: React.FC<QFieldMappingTableProps> = ({ data, overlaps }) => {
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: 'asc' | 'desc' } | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | QFieldMapping['status']>('all');

  const filteredData = useMemo(() => {
    let filtered = data;

    if (statusFilter !== 'all') {
      filtered = filtered.filter(item => item.status === statusFilter);
    }

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(
        item =>
          item.layer.toLowerCase().includes(term) ||
          item.qfieldAttribute.toLowerCase().includes(term) ||
          item.ffTable.toLowerCase().includes(term) ||
          item.ffColumn.toLowerCase().includes(term) ||
          item.importPath.toLowerCase().includes(term)
      );
    }

    if (sortConfig) {
      filtered = [...filtered].sort((a, b) => {
        const aVal = a[sortConfig.key];
        const bVal = b[sortConfig.key];
        return sortConfig.direction === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      });
    }

    return filtered;
  }, [data, searchTerm, sortConfig, statusFilter]);

  const stats = useMemo(() => ({
    total: data.length,
    mapped: data.filter(d => d.status === 'mapped').length,
    gaps: data.filter(d => d.status === 'gap').length,
    planned: data.filter(d => d.status === 'planned').length,
    layers: new Set(data.map(d => d.layer)).size,
    tables: new Set(data.filter(d => d.ffTable !== '—').map(d => d.ffTable)).size,
  }), [data]);

  const groupedData = useMemo(() => {
    const groups = new Map<string, QFieldMapping[]>();
    filteredData.forEach(item => {
      if (!groups.has(item.layer)) groups.set(item.layer, []);
      groups.get(item.layer)!.push(item);
    });
    return Array.from(groups.entries()).map(([layer, rows]) => ({ layer, rows }));
  }, [filteredData]);

  const handleSort = (key: SortKey): void => {
    setSortConfig(current =>
      current?.key === key && current.direction === 'asc'
        ? { key, direction: 'desc' }
        : { key, direction: 'asc' }
    );
  };

  const getAriaSortValue = (key: SortKey): 'ascending' | 'descending' | 'none' => {
    if (sortConfig?.key !== key) return 'none';
    return sortConfig.direction === 'asc' ? 'ascending' : 'descending';
  };

  const handleExportCSV = (): void => {
    const headers = ['Layer', 'QField Attribute', 'FF Table', 'FF Column', 'Import Path', 'Transform', 'Status'];
    const rows = filteredData.map(item => [
      `"${item.layer}"`, `"${item.qfieldAttribute}"`, `"${item.ffTable}"`,
      `"${item.ffColumn}"`, `"${item.importPath}"`, `"${item.transform}"`, `"${item.status}"`,
    ]);
    const csv = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `qfield-mappings-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const columns: { key: SortKey; label: string }[] = [
    { key: 'layer', label: 'QField Layer' },
    { key: 'qfieldAttribute', label: 'QField Attribute' },
    { key: 'ffTable', label: 'FF Table' },
    { key: 'ffColumn', label: 'FF Column' },
    { key: 'importPath', label: 'Import Path' },
    { key: 'status', label: 'Status' },
  ];

  return (
    <div className="space-y-6">
      {/* Stats Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Total Attributes', value: stats.total, color: 'text-[var(--ff-text-primary)]' },
          { label: 'Mapped', value: stats.mapped, color: 'text-emerald-400' },
          { label: 'Gaps', value: stats.gaps, color: 'text-amber-400' },
          { label: 'Planned', value: stats.planned, color: 'text-blue-400' },
          { label: 'Layers', value: stats.layers, color: 'text-purple-400' },
          { label: 'FF Tables', value: stats.tables, color: 'text-cyan-400' },
        ].map(stat => (
          <div key={stat.label} className="bg-[var(--ff-bg-secondary)] rounded-lg p-3 border border-[var(--ff-border-light)]">
            <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
            <div className="text-xs text-[var(--ff-text-tertiary)]">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Search + Filter + Export */}
      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="text"
          placeholder="Search layers, attributes, tables..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          aria-label="Search QField mappings"
          className="flex-1 min-w-[200px] px-4 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)]"
        />
        <div className="flex gap-1">
          {(['all', 'mapped', 'gap', 'planned'] as const).map(filter => (
            <button
              key={filter}
              onClick={() => setStatusFilter(filter)}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                statusFilter === filter
                  ? 'bg-[var(--ff-primary)] text-white'
                  : 'bg-[var(--ff-bg-secondary)] text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
              }`}
            >
              {filter === 'all' ? 'All' : filter.charAt(0).toUpperCase() + filter.slice(1)}
            </button>
          ))}
        </div>
        <button
          onClick={handleExportCSV}
          aria-label="Export QField mappings as CSV"
          className="flex items-center gap-2 px-4 py-2 bg-[var(--ff-primary)] hover:opacity-90 text-white rounded-lg transition-opacity"
        >
          <Download className="w-4 h-4" />
          CSV
        </button>
      </div>

      {/* Mapping Table */}
      <div className="overflow-x-auto rounded-lg border border-[var(--ff-border-light)]">
        <table className="w-full" role="table" aria-label="QField to FibreFlow field mappings" aria-rowcount={filteredData.length}>
          <thead className="bg-[var(--ff-bg-secondary)] border-b border-[var(--ff-border-light)] sticky top-0 z-10">
            <tr>
              {columns.map(col => (
                <th key={col.key} scope="col" aria-sort={getAriaSortValue(col.key)} className="px-4 py-3 text-left">
                  <button
                    onClick={() => handleSort(col.key)}
                    className="flex items-center gap-1.5 font-semibold text-sm text-[var(--ff-text-primary)] hover:text-[var(--ff-primary)]"
                    aria-label={`Sort by ${col.label}`}
                  >
                    {col.label}
                    <ArrowUpDown className={`w-3.5 h-3.5 ${sortConfig?.key === col.key ? 'text-[var(--ff-primary)]' : 'text-[var(--ff-text-tertiary)]'}`} />
                  </button>
                </th>
              ))}
              <th scope="col" className="px-4 py-3 text-left text-sm font-semibold text-[var(--ff-text-primary)]">Transform</th>
            </tr>
          </thead>
          <tbody>
            {groupedData.map(group => (
              <React.Fragment key={group.layer}>
                {group.rows.map((row, idx) => {
                  const style = STATUS_STYLES[row.status];
                  return (
                    <tr
                      key={`${group.layer}-${idx}`}
                      className={`border-b border-[var(--ff-border-light)] ${
                        row.status === 'gap' ? 'bg-amber-950/10' : idx % 2 === 0 ? 'bg-[var(--ff-bg-primary)]' : 'bg-[var(--ff-bg-secondary)]'
                      }`}
                    >
                      <td className="px-4 py-2.5 text-sm text-[var(--ff-text-primary)] font-medium">
                        {idx === 0 ? group.layer : ''}
                      </td>
                      <td className="px-4 py-2.5 text-sm text-[var(--ff-text-secondary)] font-mono">
                        {row.qfieldAttribute}
                      </td>
                      <td className={`px-4 py-2.5 text-sm font-mono ${row.ffTable === '—' ? 'text-[var(--ff-text-tertiary)]' : 'text-[var(--ff-text-secondary)]'}`}>
                        {row.ffTable}
                      </td>
                      <td className={`px-4 py-2.5 text-sm font-mono ${row.ffColumn === '—' ? 'text-[var(--ff-text-tertiary)]' : 'text-[var(--ff-text-secondary)]'}`}>
                        {row.ffColumn}
                      </td>
                      <td className="px-4 py-2.5 text-sm text-[var(--ff-text-secondary)]">
                        {row.importPath}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${style.bg} ${style.text}`}>
                          {style.icon}
                          {row.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-sm text-[var(--ff-text-tertiary)]">
                        {row.transform}
                      </td>
                    </tr>
                  );
                })}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-sm text-[var(--ff-text-tertiary)]" aria-live="polite" role="status">
        Showing {filteredData.length} of {data.length} mappings
      </div>

      {/* Table Overlap / Duplication Analysis */}
      <div className="mt-8">
        <h2 className="text-xl font-bold text-[var(--ff-text-primary)] mb-4">Table Overlap Analysis</h2>
        <div className="space-y-3">
          {overlaps.map((overlap, idx) => (
            <div
              key={idx}
              className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4"
            >
              <div className="flex items-start gap-3">
                <AlertTriangle className={`w-5 h-5 mt-0.5 flex-shrink-0 ${overlap.tables.length > 0 ? 'text-amber-400' : 'text-red-400'}`} />
                <div className="flex-1">
                  <div className="font-semibold text-[var(--ff-text-primary)]">{overlap.concept}</div>
                  {overlap.tables.length > 0 && (
                    <div className="flex gap-2 mt-1">
                      {overlap.tables.map(t => (
                        <span key={t} className="px-2 py-0.5 bg-[var(--ff-bg-primary)] rounded text-xs font-mono text-[var(--ff-text-secondary)] border border-[var(--ff-border-light)]">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="text-sm text-[var(--ff-text-tertiary)] mt-1">{overlap.issue}</p>
                  <p className="text-sm text-emerald-400 mt-1">{overlap.recommendation}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
