'use client';

import React, { useState, useCallback, useEffect } from 'react';
import {
  Upload, FileSpreadsheet, CheckCircle, XCircle, AlertCircle,
  Loader2, Search, Map, RefreshCw,
} from 'lucide-react';
import toast from 'react-hot-toast';

interface PPRow {
  project: string;
  serial_number: string;
  date_registered: string | null;
}

interface PPRecord {
  id: number;
  serial_number: string;
  project: string;
  date_registered: string | null;
  resolution_status: string;
  resolved_drop_number: string | null;
  resolved_source: string | null;
  resolved_at: string | null;
}

interface PPStats {
  total: number;
  resolved: number;
  unresolved: number;
  projects: number;
  lastImport: {
    date: string;
    filename: string;
    totalRows: number;
  } | null;
}

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  unresolved: { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-800 dark:text-amber-300', label: 'Unresolved' },
  matched_oes: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-800 dark:text-green-300', label: 'OES Match' },
  matched_unified: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-800 dark:text-blue-300', label: 'Unified Match' },
  matched_onemap: { bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-800 dark:text-purple-300', label: 'OneMap Match' },
  matched_1map: { bg: 'bg-teal-100 dark:bg-teal-900/30', text: 'text-teal-800 dark:text-teal-300', label: '1Map Match' },
};

export function PPDataTab() {
  const [file, setFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<PPRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isLooking1Map, setIsLooking1Map] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<PPStats | null>(null);
  const [records, setRecords] = useState<PPRecord[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [filterProject, setFilterProject] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [importResult, setImportResult] = useState<{
    totalRows: number;
    upserted: number;
    resolution: { matched_oes: number; matched_unified: number; matched_onemap: number; total_resolved: number };
  } | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/activate/import-pp-data?action=stats');
      const data = await res.json();
      if (data.success) setStats(data.data);
    } catch {
      // Non-fatal
    }
  }, []);

  const fetchRecords = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        action: 'list',
        page: String(page),
        limit: '50',
      });
      if (filterProject) params.set('project', filterProject);
      if (filterStatus) params.set('status', filterStatus);

      const res = await fetch(`/api/activate/import-pp-data?${params}`);
      const data = await res.json();
      if (data.success) {
        setRecords(data.data);
        setTotalPages(data.pagination.totalPages);
      }
    } catch {
      // Non-fatal
    }
  }, [page, filterProject, filterStatus]);

  useEffect(() => { fetchStats(); }, [fetchStats]);
  useEffect(() => { if (stats && stats.total > 0) fetchRecords(); }, [stats, fetchRecords]);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && (droppedFile.name.endsWith('.xlsx') || droppedFile.name.endsWith('.xls'))) {
      setFile(droppedFile);
      setPreviewData([]);
      setImportResult(null);
      setError(null);
      parseExcel(droppedFile);
    } else {
      setError('Please upload an Excel file (.xlsx or .xls)');
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setPreviewData([]);
      setImportResult(null);
      setError(null);
      parseExcel(selectedFile);
    }
  };

  const parseExcel = async (f: File) => {
    setIsParsing(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', f);
      formData.append('action', 'preview');
      const res = await fetch('/api/activate/import-pp-data', { method: 'POST', body: formData });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to parse file');
      setPreviewData(result.preview || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse file');
    } finally {
      setIsParsing(false);
    }
  };

  const handleImport = async () => {
    if (!file) return;
    setIsLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('action', 'import');
      const res = await fetch('/api/activate/import-pp-data', { method: 'POST', body: formData });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Import failed');
      setImportResult(result);
      toast.success(`Imported ${result.totalRows} PP records, ${result.resolution.total_resolved} resolved locally`);
      fetchStats();
      fetchRecords();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLocalScan = async () => {
    setIsScanning(true);
    setError(null);
    try {
      const res = await fetch('/api/activate/pp-data-resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'local-scan' }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Scan failed');
      toast.success(`Local scan: ${result.data.total_resolved} new matches found`);
      fetchStats();
      fetchRecords();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan failed');
    } finally {
      setIsScanning(false);
    }
  };

  const handle1MapLookup = async () => {
    setIsLooking1Map(true);
    setError(null);
    try {
      const res = await fetch('/api/activate/pp-data-resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: '1map-lookup' }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || '1Map lookup failed');
      toast.success(`1Map lookup: ${result.data.total_resolved} matches found`);
      fetchStats();
      fetchRecords();
    } catch (err) {
      setError(err instanceof Error ? err.message : '1Map lookup failed');
    } finally {
      setIsLooking1Map(false);
    }
  };

  const resetForm = () => {
    setFile(null);
    setPreviewData([]);
    setImportResult(null);
    setError(null);
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-[var(--ff-bg-primary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
            <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{stats.total}</p>
            <p className="text-sm text-[var(--ff-text-secondary)]">Total Imported</p>
          </div>
          <div className="bg-[var(--ff-bg-primary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
            <p className="text-2xl font-bold text-green-500">{stats.resolved}</p>
            <p className="text-sm text-[var(--ff-text-secondary)]">Resolved</p>
          </div>
          <div className="bg-[var(--ff-bg-primary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
            <p className="text-2xl font-bold text-amber-500">{stats.unresolved}</p>
            <p className="text-sm text-[var(--ff-text-secondary)]">Unresolved</p>
          </div>
          <div className="bg-[var(--ff-bg-primary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
            <p className="text-sm text-[var(--ff-text-secondary)]">Last Import</p>
            <p className="text-sm font-medium text-[var(--ff-text-primary)] truncate">
              {stats.lastImport
                ? new Date(stats.lastImport.date).toLocaleDateString()
                : 'Never'}
            </p>
          </div>
        </div>
      )}

      {/* File Drop Zone */}
      {!file && !importResult && (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          className="border-2 border-dashed border-[var(--ff-border-medium)] rounded-lg p-8
                     text-center hover:border-[var(--ff-accent)] transition-colors cursor-pointer"
          onClick={() => document.getElementById('pp-file-input')?.click()}
        >
          <input
            id="pp-file-input"
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFileSelect}
            className="hidden"
          />
          <Upload className="w-12 h-12 mx-auto text-[var(--ff-text-tertiary)] mb-4" />
          <p className="text-[var(--ff-text-secondary)]">
            Drag and drop OES Excel file here, or click to browse
          </p>
          <p className="text-sm text-[var(--ff-text-tertiary)] mt-2">
            Will read the PP DATA sheet automatically
          </p>
        </div>
      )}

      {/* File Selected */}
      {file && !importResult && (
        <div className="bg-[var(--ff-bg-primary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="w-8 h-8 text-green-600" />
              <div>
                <p className="font-medium text-[var(--ff-text-primary)]">{file.name}</p>
                <p className="text-sm text-[var(--ff-text-secondary)]">
                  {(file.size / 1024).toFixed(1)} KB
                </p>
              </div>
            </div>
            <button onClick={resetForm} className="text-sm text-red-400 hover:text-red-300">
              Remove
            </button>
          </div>
        </div>
      )}

      {/* Parsing Indicator */}
      {isParsing && (
        <div className="flex items-center justify-center gap-2 py-4">
          <Loader2 className="w-5 h-5 animate-spin text-[var(--ff-accent)]" />
          <span className="text-[var(--ff-text-secondary)]">Parsing PP DATA sheet...</span>
        </div>
      )}

      {/* Preview Table */}
      {previewData.length > 0 && !importResult && (
        <div className="border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
          <div className="bg-[var(--ff-bg-primary)] px-4 py-2 border-b border-[var(--ff-border-light)]">
            <h3 className="font-medium text-[var(--ff-text-primary)]">
              Preview (first 10 of {previewData.length} rows)
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--ff-bg-tertiary)]">
                <tr>
                  <th className="px-3 py-2 text-left text-[var(--ff-text-secondary)]">Project</th>
                  <th className="px-3 py-2 text-left text-[var(--ff-text-secondary)]">Serial Number</th>
                  <th className="px-3 py-2 text-left text-[var(--ff-text-secondary)]">Date Registered</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ff-border-light)]">
                {previewData.slice(0, 10).map((row, i) => (
                  <tr key={i} className="bg-[var(--ff-bg-secondary)]">
                    <td className="px-3 py-2 text-[var(--ff-text-primary)]">{row.project}</td>
                    <td className="px-3 py-2 font-mono text-[var(--ff-text-secondary)]">{row.serial_number}</td>
                    <td className="px-3 py-2 text-[var(--ff-text-secondary)]">{row.date_registered || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-3 px-4 py-3 border-t border-[var(--ff-border-light)]">
            <button onClick={resetForm} className="px-4 py-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]">
              Cancel
            </button>
            <button
              onClick={handleImport}
              disabled={isLoading}
              className="px-6 py-2 bg-[var(--ff-accent)] text-white rounded-lg hover:opacity-90
                         disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isLoading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Importing...</>
              ) : (
                <><Upload className="w-4 h-4" /> Import {previewData.length} Records</>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Import Result */}
      {importResult && (
        <div className="bg-green-900/20 border border-green-800 rounded-lg p-6">
          <div className="flex items-start gap-3">
            <CheckCircle className="w-6 h-6 text-green-500 flex-shrink-0" />
            <div className="flex-1">
              <h3 className="font-semibold text-green-300 text-lg">Import Complete</h3>
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-[var(--ff-bg-primary)] rounded p-3 text-center">
                  <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{importResult.totalRows}</p>
                  <p className="text-sm text-[var(--ff-text-secondary)]">Total</p>
                </div>
                <div className="bg-[var(--ff-bg-primary)] rounded p-3 text-center">
                  <p className="text-2xl font-bold text-green-500">{importResult.resolution.matched_oes}</p>
                  <p className="text-sm text-[var(--ff-text-secondary)]">OES Matches</p>
                </div>
                <div className="bg-[var(--ff-bg-primary)] rounded p-3 text-center">
                  <p className="text-2xl font-bold text-blue-500">{importResult.resolution.matched_unified}</p>
                  <p className="text-sm text-[var(--ff-text-secondary)]">Unified Matches</p>
                </div>
                <div className="bg-[var(--ff-bg-primary)] rounded p-3 text-center">
                  <p className="text-2xl font-bold text-amber-500">
                    {importResult.totalRows - importResult.resolution.total_resolved}
                  </p>
                  <p className="text-sm text-[var(--ff-text-secondary)]">Unresolved</p>
                </div>
              </div>
              <button onClick={resetForm} className="mt-4 px-4 py-2 bg-[var(--ff-accent)] text-white rounded hover:opacity-90">
                Import Another File
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="bg-red-900/20 border border-red-800 rounded-lg p-4 flex items-start gap-3">
          <XCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-red-300">Error</p>
            <p className="text-sm text-red-400">{error}</p>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      {stats && stats.total > 0 && (
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleLocalScan}
            disabled={isScanning}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700
                       disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isScanning ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Scanning...</>
            ) : (
              <><Search className="w-4 h-4" /> Scan Local Data</>
            )}
          </button>
          <button
            onClick={handle1MapLookup}
            disabled={isLooking1Map}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700
                       disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isLooking1Map ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Looking up...</>
            ) : (
              <><Map className="w-4 h-4" /> 1Map Bulk Lookup</>
            )}
          </button>
          <button
            onClick={() => { fetchStats(); fetchRecords(); }}
            className="px-4 py-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]
                       border border-[var(--ff-border-light)] rounded-lg flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>
      )}

      {/* Filters & Records Table */}
      {stats && stats.total > 0 && (
        <div className="border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
          <div className="bg-[var(--ff-bg-primary)] px-4 py-3 border-b border-[var(--ff-border-light)] flex flex-wrap gap-3 items-center">
            <select
              value={filterProject}
              onChange={(e) => { setFilterProject(e.target.value); setPage(1); }}
              className="px-3 py-1.5 rounded bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)]
                         text-[var(--ff-text-primary)] text-sm"
            >
              <option value="">All Projects</option>
              <option value="Lawley">Lawley</option>
              <option value="Mohadin">Mohadin</option>
              <option value="Mamelodi">Mamelodi</option>
            </select>
            <select
              value={filterStatus}
              onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
              className="px-3 py-1.5 rounded bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)]
                         text-[var(--ff-text-primary)] text-sm"
            >
              <option value="">All Statuses</option>
              <option value="unresolved">Unresolved</option>
              <option value="matched_oes">OES Match</option>
              <option value="matched_unified">Unified Match</option>
              <option value="matched_onemap">OneMap Match</option>
              <option value="matched_1map">1Map Match</option>
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--ff-bg-tertiary)]">
                <tr>
                  <th className="px-3 py-2 text-left text-[var(--ff-text-secondary)]">Serial</th>
                  <th className="px-3 py-2 text-left text-[var(--ff-text-secondary)]">Project</th>
                  <th className="px-3 py-2 text-left text-[var(--ff-text-secondary)]">Registered</th>
                  <th className="px-3 py-2 text-left text-[var(--ff-text-secondary)]">Status</th>
                  <th className="px-3 py-2 text-left text-[var(--ff-text-secondary)]">Resolved DR</th>
                  <th className="px-3 py-2 text-left text-[var(--ff-text-secondary)]">Source</th>
                  <th className="px-3 py-2 text-left text-[var(--ff-text-secondary)]">Resolved At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ff-border-light)]">
                {records.map((record) => {
                  const statusStyle = STATUS_COLORS[record.resolution_status] || { bg: 'bg-gray-100 dark:bg-gray-900/30', text: 'text-gray-800 dark:text-gray-300', label: record.resolution_status };
                  return (
                    <tr key={record.id} className="bg-[var(--ff-bg-secondary)]">
                      <td className="px-3 py-2 font-mono text-[var(--ff-text-primary)]">{record.serial_number}</td>
                      <td className="px-3 py-2 text-[var(--ff-text-secondary)]">{record.project}</td>
                      <td className="px-3 py-2 text-[var(--ff-text-secondary)]">
                        {record.date_registered ? new Date(record.date_registered).toLocaleDateString() : '-'}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}>
                          {statusStyle.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-[var(--ff-text-primary)]">
                        {record.resolved_drop_number || '-'}
                      </td>
                      <td className="px-3 py-2 text-[var(--ff-text-secondary)]">
                        {record.resolved_source || '-'}
                      </td>
                      <td className="px-3 py-2 text-[var(--ff-text-secondary)]">
                        {record.resolved_at ? new Date(record.resolved_at).toLocaleString() : '-'}
                      </td>
                    </tr>
                  );
                })}
                {records.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-[var(--ff-text-tertiary)]">
                      No records found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex justify-between items-center px-4 py-3 border-t border-[var(--ff-border-light)]">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 text-sm rounded border border-[var(--ff-border-light)]
                           text-[var(--ff-text-secondary)] disabled:opacity-50"
              >
                Previous
              </button>
              <span className="text-sm text-[var(--ff-text-secondary)]">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1 text-sm rounded border border-[var(--ff-border-light)]
                           text-[var(--ff-text-secondary)] disabled:opacity-50"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
