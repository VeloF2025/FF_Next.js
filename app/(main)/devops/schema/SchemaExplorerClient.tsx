'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, AlertCircle } from 'lucide-react';
import dynamic from 'next/dynamic';

const SchemaGraph = dynamic(() => import('./components/SchemaGraph').then(m => m.SchemaGraph), {
  ssr: false,
  loading: () => <div className="w-full h-full flex items-center justify-center text-[var(--ff-text-secondary)]">Loading graph...</div>,
});
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
      <div className="p-8 text-center" role="status" aria-live="polite" aria-label="Loading database schema">
        <div className="inline-block">
          <RefreshCw className="w-8 h-8 animate-spin text-[var(--ff-primary)]" aria-hidden="true" />
        </div>
        <p className="mt-4 text-[var(--ff-text-secondary)]">Loading schema...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <div
          className="bg-[var(--ff-danger-subtle)] border border-[var(--ff-danger)] rounded-lg p-6"
          role="alert"
          aria-live="assertive"
        >
          <div className="flex items-start gap-3">
            <AlertCircle className="w-6 h-6 text-[var(--ff-danger)] mt-0.5 flex-shrink-0" aria-hidden="true" />
            <div>
              <h3 className="font-semibold text-[var(--ff-text-primary)]">Error loading schema</h3>
              <p className="text-[var(--ff-danger)] mt-1">{error}</p>
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
              <span
                className="text-sm text-[var(--ff-text-tertiary)]"
                role="status"
                aria-live="polite"
                aria-label={`Schema last refreshed at ${lastRefreshed}`}
              >
                Last refreshed: {lastRefreshed}
              </span>
            )}
            <button
              onClick={handleRefresh}
              aria-label="Refresh database schema"
              className="px-3 py-2 bg-[var(--ff-primary)] text-white rounded hover:opacity-90 flex items-center gap-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)] focus:ring-offset-2"
            >
              <RefreshCw className="w-4 h-4" aria-hidden="true" />
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
