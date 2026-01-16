'use client';

import React, { useState, useCallback } from 'react';
import { Upload, FileSpreadsheet, CheckCircle, XCircle, AlertCircle, Loader2 } from 'lucide-react';

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
  matched: number;
  unmatched: number;
  alreadyImported: number;
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
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('action', 'preview');

      const response = await fetch('/api/dr-photo-unified/import-oes', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to parse file');
      }

      setPreviewData(result.preview || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse Excel file');
    } finally {
      setIsParsing(false);
    }
  };

  const handleImport = async () => {
    if (!file) return;

    setIsLoading(true);
    setError(null);
    setImportResult(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('action', 'import');
      formData.append('reportDate', reportDate);

      const response = await fetch('/api/dr-photo-unified/import-oes', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Import failed');
      }

      setImportResult(result);
      onImportComplete?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const resetForm = () => {
    setFile(null);
    setPreviewData([]);
    setImportResult(null);
    setError(null);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          OES Report Import
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Import Nokia OES activation reports to reconcile drops with actual activations.
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
          <p className="text-gray-600 dark:text-gray-400">
            Drag and drop OES Excel file here, or click to browse
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-500 mt-2">
            Supports .xlsx and .xls files
          </p>
        </div>
      )}

      {/* File Selected */}
      {file && !importResult && (
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="w-8 h-8 text-green-600" />
              <div>
                <p className="font-medium text-gray-900 dark:text-white">{file.name}</p>
                <p className="text-sm text-gray-500">
                  {(file.size / 1024).toFixed(1)} KB
                </p>
              </div>
            </div>
            <button
              onClick={resetForm}
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
          <span className="text-gray-600 dark:text-gray-400">Parsing file...</span>
        </div>
      )}

      {/* Preview Table */}
      {previewData.length > 0 && !importResult && (
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <div className="bg-gray-50 dark:bg-gray-800 px-4 py-2 border-b border-gray-200 dark:border-gray-700">
            <h3 className="font-medium text-gray-900 dark:text-white">
              Preview (first 10 rows of {previewData.length} total)
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-100 dark:bg-gray-700">
                <tr>
                  <th className="px-3 py-2 text-left text-gray-700 dark:text-gray-300">Drop Number</th>
                  <th className="px-3 py-2 text-left text-gray-700 dark:text-gray-300">Serial</th>
                  <th className="px-3 py-2 text-left text-gray-700 dark:text-gray-300">Date</th>
                  <th className="px-3 py-2 text-left text-gray-700 dark:text-gray-300">Status</th>
                  <th className="px-3 py-2 text-left text-gray-700 dark:text-gray-300">Team</th>
                  <th className="px-3 py-2 text-right text-gray-700 dark:text-gray-300">Link Budget</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {previewData.slice(0, 10).map((row, i) => (
                  <tr key={i} className="bg-white dark:bg-gray-800">
                    <td className="px-3 py-2 font-mono text-gray-900 dark:text-white">
                      {row.drop_number}
                    </td>
                    <td className="px-3 py-2 font-mono text-gray-600 dark:text-gray-400">
                      {row.serial_number}
                    </td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-400">
                      {row.activation_date}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium
                        ${row.status === 'Active'
                          ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300'
                          : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'}`}>
                        {row.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-400">
                      {row.team}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-gray-600 dark:text-gray-400">
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
            onClick={resetForm}
            className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800
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
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-gray-800 rounded p-3 text-center">
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">
                    {importResult.totalRows}
                  </p>
                  <p className="text-sm text-gray-500">Total Rows</p>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded p-3 text-center">
                  <p className="text-2xl font-bold text-green-600">
                    {importResult.matched}
                  </p>
                  <p className="text-sm text-gray-500">Matched</p>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded p-3 text-center">
                  <p className="text-2xl font-bold text-yellow-600">
                    {importResult.unmatched}
                  </p>
                  <p className="text-sm text-gray-500">Not in Drops</p>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded p-3 text-center">
                  <p className="text-2xl font-bold text-blue-600">
                    {importResult.alreadyImported}
                  </p>
                  <p className="text-sm text-gray-500">Already Imported</p>
                </div>
              </div>
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
                onClick={resetForm}
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
