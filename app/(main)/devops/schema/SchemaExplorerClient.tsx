'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, AlertCircle } from 'lucide-react';
import { SchemaGraph } from './components/SchemaGraph';
import { SearchFilter } from './components/SearchFilter';
import { StatsBar } from './components/StatsBar';
import { TablePanel } from './components/TablePanel';
import type { SchemaData, TableInfo } from './types';

export function SchemaExplorerClient() {
  const router = useRouter();
  const [schema, setSchema] = useState<SchemaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedTable, setSelectedTable] = useState<TableInfo | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);

  const fetchSchema = useCallback(async (forceRefresh = false) => {
    try {
      setLoading(true);
      setError(null);
      const url = `/api/devops/schema${forceRefresh ? '?refresh=true' : ''}`;
      const response = await fetch(url);

      if (response.status === 403) {
        setError('Admin access required');
        return;
      }

      if (!response.ok) {
        throw new Error(`Failed to fetch schema: ${response.status}`);
      }

      const json = await response.json();
      if (!json.success) {
        throw new Error(json.error?.message || 'Unknown error');
      }

      setSchema(json.data);
      setLastRefreshed(new Date().toLocaleTimeString());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSchema();
  }, [fetchSchema]);

  const handleRefresh = () => fetchSchema(true);

  if (loading) {
    return (
      <div className="p-8 text-center">
        <div className="inline-block">
          <RefreshCw className="w-8 h-8 animate-spin text-blue-600" />
        </div>
        <p className="mt-4 text-[var(--ff-text-secondary)]">Loading schema...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-6 h-6 text-red-600 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="font-semibold text-red-900">Error</h3>
              <p className="text-red-700 mt-1">{error}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!schema) {
    return null;
  }

  const visibleTables = schema.tables.filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.module.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="h-screen flex flex-col bg-[var(--ff-bg-primary)]">
      {/* Header */}
      <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] p-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold text-[var(--ff-text-primary)]">DB Schema Explorer</h1>
          <p className="text-[var(--ff-text-secondary)] mt-1">Visualize database structure and relationships</p>
        </div>
      </div>

      {/* Controls */}
      <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <SearchFilter search={search} onSearchChange={setSearch} />
          <div className="flex items-center gap-3">
            {lastRefreshed && (
              <span className="text-sm text-[var(--ff-text-tertiary)]">
                Last refreshed: {lastRefreshed}
              </span>
            )}
            <button
              onClick={handleRefresh}
              className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-2 text-sm font-medium"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Stats Bar */}
      <StatsBar stats={schema.stats} />

      {/* Main Content */}
      <div className="flex-1 flex gap-6 min-h-0 overflow-hidden px-6 py-6">
        <div className="flex-1 min-w-0">
          <SchemaGraph tables={visibleTables} onSelectTable={setSelectedTable} selectedTable={selectedTable} />
        </div>
        {selectedTable && <TablePanel table={selectedTable} schema={schema} onNavigate={setSelectedTable} />}
      </div>
    </div>
  );
}
