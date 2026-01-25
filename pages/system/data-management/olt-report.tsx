/**
 * OLT Report Management Page
 *
 * Import Nokia OLT reports, view mismatches, and fix 1Map serials.
 *
 * Tabs:
 * - Import: Upload Excel file
 * - Pending: ONT vs 1Map mismatches awaiting fix
 * - History: Import history and fixed records
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import { useState, useCallback, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import {
  Upload,
  AlertTriangle,
  CheckCircle,
  Clock,
  FileSpreadsheet,
  RefreshCw,
  ExternalLink,
  Wrench,
  History,
  XCircle,
  Search,
} from 'lucide-react';

type TabId = 'import' | 'pending' | 'needs_investigation' | 'history';

interface OltRecord {
  id: string;
  drop_number: string;
  zone?: string | null;
  address?: string | null;
  olt_serial: string | null;
  onemap_serial?: string | null;
  wrong_onemap_serial?: string | null;
  onemap_prop_id?: string | null;
  offline_serial?: string | null;
  oes_serial?: string | null;
  onemap_fix_attempted?: boolean;
  onemap_fix_result?: string | null;
  onemap_fix_old_value?: string | null;
  onemap_fix_at?: string | null;
  fix_status?: string;
  fix_result?: string | null;
  fix_old_value?: string | null;
  status?: string;
  comparison_status?: string;
  row_index?: number;
  import_filename?: string;
  import_date?: string;
  project?: string;
}

interface ImportRecord {
  id: string;
  filename: string;
  project: string | null;
  total_records: number;
  match_count: number;
  mismatch_count: number;
  empty_serial_count: number;
  not_found_count: number;
  imported_at: string;
  imported_by_email: string | null;
}

interface Stats {
  pending: number;
  needs_investigation: number;
  fixed: number;
  empty: number;
  total: number;
}

export default function OltReportPage() {
  const [activeTab, setActiveTab] = useState<TabId>('pending');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Import state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [project, setProject] = useState<string>('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{
    success: boolean;
    stats: {
      totalRecords: number;
      matchCount: number;
      mismatchCount: number;
      emptySerialCount: number;
      updatedCount: number;
      alreadyFixedCount?: number;
      alreadyPendingCount?: number;
      needsReinvestigationCount?: number;
    };
  } | null>(null);

  // Data state
  const [records, setRecords] = useState<OltRecord[]>([]);
  const [imports, setImports] = useState<ImportRecord[]>([]);
  const [stats, setStats] = useState<Stats>({ pending: 0, needs_investigation: 0, fixed: 0, empty: 0, total: 0 });
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 50;

  // Fix state
  const [fixing, setFixing] = useState<string | null>(null);
  const [bulkFixing, setBulkFixing] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{
    current: number;
    total: number;
    success: number;
    failed: number;
    currentDR: string;
  } | null>(null);
  const [selectedRecords, setSelectedRecords] = useState<Set<string>>(new Set());

  // Import detail state
  const [selectedImportId, setSelectedImportId] = useState<string | null>(null);
  const [importDetail, setImportDetail] = useState<{
    import: ImportRecord;
    records: OltRecord[];
    activityLog: Array<{
      drop_number: string;
      event_type: string;
      event_data: Record<string, unknown>;
      created_at: string;
    }>;
    stats: { total: number; fixed: number; pending: number; empty: number };
  } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Projects state
  const [projects, setProjects] = useState<Array<{ id: string; project_name: string; project_code: string }>>([]);

  // Fetch active projects on mount
  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const res = await fetch('/api/projects?status=active&limit=100');
        if (res.ok) {
          const data = await res.json();
          setProjects(data.data?.projects || data.projects || []);
        }
      } catch {
        // Silently fail - projects dropdown will just be empty
      }
    };
    fetchProjects();
  }, []);

  // Fetch data based on active tab
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const view = activeTab === 'history' ? 'imports' : activeTab;
      const res = await fetch(
        `/api/system/olt-report?view=${view}&page=${page}&pageSize=${pageSize}`
      );

      if (!res.ok) throw new Error('Failed to fetch data');

      const data = await res.json();
      const result = data.data || data;

      if (activeTab === 'history') {
        setImports(result.imports || []);
      } else {
        setRecords(result.records || []);
        setStats(result.stats || { pending: 0, needs_investigation: 0, fixed: 0, empty: 0, total: 0 });
      }
      setTotal(result.total || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setIsLoading(false);
    }
  }, [activeTab, page]);

  useEffect(() => {
    if (activeTab !== 'import') {
      fetchData();
    }
  }, [fetchData, activeTab]);

  // Handle file upload
  const handleUpload = async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    setUploadResult(null);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      if (project) formData.append('project', project);

      const res = await fetch('/api/system/olt-report/import', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || 'Upload failed');
      }

      const data = await res.json();
      const result = data.data || data;
      setUploadResult(result);
      setSelectedFile(null);

      // Refresh pending list
      if (activeTab === 'pending') {
        fetchData();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  // Handle single fix
  const handleFix = async (record: OltRecord) => {
    if (!record.olt_serial) {
      alert('Cannot fix - empty ONT serial');
      return;
    }

    setFixing(record.drop_number);

    try {
      const res = await fetch('/api/system/olt-report/fix-1map', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          drNumber: record.drop_number,
          correctSerial: record.olt_serial,
          wrongSerial: record.onemap_serial,
        }),
      });

      const data = await res.json();
      const result = data.data || data;

      if (result.success) {
        alert(`Fixed! ${result.oldValue || 'EMPTY'} → ${result.newValue}`);
        fetchData();
      } else {
        alert(`Fix failed: ${result.error}`);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Fix failed');
    } finally {
      setFixing(null);
    }
  };

  // Handle bulk fix - processes one record at a time to avoid timeouts
  const handleBulkFix = async () => {
    const selected = records.filter(
      (r) => selectedRecords.has(r.id) && r.olt_serial
    );

    if (selected.length === 0) {
      alert('No records with valid ONT serials selected');
      return;
    }

    if (!confirm(`Fix ${selected.length} records in 1Map?\n\nRecords will be processed one at a time.`)) {
      return;
    }

    setBulkFixing(true);
    setBulkProgress({
      current: 0,
      total: selected.length,
      success: 0,
      failed: 0,
      currentDR: '',
    });

    let successCount = 0;
    let failCount = 0;
    const failedDRs: string[] = [];

    // Process one at a time to avoid timeout issues
    for (let i = 0; i < selected.length; i++) {
      const record = selected[i];

      setBulkProgress({
        current: i + 1,
        total: selected.length,
        success: successCount,
        failed: failCount,
        currentDR: record.drop_number,
      });

      try {
        const res = await fetch('/api/system/olt-report/fix-1map', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            drNumber: record.drop_number,
            correctSerial: record.olt_serial,
            wrongSerial: record.wrong_onemap_serial || record.onemap_serial,
          }),
        });

        const data = await res.json();
        const result = data.data || data;

        if (result.success) {
          successCount++;
        } else {
          failCount++;
          failedDRs.push(`${record.drop_number}: ${result.error || 'Unknown error'}`);
        }
      } catch (err) {
        failCount++;
        failedDRs.push(`${record.drop_number}: ${err instanceof Error ? err.message : 'Request failed'}`);
      }

      // Small delay between requests to be nice to 1Map
      if (i < selected.length - 1) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    setBulkProgress(null);
    setBulkFixing(false);
    setSelectedRecords(new Set());

    // Show results
    let message = `Bulk fix complete:\n✅ Success: ${successCount}\n❌ Failed: ${failCount}`;
    if (failedDRs.length > 0 && failedDRs.length <= 10) {
      message += `\n\nFailed records:\n${failedDRs.join('\n')}`;
    } else if (failedDRs.length > 10) {
      message += `\n\nFirst 10 failed records:\n${failedDRs.slice(0, 10).join('\n')}\n... and ${failedDRs.length - 10} more`;
    }
    alert(message);

    fetchData();
  };

  // Toggle record selection
  const toggleSelect = (id: string) => {
    setSelectedRecords((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Select all pending with valid ONT serial
  const selectAllPending = () => {
    const pending = records.filter(
      (r) => (r.fix_status === 'pending' || r.comparison_status === 'mismatch') && r.olt_serial
    );
    setSelectedRecords(new Set(pending.map((r) => r.id)));
  };

  // Fetch import detail for audit view
  const fetchImportDetail = async (importId: string) => {
    setLoadingDetail(true);
    setSelectedImportId(importId);
    try {
      const res = await fetch(`/api/system/olt-report/${importId}`);
      const data = await res.json();
      if (data.success) {
        setImportDetail(data.data);
      } else {
        alert('Failed to load import details');
        setSelectedImportId(null);
      }
    } catch {
      alert('Failed to load import details');
      setSelectedImportId(null);
    } finally {
      setLoadingDetail(false);
    }
  };

  // Close import detail modal
  const closeImportDetail = () => {
    setSelectedImportId(null);
    setImportDetail(null);
  };

  // Render tabs
  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'import', label: 'Import', icon: <Upload className="h-4 w-4" /> },
    {
      id: 'pending',
      label: `Fixable (${stats.pending})`,
      icon: <Wrench className="h-4 w-4" />,
    },
    {
      id: 'needs_investigation',
      label: `Investigate (${stats.needs_investigation})`,
      icon: <Search className="h-4 w-4" />,
    },
    {
      id: 'history',
      label: 'History',
      icon: <History className="h-4 w-4" />,
    },
  ];

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              OLT Report Management
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Import Nokia OLT reports and fix 1Map serial mismatches
            </p>
          </div>
          {activeTab !== 'import' && (
            <button
              onClick={fetchData}
              disabled={isLoading}
              className="flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          )}
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2 text-orange-600 dark:text-orange-400">
              <Wrench className="h-5 w-5" />
              <span className="font-medium">Fixable</span>
            </div>
            <div className="text-2xl font-bold mt-2 text-gray-900 dark:text-white">
              {stats.pending}
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2 text-yellow-600 dark:text-yellow-400">
              <Search className="h-5 w-5" />
              <span className="font-medium">Investigate</span>
            </div>
            <div className="text-2xl font-bold mt-2 text-gray-900 dark:text-white">
              {stats.needs_investigation}
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
              <CheckCircle className="h-5 w-5" />
              <span className="font-medium">Fixed</span>
            </div>
            <div className="text-2xl font-bold mt-2 text-gray-900 dark:text-white">
              {stats.fixed}
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
              <XCircle className="h-5 w-5" />
              <span className="font-medium">Empty ONT</span>
            </div>
            <div className="text-2xl font-bold mt-2 text-gray-900 dark:text-white">
              {stats.empty}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200 dark:border-gray-700">
          <nav className="flex space-x-4">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 ${
                  activeTab === tab.id
                    ? 'border-orange-500 text-orange-600 dark:text-orange-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Import Tab */}
        {activeTab === 'import' && (
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Import Nokia OLT Report
            </h2>

            <div className="space-y-4">
              {/* File Input */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Excel File
                </label>
                <div className="flex items-center gap-4">
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                    className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-orange-50 file:text-orange-700 hover:file:bg-orange-100 dark:file:bg-orange-900/30 dark:file:text-orange-400"
                  />
                  {selectedFile && (
                    <span className="text-sm text-gray-600 dark:text-gray-400 flex items-center gap-1">
                      <FileSpreadsheet className="h-4 w-4" />
                      {selectedFile.name}
                    </span>
                  )}
                </div>
              </div>

              {/* Project */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Project (Optional)
                </label>
                <select
                  value={project}
                  onChange={(e) => setProject(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value="">All Projects</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.project_code || p.project_name}>
                      {p.project_name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Column Info */}
              <div className="bg-gray-50 dark:bg-gray-700/50 rounded p-4 text-sm">
                <p className="font-medium text-gray-900 dark:text-white mb-2">
                  Expected Excel Format:
                </p>
                <ul className="list-disc list-inside text-gray-600 dark:text-gray-400 space-y-1">
                  <li>Column 0 (A): DR Number</li>
                  <li>Column 1 (B): ONT Serial (correct value from OLT)</li>
                  <li>Column 20 (U): &quot;Drop &amp; ONT SN on 1Map matches to OLT?&quot;</li>
                  <li>Column 21 (V): Wrong 1Map Serial (if mismatch)</li>
                </ul>
              </div>

              {/* Upload Button */}
              <button
                onClick={handleUpload}
                disabled={!selectedFile || isUploading}
                className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isUploading ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    Import Report
                  </>
                )}
              </button>

              {/* Upload Result */}
              {uploadResult && (
                <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                  <p className="font-medium text-green-800 dark:text-green-300">
                    Import Successful!
                  </p>
                  <ul className="mt-2 text-sm text-green-700 dark:text-green-400 space-y-1">
                    <li>Total Records: {uploadResult.stats.totalRecords}</li>
                    <li>Matches: {uploadResult.stats.matchCount}</li>
                    <li>Mismatches: {uploadResult.stats.mismatchCount}</li>
                    {uploadResult.stats.alreadyFixedCount !== undefined && uploadResult.stats.alreadyFixedCount > 0 && (
                      <li className="text-blue-600 dark:text-blue-400">
                        ✓ Already Fixed (skipped): {uploadResult.stats.alreadyFixedCount}
                      </li>
                    )}
                    {uploadResult.stats.alreadyPendingCount !== undefined && uploadResult.stats.alreadyPendingCount > 0 && (
                      <li className="text-yellow-600 dark:text-yellow-400">
                        ↺ Already Pending (updated): {uploadResult.stats.alreadyPendingCount}
                      </li>
                    )}
                    {uploadResult.stats.needsReinvestigationCount !== undefined && uploadResult.stats.needsReinvestigationCount > 0 && (
                      <li className="text-orange-600 dark:text-orange-400">
                        ⚠ Needs Re-investigation: {uploadResult.stats.needsReinvestigationCount}
                      </li>
                    )}
                    <li>Empty ONT (skipped): {uploadResult.stats.emptySerialCount}</li>
                    <li>New Records: {uploadResult.stats.updatedCount}</li>
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Pending / Needs Investigation Tab */}
        {(activeTab === 'pending' || activeTab === 'needs_investigation') && (
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            {/* Bulk Actions - only for fixable pending */}
            {activeTab === 'pending' && (selectedRecords.size > 0 || bulkProgress) && (
              <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-orange-50 dark:bg-orange-900/20">
                {bulkProgress ? (
                  // Progress indicator during bulk fix
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-orange-800 dark:text-orange-300">
                        Processing {bulkProgress.current} of {bulkProgress.total}...
                      </span>
                      <span className="text-xs text-gray-600 dark:text-gray-400">
                        ✅ {bulkProgress.success} | ❌ {bulkProgress.failed}
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                      <div
                        className="bg-orange-600 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${(bulkProgress.current / bulkProgress.total) * 100}%` }}
                      />
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                      <RefreshCw className="h-3 w-3 animate-spin" />
                      <span>Fixing {bulkProgress.currentDR}...</span>
                    </div>
                  </div>
                ) : (
                  // Selection controls
                  <div className="flex items-center gap-4">
                    <span className="text-sm font-medium text-orange-800 dark:text-orange-300">
                      {selectedRecords.size} selected
                    </span>
                    <button
                      onClick={handleBulkFix}
                      disabled={bulkFixing}
                      className="flex items-center gap-1 px-3 py-1.5 bg-orange-600 text-white rounded text-sm hover:bg-orange-700 disabled:opacity-50"
                    >
                      <Wrench className="h-4 w-4" />
                      Fix Selected in 1Map
                    </button>
                    <button
                      onClick={() => setSelectedRecords(new Set())}
                      className="text-sm text-gray-600 dark:text-gray-400 hover:underline"
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Select All - only for fixable */}
            {activeTab === 'pending' && (
              <div className="p-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-4">
                <button
                  onClick={selectAllPending}
                  className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Select all with valid ONT serial
                </button>
              </div>
            )}
            {activeTab === 'needs_investigation' && (
              <div className="p-3 border-b border-gray-200 dark:border-gray-700">
                <span className="text-sm text-yellow-600 dark:text-yellow-400">
                  ⚠️ These records need manual investigation - missing 1Map serial data
                </span>
              </div>
            )}

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="w-8 px-3 py-3"></th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                      DR
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                      Zone
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase" title="ONT Serial (correct, from OLT report)">
                      ONT
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase" title="Current 1Map Serial">
                      1Map
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                      Status
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {isLoading ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                        <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2" />
                        Loading...
                      </td>
                    </tr>
                  ) : records.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                        <CheckCircle className="h-6 w-6 mx-auto mb-2 text-green-500" />
                        No pending mismatches
                      </td>
                    </tr>
                  ) : (
                    records.map((record) => {
                      // Records in pending/investigate tabs ARE mismatches by definition
                      // They're from olt_mismatch_records which only contains mismatches
                      const isMismatch = activeTab === 'pending' || activeTab === 'needs_investigation' || record.comparison_status === 'mismatch';
                      const isEmpty = !record.olt_serial;

                      return (
                        <tr
                          key={record.id}
                          className={`hover:bg-gray-50 dark:hover:bg-gray-700/50 ${
                            isEmpty ? 'bg-yellow-50 dark:bg-yellow-900/10' : ''
                          }`}
                        >
                          <td className="px-3 py-3">
                            <input
                              type="checkbox"
                              checked={selectedRecords.has(record.id)}
                              onChange={() => toggleSelect(record.id)}
                              disabled={isEmpty}
                              className="rounded border-gray-300 dark:border-gray-600"
                            />
                          </td>
                          <td className="px-3 py-3">
                            <a
                              href={`/activate/${record.drop_number}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:underline flex items-center gap-1"
                            >
                              {record.drop_number}
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </td>
                          <td className="px-3 py-3 text-sm text-gray-900 dark:text-gray-100">
                            {record.zone || '-'}
                          </td>
                          <td className="px-3 py-3">
                            {record.olt_serial ? (
                              <span className="font-mono text-xs text-green-600 dark:text-green-400">
                                {record.olt_serial}
                              </span>
                            ) : (
                              <span className="text-xs text-yellow-600 dark:text-yellow-400 italic">
                                empty
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-3">
                            {(record.wrong_onemap_serial || record.onemap_serial) ? (
                              <span
                                className={`font-mono text-xs ${
                                  isMismatch
                                    ? 'text-red-600 dark:text-red-400'
                                    : 'text-green-600 dark:text-green-400'
                                }`}
                              >
                                {record.wrong_onemap_serial || record.onemap_serial}
                              </span>
                            ) : (
                              <span className="text-xs text-gray-400 italic">none</span>
                            )}
                          </td>
                          <td className="px-3 py-3">
                            {record.onemap_fix_result === 'success' ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                                <CheckCircle className="h-3 w-3" />
                                Fixed
                              </span>
                            ) : isEmpty ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
                                <XCircle className="h-3 w-3" />
                                Empty
                              </span>
                            ) : isMismatch ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                                <AlertTriangle className="h-3 w-3" />
                                Mismatch
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300">
                                <Clock className="h-3 w-3" />
                                {record.comparison_status}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-3">
                            {activeTab === 'pending' && isMismatch && !isEmpty && (
                              <button
                                onClick={() => handleFix(record)}
                                disabled={fixing === record.drop_number}
                                className="flex items-center gap-1 px-2 py-1 text-xs bg-orange-600 text-white rounded hover:bg-orange-700 disabled:opacity-50"
                              >
                                {fixing === record.drop_number ? (
                                  <RefreshCw className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Wrench className="h-3 w-3" />
                                )}
                                Fix
                              </button>
                            )}
                            {activeTab === 'needs_investigation' && (
                              <a
                                href={`https://www.1map.co.za/app?layer=5121&search=${record.drop_number}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                              >
                                <ExternalLink className="h-3 w-3" />
                                1Map
                              </a>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {total > pageSize && (
              <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  Page {page} of {Math.ceil(total / pageSize)}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setPage((p) => p + 1)}
                    disabled={page * pageSize >= total}
                    className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* History Tab */}
        {activeTab === 'history' && (
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                    Filename
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                    Project
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                    Records
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                    Mismatches
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                    Empty
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                    Imported
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                    By
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {isLoading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                      Loading...
                    </td>
                  </tr>
                ) : imports.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                      No imports yet
                    </td>
                  </tr>
                ) : (
                  imports.map((imp) => (
                    <tr
                      key={imp.id}
                      className="hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
                      onClick={() => fetchImportDetail(imp.id)}
                    >
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">
                        <span className="flex items-center gap-2">
                          <FileSpreadsheet className="h-4 w-4 text-green-600" />
                          <span className="text-blue-600 dark:text-blue-400 hover:underline">
                            {imp.filename}
                          </span>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                        {imp.project || '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">
                        {imp.total_records}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-red-600 dark:text-red-400">
                          {imp.mismatch_count}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-yellow-600 dark:text-yellow-400">
                          {imp.empty_serial_count}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                        {new Date(imp.imported_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                        {imp.imported_by_email || '-'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Import Detail Modal */}
      {selectedImportId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  Import Audit Trail
                </h2>
                {importDetail && (
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    {importDetail.import.filename}
                  </p>
                )}
              </div>
              <button
                onClick={closeImportDetail}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              >
                <XCircle className="h-5 w-5 text-gray-500" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto p-6">
              {loadingDetail ? (
                <div className="flex items-center justify-center py-12">
                  <RefreshCw className="h-6 w-6 animate-spin text-blue-500" />
                  <span className="ml-2 text-gray-600 dark:text-gray-400">Loading...</span>
                </div>
              ) : importDetail ? (
                <div className="space-y-6">
                  {/* Stats */}
                  <div className="grid grid-cols-4 gap-4">
                    <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4">
                      <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                        {importDetail.stats.total}
                      </div>
                      <div className="text-sm text-gray-500">Total Mismatches</div>
                    </div>
                    <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4">
                      <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                        {importDetail.stats.fixed}
                      </div>
                      <div className="text-sm text-green-600 dark:text-green-400">Fixed</div>
                    </div>
                    <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4">
                      <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                        {importDetail.stats.pending}
                      </div>
                      <div className="text-sm text-red-600 dark:text-red-400">Pending</div>
                    </div>
                    <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-4">
                      <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
                        {importDetail.stats.empty}
                      </div>
                      <div className="text-sm text-yellow-600 dark:text-yellow-400">Empty ONT</div>
                    </div>
                  </div>

                  {/* Records Table */}
                  <div>
                    <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-3">
                      Mismatch Records ({importDetail.records.length})
                    </h3>
                    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 dark:bg-gray-700">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">DR</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">ONT (Correct)</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">1Map (Wrong)</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Old Value</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Fixed At</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                          {importDetail.records.map((rec) => (
                            <tr key={rec.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                              <td className="px-3 py-2 font-mono text-blue-600 dark:text-blue-400">
                                {rec.drop_number}
                              </td>
                              <td className="px-3 py-2 font-mono text-green-600 dark:text-green-400">
                                {rec.olt_serial || '-'}
                              </td>
                              <td className="px-3 py-2 font-mono text-red-600 dark:text-red-400">
                                {rec.wrong_onemap_serial || '-'}
                              </td>
                              <td className="px-3 py-2">
                                {rec.fix_status === 'fixed' ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                                    <CheckCircle className="h-3 w-3" />
                                    Fixed
                                  </span>
                                ) : rec.fix_status === 'empty_serial' ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
                                    <AlertTriangle className="h-3 w-3" />
                                    Empty
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                                    <Clock className="h-3 w-3" />
                                    Pending
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2 font-mono text-gray-500">
                                {rec.fix_old_value || '-'}
                              </td>
                              <td className="px-3 py-2 text-gray-500 text-xs">
                                {rec.fix_status === 'fixed' && rec.onemap_fix_at
                                  ? new Date(rec.onemap_fix_at).toLocaleString()
                                  : '-'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Activity Log */}
                  {importDetail.activityLog.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-3">
                        Activity Log ({importDetail.activityLog.length})
                      </h3>
                      <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden max-h-64 overflow-y-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 dark:bg-gray-700 sticky top-0">
                            <tr>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">DR</th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Event</th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Details</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                            {importDetail.activityLog.map((log, idx) => (
                              <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                                <td className="px-3 py-2 text-xs text-gray-500">
                                  {new Date(log.created_at).toLocaleString()}
                                </td>
                                <td className="px-3 py-2 font-mono text-blue-600 dark:text-blue-400">
                                  {log.drop_number}
                                </td>
                                <td className="px-3 py-2">
                                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs ${
                                    log.event_type === 'SERIAL_UPDATE'
                                      ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                                      : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                                  }`}>
                                    {log.event_type}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-400">
                                  {(log.event_data as { details?: string; message?: string })?.details ||
                                   (log.event_data as { message?: string })?.message ||
                                   JSON.stringify(log.event_data)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
