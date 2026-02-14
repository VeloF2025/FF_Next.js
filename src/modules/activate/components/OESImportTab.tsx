'use client';

import React, { useState, useCallback } from 'react';
import { Upload, FileSpreadsheet, CheckCircle, XCircle, AlertCircle, Loader2, Database, CloudCog } from 'lucide-react';
import toast from 'react-hot-toast';
import { ImportProgressOverlay, type ImportPhase } from './ImportProgressOverlay';

interface OESRow {
  drop_number: string;
  serial_number: string;
  activation_date: string;
  olt_address: string;
  ont_rx_sig_dbm: number | null;
  link_budget_ont_olt_db: number | null;
  olt_rx_sig_dbm: number | null;
  link_budget_olt_ont_db: number | null;
  status: string;
  latitude: number | null;
  longitude: number | null;
  current_ont_rx: number | null;
  team: string;
}

interface ImportResult {
  totalRows: number;
  inserted: number;
  updated: number;
  matched: number;
  unmatched: number;
  errors: string[];
}

interface OESImportTabProps {
  onImportComplete?: () => void;
}

export function OESImportTab({ onImportComplete }: OESImportTabProps) {
  const [file, setFile] = useState<File | null>(null);
  const [reportDate, setReportDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [previewData, setPreviewData] = useState<OESRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [isSyncingToQField, setIsSyncingToQField] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qfieldSyncResult, setQFieldSyncResult] = useState<{
    success: boolean;
    message: string;
    totalPoints?: number;
  } | null>(null);
  const [importPhase, setImportPhase] = useState<ImportPhase | null>(null);
  const [formatWarnings, setFormatWarnings] = useState<string[]>([]);

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

  const parseExcel = async (file: File) => {
    setIsParsing(true);
    setImportPhase('parsing');
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('action', 'preview');

      const response = await fetch('/api/activate/import-oes', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to parse file');
      }

      setPreviewData(result.preview || []);

      // Handle format warnings
      if (result.warnings && result.warnings.length > 0) {
        setFormatWarnings(result.warnings);
        toast.error(`⚠️ Format warnings detected! Check the warnings below before importing.`, {
          duration: 5000,
        });
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

  const syncToQFieldCloud = async () => {
    setIsSyncingToQField(true);
    setQFieldSyncResult(null);
    setError(null);

    try {
      // Trigger the VPS sync webhook instead of direct API call
      const response = await fetch('/api/activate/trigger-qfield-sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          force: true, // Force sync even if recently synced
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Sync trigger failed');
      }

      // Show success with webhook details
      setQFieldSyncResult({
        success: true,
        message: 'QFieldCloud sync triggered successfully via VPS webhook',
        totalPoints: importResult?.matched || 0,
        ...result
      });

      // Show toast notification
      toast.success('OES data sync to QFieldCloud started! Check QField app in 1-2 minutes.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to trigger QFieldCloud sync');
    } finally {
      setIsSyncingToQField(false);
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

      const response = await fetch('/api/activate/import-oes', {
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

      // Show success toast with CONFIRMED sync statuses only
      // IMPORTANT: Only show checkmarks when we have actual confirmation
      const dbConfirmed = result.dbSyncConfirmed === true;
      const qfieldConfirmed = result.qfieldSyncStatus?.success === true;

      toast.custom(
        (t) => (
          <div
            className={`${
              t.visible ? 'animate-enter' : 'animate-leave'
            } max-w-md w-full bg-card shadow-lg rounded-lg pointer-events-auto flex ring-1 ring-black ring-opacity-5`}
          >
            <div className="flex-1 w-0 p-4">
              <div className="flex items-start">
                <div className="flex-shrink-0 pt-0.5">
                  {dbConfirmed && qfieldConfirmed ? (
                    <CheckCircle className="h-10 w-10 text-green-500" />
                  ) : dbConfirmed ? (
                    <AlertCircle className="h-10 w-10 text-yellow-500" />
                  ) : (
                    <XCircle className="h-10 w-10 text-red-500" />
                  )}
                </div>
                <div className="ml-3 flex-1">
                  <p className="text-sm font-medium text-foreground">
                    {dbConfirmed && qfieldConfirmed
                      ? 'OES Import Complete'
                      : dbConfirmed
                      ? 'OES Import Partial'
                      : 'OES Import Failed'}
                  </p>
                  <div className="mt-2 space-y-1">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Database className="h-4 w-4 text-blue-500" />
                      <span>Uploaded to FibreFlow Database</span>
                      {dbConfirmed ? (
                        <CheckCircle className="h-4 w-4 text-green-500" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-500" />
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <CloudCog className="h-4 w-4 text-purple-500" />
                      <span>
                        {qfieldConfirmed
                          ? 'Synced to QField Database'
                          : result.qfieldSyncStatus?.message || 'QField sync failed'}
                      </span>
                      {qfieldConfirmed ? (
                        <CheckCircle className="h-4 w-4 text-green-500" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-500" />
                      )}
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {result.totalRows.toLocaleString()} records processed
                    {qfieldConfirmed && result.qfieldSyncStatus?.recordCount && (
                      <span> • {result.qfieldSyncStatus.recordCount.toLocaleString()} synced to QField</span>
                    )}
                  </p>
                </div>
              </div>
            </div>
            <div className="flex border-l border-border">
              <button
                onClick={() => toast.dismiss(t.id)}
                className="w-full border border-transparent rounded-none rounded-r-lg p-4 flex items-center justify-center text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-500 focus:outline-none"
              >
                Close
              </button>
            </div>
          </div>
        ),
        { duration: 6000 }
      );

      // Don't call onImportComplete here - let user see results first
      // Will be called when user clicks "Import Another File"
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
    setPreviewData([]);
    setImportResult(null);
    setError(null);
    setFormatWarnings([]);
    if (triggerRefresh) {
      onImportComplete?.();
    }
  };

  return (
    <div className="space-y-6">
      {/* Import Progress Overlay */}
      <ImportProgressOverlay
        isVisible={importPhase !== null}
        phase={importPhase || 'parsing'}
        title="OES Import"
        recordCount={previewData.length || undefined}
        showDatabaseSync={true}
        showQFieldSync={true}
      />

      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-foreground">
          OES Report Import
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Import Nokia OES activation reports to reconcile drops with actual activations.
        </p>
      </div>

      {/* Date Picker */}
      <div className="max-w-xs">
        <label className="block text-sm font-medium text-muted-foreground mb-1">
          Report Date
        </label>
        <input
          type="date"
          value={reportDate}
          onChange={(e) => setReportDate(e.target.value)}
          className="w-full px-3 py-2 border border-border rounded-md
                     bg-card text-foreground
                     focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      {/* File Drop Zone */}
      {!file && (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          className="border-2 border-dashed border-border rounded-lg p-8
                     text-center hover:border-blue-500 dark:hover:border-blue-400 transition-colors
                     cursor-pointer"
          onClick={() => document.getElementById('oes-file-input')?.click()}
        >
          <input
            id="oes-file-input"
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFileSelect}
            className="hidden"
          />
          <Upload className="w-12 h-12 mx-auto text-gray-400 mb-4" />
          <p className="text-muted-foreground">
            Drag and drop OES Excel file here, or click to browse
          </p>
          <p className="text-sm text-muted-foreground dark:text-gray-400 mt-2">
            Supports .xlsx and .xls files
          </p>
        </div>
      )}

      {/* File Selected */}
      {file && !importResult && (
        <div className="bg-input rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="w-8 h-8 text-green-600" />
              <div>
                <p className="font-medium text-foreground">{file.name}</p>
                <p className="text-sm text-muted-foreground">
                  {(file.size / 1024).toFixed(1)} KB
                </p>
              </div>
            </div>
            <button
              onClick={() => resetForm()}
              className="text-sm text-red-600 hover:text-red-700"
            >
              Remove
            </button>
          </div>
        </div>
      )}

      {/* Parsing Indicator */}
      {isParsing && (
        <div className="flex items-center justify-center gap-2 py-4">
          <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
          <span className="text-muted-foreground">Parsing file...</span>
        </div>
      )}

      {/* Format Warnings */}
      {formatWarnings.length > 0 && !importResult && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
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

      {/* Preview Table */}
      {previewData.length > 0 && !importResult && (
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="bg-input px-4 py-2 border-b border-border">
            <h3 className="font-medium text-foreground">
              Preview (first 10 rows of {previewData.length} total)
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary">
                <tr>
                  <th className="px-3 py-2 text-left text-muted-foreground">Drop Number</th>
                  <th className="px-3 py-2 text-left text-muted-foreground">Serial</th>
                  <th className="px-3 py-2 text-left text-muted-foreground">Date</th>
                  <th className="px-3 py-2 text-left text-muted-foreground">Status</th>
                  <th className="px-3 py-2 text-left text-muted-foreground">Team</th>
                  <th className="px-3 py-2 text-right text-muted-foreground">Link Budget</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {previewData.slice(0, 10).map((row, i) => (
                  <tr key={i} className="bg-card">
                    <td className="px-3 py-2 font-mono text-foreground">
                      {row.drop_number}
                    </td>
                    <td className="px-3 py-2 font-mono text-muted-foreground">
                      {row.serial_number}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {row.activation_date}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium
                        ${row.status === 'Active'
                          ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300'
                          : 'bg-secondary text-gray-800 dark:bg-gray-700 dark:text-gray-300'}`}>
                        {row.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {row.team}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                      {row.link_budget_ont_olt_db?.toFixed(1) || '-'} dB
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
      {previewData.length > 0 && !importResult && (
        <div className="flex justify-end gap-3">
          <button
            onClick={() => resetForm()}
            className="px-4 py-2 text-muted-foreground hover:text-gray-800
                       dark:hover:text-gray-200"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={isLoading}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700
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
                Import {previewData.length} Records
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
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-4">
                <div className="bg-card rounded p-3 text-center">
                  <p className="text-2xl font-bold text-foreground">
                    {importResult.totalRows}
                  </p>
                  <p className="text-sm text-muted-foreground">Total Rows</p>
                </div>
                <div className="bg-card rounded p-3 text-center">
                  <p className="text-2xl font-bold text-green-600">
                    {importResult.inserted}
                  </p>
                  <p className="text-sm text-muted-foreground">New Inserts</p>
                </div>
                <div className="bg-card rounded p-3 text-center">
                  <p className="text-2xl font-bold text-blue-600">
                    {importResult.updated}
                  </p>
                  <p className="text-sm text-muted-foreground">Updated</p>
                </div>
                <div className="bg-card rounded p-3 text-center">
                  <p className="text-2xl font-bold text-emerald-600">
                    {importResult.matched}
                  </p>
                  <p className="text-sm text-muted-foreground">Matched Drops</p>
                </div>
                <div className="bg-card rounded p-3 text-center">
                  <p className="text-2xl font-bold text-yellow-600">
                    {importResult.unmatched}
                  </p>
                  <p className="text-sm text-muted-foreground">Not in Drops</p>
                </div>
              </div>
              {importResult.errors.length > 0 && (
                <div className="mt-4">
                  <div className="flex items-center gap-2 text-yellow-700 dark:text-yellow-400">
                    <AlertCircle className="w-4 h-4" />
                    <span className="font-medium">{importResult.errors.length} warnings</span>
                  </div>
                  <ul className="mt-2 text-sm text-muted-foreground list-disc list-inside">
                    {importResult.errors.slice(0, 5).map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                    {importResult.errors.length > 5 && (
                      <li>...and {importResult.errors.length - 5} more</li>
                    )}
                  </ul>
                </div>
              )}
              <div className="mt-4 flex gap-3">
                <button
                  onClick={() => resetForm(true)}
                  className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                >
                  Import Another File
                </button>
                <button
                  onClick={syncToQFieldCloud}
                  disabled={isSyncingToQField}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700
                             disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {isSyncingToQField ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Syncing to QFieldCloud...
                    </>
                  ) : (
                    <>
                      📍 Sync to QFieldCloud Map
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* QFieldCloud Sync Result */}
      {qfieldSyncResult && (
        <div className={`${qfieldSyncResult.success ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800' : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'}
                        border rounded-lg p-4 mt-4`}>
          <div className="flex items-start gap-3">
            {qfieldSyncResult.success ? (
              <CheckCircle className="w-5 h-5 text-blue-600 flex-shrink-0" />
            ) : (
              <XCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
            )}
            <div>
              <p className={`font-medium ${qfieldSyncResult.success ? 'text-blue-800 dark:text-blue-300' : 'text-red-800 dark:text-red-300'}`}>
                {qfieldSyncResult.message}
              </p>
              {qfieldSyncResult.totalPoints && (
                <p className="text-sm text-muted-foreground mt-1">
                  {qfieldSyncResult.totalPoints} drop locations synced to QFieldCloud as "OES Report" layer with DR number labels
                </p>
              )}
              <p className="text-sm text-muted-foreground dark:text-gray-400 mt-2">
                ✓ Points display with drop numbers visible on map<br/>
                ✓ Data available in QField mobile app after sync
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
