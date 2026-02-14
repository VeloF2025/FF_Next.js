/**
 * Smartsheet Sync Panel
 * UI for managing Smartsheet synchronization
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, CheckCircle, XCircle, AlertTriangle, Clock, Settings, ChevronDown, ChevronUp, FileDown, Database, ArrowUpDown } from 'lucide-react';
import toast from 'react-hot-toast';
import { log } from '@/lib/logger';

interface SyncResult {
  success: boolean;
  historyId: string;
  stats: {
    processed: number;
    created: number;
    updated: number;
    skipped: number;
    errored: number;
  };
  errors: Array<{ ss_row_id: string; error: string }>;
  warnings: Array<{ ss_row_id: string; message: string }>;
  duration_ms: number;
}

interface SyncConfig {
  id: string;
  sheet_id: string;
  sheet_name: string | null;
  is_active: boolean;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_rows_processed: number | null;
}

interface SyncHistoryItem {
  id: string;
  sync_started_at: string;
  sync_completed_at: string | null;
  status: string;
  rows_processed: number;
  rows_created: number;
  rows_updated: number;
  rows_errored: number;
  duration_ms: number | null;
  triggered_by: string;
}

interface DocSyncResult {
  success: boolean;
  totalAttachments: number;
  downloaded: number;
  uploaded: number;
  linked: number;
  skipped: number;
  errors: Array<{ attachmentId: number; name: string; error: string }>;
  duration_ms: number;
}

interface SmartsheetSyncPanelProps {
  compact?: boolean;
  onSyncComplete?: () => void;
}

export function SmartsheetSyncPanel({ compact = false, onSyncComplete }: SmartsheetSyncPanelProps) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);
  const [configs, setConfigs] = useState<SyncConfig[]>([]);
  const [history, setHistory] = useState<SyncHistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Document sync state
  const [isDocSyncing, setIsDocSyncing] = useState(false);
  const [docSyncResult, setDocSyncResult] = useState<DocSyncResult | null>(null);
  const [docSyncError, setDocSyncError] = useState<string | null>(null);

  // Fetch sync configs
  const fetchConfigs = useCallback(async () => {
    try {
      const res = await fetch('/api/pipeline/smartsheet/config');
      const data = await res.json();
      if (data.configs) {
        setConfigs(data.configs);

        // Fetch history for first config
        if (data.configs.length > 0) {
          const histRes = await fetch(`/api/pipeline/smartsheet/history?configId=${data.configs[0].id}`);
          const histData = await histRes.json();
          if (histData.history) {
            setHistory(histData.history);
          }
        }
      }
    } catch (e) {
      log.error('Failed to fetch sync configs', { error: e }, 'SmartsheetSyncPanel');
    }
  }, []);

  useEffect(() => {
    fetchConfigs();
  }, [fetchConfigs]);

  // Trigger sync
  const handleSync = async () => {
    setIsSyncing(true);
    setError(null);
    setLastResult(null);

    try {
      const res = await fetch('/api/pipeline/smartsheet/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Sync failed');
      }

      setLastResult(data);
      fetchConfigs(); // Refresh configs and history
      onSyncComplete?.();

      // Show FibreFlow-style toast notification
      const syncResult = data as SyncResult;
      toast.custom(
        (t) => (
          <div
            className={`${
              t.visible ? 'animate-enter' : 'animate-leave'
            } max-w-md w-full bg-white dark:bg-gray-800 shadow-lg rounded-lg pointer-events-auto flex ring-1 ring-black ring-opacity-5`}
          >
            <div className="flex-1 w-0 p-4">
              <div className="flex items-start">
                <div className="flex-shrink-0 pt-0.5">
                  {syncResult.success ? (
                    <CheckCircle className="h-10 w-10 text-green-500" />
                  ) : syncResult.stats.errored > 0 ? (
                    <AlertTriangle className="h-10 w-10 text-yellow-500" />
                  ) : (
                    <XCircle className="h-10 w-10 text-red-500" />
                  )}
                </div>
                <div className="ml-3 flex-1">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    Smartsheet Sync Complete
                  </p>
                  <div className="mt-2 space-y-1">
                    <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                      <Database className="h-4 w-4 text-blue-500" />
                      <span>{syncResult.stats.processed.toLocaleString()} projects synced</span>
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                      <ArrowUpDown className="h-4 w-4 text-purple-500" />
                      <span className="text-green-600">+{syncResult.stats.created} new</span>
                      <span className="text-blue-600">~{syncResult.stats.updated} updated</span>
                      {syncResult.stats.errored > 0 && (
                        <span className="text-red-600">!{syncResult.stats.errored} errors</span>
                      )}
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    Duration: {(syncResult.duration_ms / 1000).toFixed(1)}s
                  </p>
                </div>
              </div>
            </div>
            <div className="flex border-l border-gray-200 dark:border-gray-700">
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
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Sync failed';
      setError(errorMsg);
      toast.error(`Smartsheet sync failed: ${errorMsg}`);
    } finally {
      setIsSyncing(false);
    }
  };

  // Trigger document sync
  const handleDocSync = async () => {
    setIsDocSyncing(true);
    setDocSyncError(null);
    setDocSyncResult(null);

    try {
      const res = await fetch('/api/pipeline/smartsheet/sync-documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skipExisting: true }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Document sync failed');
      }

      setDocSyncResult(data.data);
      onSyncComplete?.();

      // Show FibreFlow-style toast for document sync with detailed stats
      const docResult = data.data as DocSyncResult;
      const hasNewDocs = docResult.downloaded > 0;
      const hasErrors = docResult.errors.length > 0;

      toast.custom(
        (t) => (
          <div
            className={`${
              t.visible ? 'animate-enter' : 'animate-leave'
            } max-w-md w-full bg-white dark:bg-gray-800 shadow-lg rounded-lg pointer-events-auto flex ring-1 ring-black ring-opacity-5`}
          >
            <div className="flex-1 w-0 p-4">
              <div className="flex items-start">
                <div className="flex-shrink-0 pt-0.5">
                  {docResult.success && !hasErrors ? (
                    <CheckCircle className="h-10 w-10 text-green-500" />
                  ) : hasErrors ? (
                    <AlertTriangle className="h-10 w-10 text-yellow-500" />
                  ) : (
                    <CheckCircle className="h-10 w-10 text-green-500" />
                  )}
                </div>
                <div className="ml-3 flex-1">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    Document Sync Complete
                  </p>
                  <div className="mt-2 space-y-1">
                    {/* Total in Smartsheet */}
                    <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                      <FileDown className="h-4 w-4 text-blue-500" />
                      <span>{docResult.totalAttachments.toLocaleString()} total in Smartsheet</span>
                    </div>
                    {/* New documents synced */}
                    {hasNewDocs ? (
                      <div className="flex items-center gap-2 text-sm">
                        <CheckCircle className="h-4 w-4 text-green-500" />
                        <span className="text-green-600 font-medium">
                          +{docResult.linked} new documents synced
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                        <CheckCircle className="h-4 w-4 text-gray-400" />
                        <span>No new documents to sync</span>
                      </div>
                    )}
                    {/* Already synced */}
                    {docResult.skipped > 0 && (
                      <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                        <Database className="h-4 w-4 text-gray-400" />
                        <span>{docResult.skipped.toLocaleString()} already synced</span>
                      </div>
                    )}
                    {/* Errors */}
                    {hasErrors && (
                      <div className="flex items-center gap-2 text-sm text-red-600">
                        <XCircle className="h-4 w-4" />
                        <span>{docResult.errors.length} failed</span>
                      </div>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    Duration: {(docResult.duration_ms / 1000).toFixed(1)}s
                  </p>
                </div>
              </div>
            </div>
            <div className="flex border-l border-gray-200 dark:border-gray-700">
              <button
                onClick={() => toast.dismiss(t.id)}
                className="w-full border border-transparent rounded-none rounded-r-lg p-4 flex items-center justify-center text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-500 focus:outline-none"
              >
                Close
              </button>
            </div>
          </div>
        ),
        { duration: 8000 }
      );
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Document sync failed';
      setDocSyncError(errorMsg);
      toast.error(`Document sync failed: ${errorMsg}`);
    } finally {
      setIsDocSyncing(false);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    return new Date(dateStr).toLocaleString();
  };

  const formatDuration = (ms: number | null) => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const getStatusIcon = (status: string | null) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />;
      case 'partial':
        return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      case 'running':
        return <RefreshCw className="w-4 h-4 text-blue-500 animate-spin" />;
      default:
        return <Clock className="w-4 h-4 text-gray-400" />;
    }
  };

  // Compact mode - just a sync button with status
  if (compact) {
    const config = configs[0];
    return (
      <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Smartsheet Sync</span>
            {config && getStatusIcon(config.last_sync_status)}
          </div>
          {config?.last_sync_at && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Last: {formatDate(config.last_sync_at)}
              {config.last_sync_rows_processed && ` (${config.last_sync_rows_processed} rows)`}
            </p>
          )}
        </div>
        <button
          onClick={handleSync}
          disabled={isSyncing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
          {isSyncing ? 'Syncing...' : 'Sync'}
        </button>
      </div>
    );
  }

  // Full panel mode
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          <h3 className="font-medium text-gray-900 dark:text-gray-100">Smartsheet Sync</h3>
        </div>
        <button
          onClick={handleSync}
          disabled={isSyncing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
          {isSyncing ? 'Syncing...' : 'Sync Now'}
        </button>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        {/* Error message */}
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-md">
            <div className="flex items-center gap-2">
              <XCircle className="w-4 h-4 text-red-500" />
              <span className="text-sm text-red-700">{error}</span>
            </div>
          </div>
        )}

        {/* Last sync result */}
        {lastResult && (
          <div className={`p-3 rounded-md border ${lastResult.success ? 'bg-green-50 border-green-200' : 'bg-yellow-50 border-yellow-200'}`}>
            <div className="flex items-center gap-2 mb-2">
              {lastResult.success ? (
                <CheckCircle className="w-4 h-4 text-green-500" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-yellow-500" />
              )}
              <span className="text-sm font-medium">
                {lastResult.success ? 'Sync completed successfully' : 'Sync completed with warnings'}
              </span>
            </div>
            <div className="grid grid-cols-5 gap-2 text-xs">
              <div className="text-center">
                <div className="font-semibold text-gray-900 dark:text-gray-100">{lastResult.stats.processed}</div>
                <div className="text-gray-500 dark:text-gray-400">Processed</div>
              </div>
              <div className="text-center">
                <div className="font-semibold text-green-600">{lastResult.stats.created}</div>
                <div className="text-gray-500 dark:text-gray-400">Created</div>
              </div>
              <div className="text-center">
                <div className="font-semibold text-blue-600">{lastResult.stats.updated}</div>
                <div className="text-gray-500 dark:text-gray-400">Updated</div>
              </div>
              <div className="text-center">
                <div className="font-semibold text-gray-600 dark:text-gray-400">{lastResult.stats.skipped}</div>
                <div className="text-gray-500 dark:text-gray-400">Skipped</div>
              </div>
              <div className="text-center">
                <div className="font-semibold text-red-600">{lastResult.stats.errored}</div>
                <div className="text-gray-500 dark:text-gray-400">Errors</div>
              </div>
            </div>
            {lastResult.errors.length > 0 && (
              <div className="mt-2 text-xs text-red-600">
                {lastResult.errors.slice(0, 3).map((e, i) => (
                  <div key={i}>Row {e.ss_row_id}: {e.error}</div>
                ))}
                {lastResult.errors.length > 3 && (
                  <div>... and {lastResult.errors.length - 3} more errors</div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Document Sync Section */}
        <div className="p-3 bg-gray-50 dark:bg-gray-900 rounded-md border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <FileDown className="w-4 h-4 text-gray-500 dark:text-gray-400" />
              <span className="font-medium text-gray-900 dark:text-gray-100">Document Sync</span>
            </div>
            <button
              onClick={handleDocSync}
              disabled={isDocSyncing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <FileDown className={`w-4 h-4 ${isDocSyncing ? 'animate-pulse' : ''}`} />
              {isDocSyncing ? 'Syncing Docs...' : 'Sync Documents'}
            </button>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
            Downloads documents from Smartsheet and stores them on the Velocity server
          </p>

          {/* Document sync error */}
          {docSyncError && (
            <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
              <XCircle className="w-3 h-3 inline mr-1" />
              {docSyncError}
            </div>
          )}

          {/* Document sync result */}
          {docSyncResult && (
            <div className={`p-2 rounded border ${docSyncResult.success ? 'bg-green-50 border-green-200' : 'bg-yellow-50 border-yellow-200'}`}>
              <div className="flex items-center gap-1 mb-1">
                {docSyncResult.success ? (
                  <CheckCircle className="w-3 h-3 text-green-500" />
                ) : (
                  <AlertTriangle className="w-3 h-3 text-yellow-500" />
                )}
                <span className="text-xs font-medium">
                  {docSyncResult.success ? 'Documents synced' : 'Sync completed with errors'}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2 text-xs text-center">
                <div>
                  <div className="font-semibold">{docSyncResult.totalAttachments}</div>
                  <div className="text-gray-500 dark:text-gray-400">Total</div>
                </div>
                <div>
                  <div className="font-semibold text-blue-600">{docSyncResult.downloaded}</div>
                  <div className="text-gray-500 dark:text-gray-400">Downloaded</div>
                </div>
                <div>
                  <div className="font-semibold text-green-600">{docSyncResult.uploaded}</div>
                  <div className="text-gray-500 dark:text-gray-400">Uploaded</div>
                </div>
                <div>
                  <div className="font-semibold text-purple-600">{docSyncResult.linked}</div>
                  <div className="text-gray-500 dark:text-gray-400">Linked</div>
                </div>
              </div>
              {docSyncResult.errors.length > 0 && (
                <div className="mt-1 text-xs text-red-600">
                  {docSyncResult.errors.length} errors
                </div>
              )}
              <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Duration: {formatDuration(docSyncResult.duration_ms)}
              </div>
            </div>
          )}
        </div>

        {/* Config info */}
        {configs.length > 0 && (
          <div className="space-y-2">
            {configs.map((config) => (
              <div key={config.id} className="p-3 bg-gray-50 dark:bg-gray-900 rounded-md">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900 dark:text-gray-100">
                        {config.sheet_name || 'Velocity_Master_Tracker'}
                      </span>
                      {getStatusIcon(config.last_sync_status)}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      Sheet ID: {config.sheet_id}
                    </p>
                  </div>
                  <div className="text-right text-xs text-gray-500 dark:text-gray-400">
                    <div>Last sync: {formatDate(config.last_sync_at)}</div>
                    {config.last_sync_rows_processed && (
                      <div>{config.last_sync_rows_processed} rows processed</div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* History toggle */}
        {history.length > 0 && (
          <div>
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:text-gray-100"
            >
              {showHistory ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              Sync History ({history.length})
            </button>

            {showHistory && (
              <div className="mt-2 space-y-1">
                {history.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-900 rounded text-xs"
                  >
                    <div className="flex items-center gap-2">
                      {getStatusIcon(item.status)}
                      <span>{formatDate(item.sync_started_at)}</span>
                      <span className="text-gray-400">({item.triggered_by})</span>
                    </div>
                    <div className="flex items-center gap-3 text-gray-500 dark:text-gray-400">
                      <span>{item.rows_processed} rows</span>
                      <span className="text-green-600">+{item.rows_created}</span>
                      <span className="text-blue-600">~{item.rows_updated}</span>
                      {item.rows_errored > 0 && (
                        <span className="text-red-600">!{item.rows_errored}</span>
                      )}
                      <span>{formatDuration(item.duration_ms)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default SmartsheetSyncPanel;
