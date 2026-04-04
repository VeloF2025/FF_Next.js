/**
 * OltImportTab — file upload + auto-detect status card
 */

'use client';

import React, { useState, useEffect } from 'react';
import { log } from '@/lib/logger';
import {
  Upload,
  FileSpreadsheet,
  XCircle,
  CheckCircle,
  Loader2,
  Zap,
  Database,
} from 'lucide-react';
import type { AutoDetectStatus, UploadResult } from '../../../types';

interface OltImportTabProps {
  autoDetectStatus: AutoDetectStatus | null;
  fetchStats: () => Promise<void>;
}

export function OltImportTab({ autoDetectStatus, fetchStats }: OltImportTabProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [project, setProject] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<Array<{ id: string; project_name: string; project_code: string }>>([]);

  // Lazy-load projects only when Import tab mounts
  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const res = await fetch('/api/projects?status=active&limit=100');
        if (res.ok) {
          const data = await res.json();
          setProjects(data.data?.projects || data.projects || []);
        }
      } catch (error) {
        log.warn('OltImportTab', { action: 'fetchProjectsFailed', error });
      }
    };
    fetchProjects();
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setUploadResult(null);
    }
  };

  const handleImport = async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    setError(null);

    const formData = new FormData();
    formData.append('file', selectedFile);
    if (project) formData.append('project', project);

    try {
      const res = await fetch('/api/system/olt-report/import', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      const result = data.data || data;
      if (data.success) {
        setUploadResult({ success: true, stats: result.stats });
        fetchStats();
        setSelectedFile(null);
      } else {
        setError(data.error?.message || data.error || 'Import failed');
      }
    } catch {
      setError('Import failed');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
      {/* Header */}
      <div className="p-6 border-b border-[var(--ff-border-light)]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
            <FileSpreadsheet className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">
              Import OLT Report
            </h2>
            <p className="text-sm text-[var(--ff-text-secondary)]">
              Upload a Nokia OLT report Excel file to detect serial mismatches
            </p>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Error */}
        {error && (
          <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400">
            {error}
            <button onClick={() => setError(null)} className="ml-4 text-sm underline hover:no-underline">Dismiss</button>
          </div>
        )}

        {/* Project Select */}
        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
            Project (Optional)
          </label>
          <select
            value={project}
            onChange={(e) => setProject(e.target.value)}
            className="w-full max-w-sm px-3 py-2.5 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40"
          >
            <option value="">All Projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.project_code}>
                {p.project_name}
              </option>
            ))}
          </select>
        </div>

        {/* Drop Zone */}
        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
            Excel File
          </label>
          <div
            onClick={() => !isUploading && document.getElementById('olt-file-input')?.click()}
            onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('border-blue-500', 'bg-blue-500/5'); }}
            onDragLeave={(e) => { e.currentTarget.classList.remove('border-blue-500', 'bg-blue-500/5'); }}
            onDrop={(e) => {
              e.preventDefault();
              e.currentTarget.classList.remove('border-blue-500', 'bg-blue-500/5');
              const file = e.dataTransfer.files?.[0];
              if (file && (file.name.endsWith('.xlsx') || file.name.endsWith('.xls'))) {
                setSelectedFile(file);
                setUploadResult(null);
              }
            }}
            className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
              selectedFile
                ? 'border-green-500/40 bg-green-500/5'
                : 'border-[var(--ff-border-light)] hover:border-blue-500/40 hover:bg-blue-500/5'
            } ${isUploading ? 'pointer-events-none opacity-60' : ''}`}
          >
            <input
              id="olt-file-input"
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileChange}
              className="hidden"
            />
            {selectedFile ? (
              <div className="flex items-center justify-center gap-4">
                <div className="w-12 h-12 rounded-lg bg-green-500/10 flex items-center justify-center">
                  <FileSpreadsheet className="w-6 h-6 text-green-400" />
                </div>
                <div className="text-left">
                  <p className="text-sm font-medium text-[var(--ff-text-primary)]">
                    {selectedFile.name}
                  </p>
                  <p className="text-xs text-[var(--ff-text-secondary)]">
                    {(selectedFile.size / 1024 / 1024).toFixed(1)} MB &middot; Ready to import
                  </p>
                </div>
                {!isUploading && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setSelectedFile(null); setUploadResult(null); }}
                    className="ml-2 p-1 rounded hover:bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]"
                  >
                    <XCircle className="w-4 h-4" />
                  </button>
                )}
              </div>
            ) : (
              <>
                <Upload className="w-8 h-8 text-[var(--ff-text-tertiary)] mx-auto mb-3" />
                <p className="text-sm text-[var(--ff-text-primary)] font-medium">
                  Drop your Nokia OLT report here
                </p>
                <p className="text-xs text-[var(--ff-text-secondary)] mt-1">
                  or click to browse &middot; .xlsx or .xls files
                </p>
              </>
            )}
          </div>
        </div>

        {/* Import Button */}
        <button
          onClick={handleImport}
          disabled={!selectedFile || isUploading}
          className="flex items-center justify-center gap-2 w-full max-w-sm px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {isUploading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Importing &middot; This may take a minute...
            </>
          ) : (
            <>
              <Upload className="w-4 h-4" />
              Import Report
            </>
          )}
        </button>

        {/* Upload Result */}
        {uploadResult && (
          <div className="rounded-xl border border-green-500/20 overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3 bg-green-500/10 border-b border-green-500/20">
              <CheckCircle className="w-4 h-4 text-green-400" />
              <span className="text-sm font-semibold text-green-400">Import Successful</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-[var(--ff-border-light)]">
              <div className="p-4 text-center">
                <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{uploadResult.stats.totalRecords}</p>
                <p className="text-xs text-[var(--ff-text-secondary)] mt-1">Total Records</p>
              </div>
              <div className="p-4 text-center">
                <p className="text-2xl font-bold text-green-400">{uploadResult.stats.matchCount}</p>
                <p className="text-xs text-[var(--ff-text-secondary)] mt-1">Matches</p>
              </div>
              <div className="p-4 text-center">
                <p className="text-2xl font-bold text-amber-400">{uploadResult.stats.mismatchCount}</p>
                <p className="text-xs text-[var(--ff-text-secondary)] mt-1">Mismatches</p>
              </div>
              <div className="p-4 text-center">
                <p className="text-2xl font-bold text-[var(--ff-text-tertiary)]">{uploadResult.stats.emptySerialCount}</p>
                <p className="text-xs text-[var(--ff-text-secondary)] mt-1">Empty Serials</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Auto-Detection Status */}
      {autoDetectStatus?.hasRun && autoDetectStatus.run && (
        <div className="border-t border-[var(--ff-border-light)]">
          <div className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
                <Zap className="w-4 h-4 text-purple-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-[var(--ff-text-primary)]">Auto-Detection Status</h3>
                <p className="text-xs text-[var(--ff-text-secondary)]">
                  Last run: {new Date(autoDetectStatus.run.startedAt).toLocaleString()}
                </p>
              </div>
              <span className={`px-2 py-1 rounded text-xs font-medium ${
                autoDetectStatus.run.status === 'completed'
                  ? 'bg-green-500/20 text-green-400'
                  : autoDetectStatus.run.status === 'running' || autoDetectStatus.run.status === 'processing_queue'
                  ? 'bg-blue-500/20 text-blue-400'
                  : 'bg-red-500/20 text-red-400'
              }`}>
                {autoDetectStatus.run.status === 'processing_queue' ? (
                  <span className="flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />Processing Queue</span>
                ) : autoDetectStatus.run.status === 'running' ? (
                  <span className="flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />Running</span>
                ) : (
                  autoDetectStatus.run.status
                )}
              </span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-[var(--ff-bg-primary)] rounded-lg p-3 border border-[var(--ff-border-light)]">
                <p className="text-lg font-bold text-[var(--ff-text-primary)]">{autoDetectStatus.run.totalOesRows}</p>
                <p className="text-xs text-[var(--ff-text-secondary)]">OES Rows</p>
              </div>
              <div className="bg-[var(--ff-bg-primary)] rounded-lg p-3 border border-[var(--ff-border-light)]">
                <p className="text-lg font-bold text-green-400">{autoDetectStatus.run.matches}</p>
                <p className="text-xs text-[var(--ff-text-secondary)]">Matches</p>
              </div>
              <div className="bg-[var(--ff-bg-primary)] rounded-lg p-3 border border-[var(--ff-border-light)]">
                <p className="text-lg font-bold text-amber-400">{autoDetectStatus.run.mismatchesNote4}</p>
                <p className="text-xs text-[var(--ff-text-secondary)]">Wrong Serial</p>
              </div>
              <div className="bg-[var(--ff-bg-primary)] rounded-lg p-3 border border-[var(--ff-border-light)]">
                <p className="text-lg font-bold text-red-400">{autoDetectStatus.run.mismatchesNote2}</p>
                <p className="text-xs text-[var(--ff-text-secondary)]">Not on 1Map</p>
              </div>
            </div>

            {/* Cache & Queue details */}
            <div className="mt-3 flex flex-wrap gap-4 text-xs text-[var(--ff-text-secondary)]">
              <span className="flex items-center gap-1">
                <Database className="w-3 h-3" />
                Cache: {autoDetectStatus.run.cacheHits} hits / {autoDetectStatus.run.cacheMisses} misses
              </span>
              {autoDetectStatus.run.upsSwaps > 0 && (
                <span className="text-orange-400">UPS swaps: {autoDetectStatus.run.upsSwaps}</span>
              )}
              {autoDetectStatus.run.duplicatesSkipped > 0 && (
                <span>Duplicates skipped: {autoDetectStatus.run.duplicatesSkipped}</span>
              )}
            </div>

            {/* Queue progress bar */}
            {autoDetectStatus.queue && autoDetectStatus.queue.total > 0 && (
              <div className="mt-3">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-[var(--ff-text-secondary)] font-medium">
                    1Map API Lookups: {autoDetectStatus.queue.completed}/{autoDetectStatus.queue.total}
                    {autoDetectStatus.queue.total > 0 && (
                      <span className="ml-1 text-[var(--ff-text-tertiary)]">
                        ({Math.round((autoDetectStatus.queue.completed / autoDetectStatus.queue.total) * 100)}%)
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-2">
                    {autoDetectStatus.queue.errors > 0 && (
                      <span className="text-red-400">{autoDetectStatus.queue.errors} errors</span>
                    )}
                    {autoDetectStatus.queue.pending > 0 ? (
                      <span className="flex items-center gap-1 text-blue-400">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        {autoDetectStatus.queue.pending} remaining
                      </span>
                    ) : (
                      <span className="text-green-400 flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" />
                        Done
                      </span>
                    )}
                  </span>
                </div>
                <div className="h-2 bg-[var(--ff-bg-tertiary)] rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      autoDetectStatus.queue.pending === 0 ? 'bg-green-500' : 'bg-purple-500'
                    }`}
                    style={{ width: `${autoDetectStatus.queue.total > 0 ? (autoDetectStatus.queue.completed / autoDetectStatus.queue.total) * 100 : 0}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
