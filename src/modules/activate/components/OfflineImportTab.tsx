'use client';

import React, { useState, useCallback } from 'react';
import {
  Upload,
  FileSpreadsheet,
  CheckCircle,
  XCircle,
  AlertCircle,
  Loader2,
  AlertTriangle,
  WifiOff,
  Clock,
} from 'lucide-react';
import { ImportProgressOverlay, type ImportPhase } from './ImportProgressOverlay';

interface OfflineRow {
  drop_number: string;
  serial_number: string;
  area_abbreviation: string;
  ont_address: string;
  last_down_reason: string;
  days_since_last_inform: number;
  offline_days_bucket: string;
  last_inform_date: string | null;
}

interface ImportResult {
  totalRows: number;
  matchedDrops: number;
  matchedOes: number;
  unmatched: number;
  serialMismatches: number;
  alertsCreated: number;
  errors: string[];
}

interface PreviewData {
  preview: OfflineRow[];
  totalRows: number;
  reasonSummary: Record<string, number>;
  bucketSummary: Record<string, number>;
}

interface OfflineImportTabProps {
  onImportComplete?: () => void;
}

export function OfflineImportTab({ onImportComplete }: OfflineImportTabProps) {
  const [file, setFile] = useState<File | null>(null);
  const [reportDate, setReportDate] = useState<string>(
    new Date().toISOString().split('T')[0] as string
  );
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importPhase, setImportPhase] = useState<ImportPhase | null>(null);
  const [formatWarnings, setFormatWarnings] = useState<string[]>([]);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (
      droppedFile &&
      (droppedFile.name.endsWith('.xlsx') || droppedFile.name.endsWith('.xls'))
    ) {
      setFile(droppedFile);
      setPreviewData(null);
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
      setPreviewData(null);
      setImportResult(null);
      setError(null);
      parseExcel(selectedFile);
    }
  };

  const parseExcel = async (file: File) => {
    setIsParsing(true);
    setImportPhase('parsing');
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('action', 'preview');

      const response = await fetch('/api/activate/import-offline', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to parse file');
      }

      setPreviewData(result);

      // Handle format warnings
      if (result.warnings && result.warnings.length > 0) {
        setFormatWarnings(result.warnings);
      } else {
        setFormatWarnings([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse Excel file');
      setFormatWarnings([]);
    } finally {
      setIsParsing(false);
      setImportPhase(null);
    }
  };

  const handleImport = async () => {
    if (!file) return;

    setIsLoading(true);
    setImportPhase('uploading');
    setError(null);
    setImportResult(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('action', 'import');
      formData.append('reportDate', reportDate);

      // Show processing phase after short delay
      setTimeout(() => setImportPhase('processing'), 500);

      const response = await fetch('/api/activate/import-offline', {
        method: 'POST',
        body: formData,
      });

      // Show syncing phase
      setImportPhase('syncing');

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Import failed');
      }

      // Brief complete animation
      setImportPhase('complete');
      await new Promise(resolve => setTimeout(resolve, 800));

      setImportResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setIsLoading(false);
      setImportPhase(null);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const resetForm = (triggerRefresh = false) => {
    setFile(null);
    setPreviewData(null);
    setImportResult(null);
    setError(null);
    setFormatWarnings([]);
    if (triggerRefresh) {
      onImportComplete?.();
    }
  };

  const getReasonColor = (reason: string) => {
    if (reason === 'Dying Gasp') return 'text-yellow-600 dark:text-yellow-400';
    if (reason === 'Device Not Active') return 'text-red-600 dark:text-red-400';
    return 'text-gray-600 dark:text-gray-400';
  };

  const getBucketColor = (bucket: string | undefined | null) => {
    if (!bucket) return 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:bg-gray-900 dark:text-gray-300';
    if (bucket.includes('Less than 20')) return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300';
    if (bucket.includes('20') || bucket.includes('40')) return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300';
    return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300';
  };

  return (
    <div className="space-y-6">
      {/* Import Progress Overlay */}
      <ImportProgressOverlay
        isVisible={importPhase !== null}
        phase={importPhase || 'parsing'}
        title="ARCH Import"
        recordCount={previewData?.totalRows || undefined}
        showDatabaseSync={true}
        showQFieldSync={false}
      />

      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          <WifiOff className="w-5 h-5 text-red-500" />
          ARCH Import
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Import ARCH (network audit) reports. Matches offline devices against drops and OES activations,
          detects serial mismatches, and creates alerts for long-offline devices.
        </p>
      </div>

      {/* Date Picker */}
      <div className="max-w-xs">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Report Date
        </label>
        <input
          type="date"
          value={reportDate}
          onChange={(e) => setReportDate(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md
                     bg-white dark:bg-gray-800 text-gray-900 dark:text-white
                     focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      {/* File Drop Zone */}
      {!file && (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-8
                     text-center hover:border-orange-500 dark:hover:border-orange-400 transition-colors
                     cursor-pointer"
          onClick={() => document.getElementById('offline-file-input')?.click()}
        >
          <input
            id="offline-file-input"
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFileSelect}
            className="hidden"
          />
          <Upload className="w-12 h-12 mx-auto text-gray-400 mb-4" />
          <p className="text-gray-600 dark:text-gray-400">
            Drag and drop <strong>network audit</strong> Excel file here, or click to browse
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-500 dark:text-gray-400 mt-2">
            File should contain &quot;Offline Data&quot; sheet
          </p>
        </div>
      )}

      {/* File Selected */}
      {file && !importResult && (
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="w-8 h-8 text-orange-600" />
              <div>
                <p className="font-medium text-gray-900 dark:text-white">{file.name}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">{(file.size / 1024).toFixed(1)} KB</p>
              </div>
            </div>
            <button onClick={() => resetForm()} className="text-sm text-red-600 hover:text-red-700">
              Remove
            </button>
          </div>
        </div>
      )}

      {/* Parsing Indicator */}
      {isParsing && (
        <div className="flex items-center justify-center gap-2 py-4">
          <Loader2 className="w-5 h-5 animate-spin text-orange-600" />
          <span className="text-gray-600 dark:text-gray-400">Parsing file...</span>
        </div>
      )}

      {/* Format Warnings */}
      {formatWarnings.length > 0 && !importResult && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-medium text-amber-800 dark:text-amber-200 mb-2">
                Format Validation Warnings
              </h4>
              <ul className="space-y-1 text-sm text-amber-700 dark:text-amber-300">
                {formatWarnings.map((warning, index) => (
                  <li key={index} className="flex items-start gap-2">
                    <span className="text-amber-500">•</span>
                    <span>{warning}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
                Review the preview data carefully. If columns look misaligned, the Excel format may have changed.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Preview Data */}
      {previewData && !importResult && (
        <div className="space-y-4">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
              <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-sm">
                <WifiOff className="w-4 h-4" />
                Total Offline
              </div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                {previewData.totalRows.toLocaleString()}
              </p>
            </div>

            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
              <div className="flex items-center gap-2 text-yellow-600 dark:text-yellow-400 text-sm">
                <AlertTriangle className="w-4 h-4" />
                Dying Gasp
              </div>
              <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-400 mt-1">
                {(previewData.reasonSummary['Dying Gasp'] || 0).toLocaleString()}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {((previewData.reasonSummary['Dying Gasp'] || 0) / previewData.totalRows * 100).toFixed(1)}%
              </p>
            </div>

            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
              <div className="flex items-center gap-2 text-red-600 dark:text-red-400 text-sm">
                <XCircle className="w-4 h-4" />
                Device Not Active
              </div>
              <p className="text-2xl font-bold text-red-600 dark:text-red-400 mt-1">
                {(previewData.reasonSummary['Device Not Active'] || 0).toLocaleString()}
              </p>
            </div>

            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
              <div className="flex items-center gap-2 text-orange-600 dark:text-orange-400 text-sm">
                <Clock className="w-4 h-4" />
                {'>'} 20 Days Offline
              </div>
              <p className="text-2xl font-bold text-orange-600 dark:text-orange-400 mt-1">
                {Object.entries(previewData.bucketSummary || {})
                  .filter(([k]) => k && !k.includes('Less than 20'))
                  .reduce((a, [, v]) => a + v, 0)
                  .toLocaleString()}
              </p>
            </div>
          </div>

          {/* Offline Bucket Breakdown */}
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
            <h4 className="font-medium text-gray-900 dark:text-white mb-3">Offline Duration Breakdown</h4>
            <div className="space-y-2">
              {Object.entries(previewData.bucketSummary || {})
                .filter(([k]) => k != null)
                .sort((a, b) => b[1] - a[1])
                .map(([bucket, count]) => (
                  <div key={bucket} className="flex items-center justify-between">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${getBucketColor(bucket)}`}>
                      {bucket}
                    </span>
                    <span className="font-mono text-gray-900 dark:text-white">
                      {count.toLocaleString()} ({((count / previewData.totalRows) * 100).toFixed(1)}%)
                    </span>
                  </div>
                ))}
            </div>
          </div>

          {/* Preview Table */}
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            <div className="bg-gray-50 dark:bg-gray-800 px-4 py-2 border-b border-gray-200 dark:border-gray-700">
              <h3 className="font-medium text-gray-900 dark:text-white">
                Preview (first 10 of {previewData.totalRows.toLocaleString()})
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-100 dark:bg-gray-700">
                  <tr>
                    <th className="px-3 py-2 text-left text-gray-700 dark:text-gray-300">Drop</th>
                    <th className="px-3 py-2 text-left text-gray-700 dark:text-gray-300">Serial</th>
                    <th className="px-3 py-2 text-left text-gray-700 dark:text-gray-300">Reason</th>
                    <th className="px-3 py-2 text-right text-gray-700 dark:text-gray-300">Days</th>
                    <th className="px-3 py-2 text-left text-gray-700 dark:text-gray-300">Bucket</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {previewData.preview.slice(0, 10).map((row, i) => (
                    <tr key={i} className="bg-white dark:bg-gray-800">
                      <td className="px-3 py-2 font-mono text-gray-900 dark:text-white">
                        {row.drop_number}
                      </td>
                      <td className="px-3 py-2 font-mono text-gray-600 dark:text-gray-400 text-xs">
                        {row.serial_number}
                      </td>
                      <td className={`px-3 py-2 ${getReasonColor(row.last_down_reason)}`}>
                        {row.last_down_reason}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-gray-900 dark:text-white">
                        {row.days_since_last_inform}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${getBucketColor(row.offline_days_bucket)}`}>
                          {row.offline_days_bucket}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800
                        rounded-lg p-4 flex items-start gap-3">
          <XCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-red-800 dark:text-red-300">Import Error</p>
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        </div>
      )}

      {/* Import Button */}
      {previewData && !importResult && (
        <div className="flex justify-end gap-3">
          <button
            onClick={() => resetForm()}
            className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={isLoading}
            className="px-6 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700
                       disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                Import {previewData.totalRows.toLocaleString()} Records
              </>
            )}
          </button>
        </div>
      )}

      {/* Import Result */}
      {importResult && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800
                        rounded-lg p-6">
          <div className="flex items-start gap-3">
            <CheckCircle className="w-6 h-6 text-green-600 flex-shrink-0" />
            <div className="flex-1">
              <h3 className="font-semibold text-green-800 dark:text-green-300 text-lg">
                Import Complete
              </h3>
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                <div className="bg-white dark:bg-gray-800 rounded p-3 text-center">
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">
                    {importResult.totalRows.toLocaleString()}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Total</p>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded p-3 text-center">
                  <p className="text-2xl font-bold text-green-600">
                    {importResult.matchedDrops.toLocaleString()}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Matched Drops</p>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded p-3 text-center">
                  <p className="text-2xl font-bold text-blue-600">
                    {importResult.matchedOes.toLocaleString()}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Matched OES</p>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded p-3 text-center">
                  <p className="text-2xl font-bold text-yellow-600">
                    {importResult.unmatched.toLocaleString()}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Unmatched</p>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded p-3 text-center">
                  <p className="text-2xl font-bold text-red-600">
                    {importResult.serialMismatches.toLocaleString()}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Serial Mismatches</p>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded p-3 text-center">
                  <p className="text-2xl font-bold text-orange-600">
                    {importResult.alertsCreated.toLocaleString()}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Alerts Created</p>
                </div>
              </div>

              {importResult.serialMismatches > 0 && (
                <div className="mt-4 bg-red-50 dark:bg-red-900/30 rounded p-3">
                  <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                    <AlertTriangle className="w-4 h-4" />
                    <span className="font-medium">
                      {importResult.serialMismatches} serial mismatches detected!
                    </span>
                  </div>
                  <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                    These devices have different serials than recorded in OES. Review in Alerts tab.
                  </p>
                </div>
              )}

              {importResult.errors.length > 0 && (
                <div className="mt-4">
                  <div className="flex items-center gap-2 text-yellow-700 dark:text-yellow-400">
                    <AlertCircle className="w-4 h-4" />
                    <span className="font-medium">{importResult.errors.length} warnings</span>
                  </div>
                  <ul className="mt-2 text-sm text-gray-600 dark:text-gray-400 list-disc list-inside">
                    {importResult.errors.slice(0, 5).map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                    {importResult.errors.length > 5 && (
                      <li>...and {importResult.errors.length - 5} more</li>
                    )}
                  </ul>
                </div>
              )}

              <button
                onClick={() => resetForm(true)}
                className="mt-4 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
              >
                Import Another File
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
