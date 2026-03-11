/**
 * ThreeWayAlignmentReport Component
 *
 * 🟢 WORKING: Compares Excel (source of truth), FibreFlow, and QContact tickets
 *
 * Features:
 * - Excel file upload
 * - 3-way comparison summary
 * - Status mismatch detection
 * - Bulk fix capability with dry-run support
 */

'use client';

import React, { useState, useCallback } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Upload,
  AlertTriangle,
  ArrowRight,
  XCircle,
  Eye,
  Play,
  FileSpreadsheet,
  Database,
  MessageSquare,
} from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { cn } from '@/lib/utils';

// Excel parsing
import * as XLSX from 'xlsx';

// Types matching API response
interface ExcelTicketRow {
  row_number: number;
  status: string;
  ft_ref: string;
  dr_number: string;
  issue?: string;
  area?: string;
}

interface StatusMismatch {
  ft_ref: string;
  dr_number?: string;
  excel_status: string;
  fibreflow_status?: string;
  qcontact_status?: string;
  fibreflow_ticket_uid?: string;
}

interface AlignmentAction {
  action: 'create_in_fibreflow' | 'update_status' | 'link_tickets' | 'archive';
  ft_ref: string;
  dr_number?: string;
  source: 'excel' | 'fibreflow' | 'qcontact';
  details: string;
  priority: 'high' | 'medium' | 'low';
}

interface ThreeWayReport {
  generated_at: string;
  sources: {
    excel: { total: number; resolved: number; in_progress: number };
    fibreflow: { total: number; from_qcontact: number };
    qcontact: { total: number; available: boolean };
  };
  summary: {
    in_all_three: number;
    in_excel_and_fibreflow: number;
    in_excel_and_qcontact: number;
    in_excel_only: number;
    in_fibreflow_only: number;
    status_mismatches: number;
  };
  details: {
    in_excel_only: ExcelTicketRow[];
    in_fibreflow_only: Array<{
      id: string;
      ticket_uid: string;
      external_id: string | null;
      title: string;
      status: string;
    }>;
    status_mismatches: StatusMismatch[];
  };
  suggested_actions: AlignmentAction[];
}

interface ApplyResult {
  success: boolean;
  applied: number;
  skipped: number;
  errors: Array<{ action: AlignmentAction; error: string }>;
}

// Fetch 3-way alignment report
async function fetchThreeWayReport(rows: any[][], headers?: string[]): Promise<ThreeWayReport> {
  const response = await fetch('/api/noc/alignment/three-way', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows, headers }),
  });
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.error?.message || 'Failed to fetch alignment report');
  }
  return data.data;
}

// Apply alignment actions
async function applyActions(actions: AlignmentAction[], dryRun: boolean): Promise<ApplyResult> {
  const response = await fetch('/api/noc/alignment/three-way-apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actions, dryRun }),
  });
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.error?.message || 'Failed to apply actions');
  }
  return data.data;
}

export function ThreeWayAlignmentReport() {
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ThreeWayReport | null>(null);
  const [selectedActions, setSelectedActions] = useState<Set<number>>(new Set());
  const [lastApplyResult, setLastApplyResult] = useState<ApplyResult | null>(null);

  // Mutation for generating report
  const generateMutation = useMutation({
    mutationFn: async (file: File) => {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });

      // Auto-detect sheet with FT refs (look for "MNT Tickets Logged" or sheet with FT data)
      let targetSheet = workbook.SheetNames[0];
      for (const name of workbook.SheetNames) {
        // Prefer "MNT Tickets Logged" sheet
        if (name.toLowerCase().includes('tickets') || name.toLowerCase().includes('mnt')) {
          const sheet = workbook.Sheets[name];
          const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });
          // Check if this sheet has FT refs
          for (let r = 1; r < Math.min(10, rows.length); r++) {
            const row = rows[r] || [];
            for (const cell of row) {
              if (String(cell).startsWith('FT')) {
                targetSheet = name;
                break;
              }
            }
            if (targetSheet === name) break;
          }
        }
        if (targetSheet !== workbook.SheetNames[0]) break;
      }

      const sheet = workbook.Sheets[targetSheet];
      const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });

      // First row is headers
      const headers = rows[0] as string[];
      const dataRows = rows.slice(1);

      return fetchThreeWayReport(dataRows, headers);
    },
    onSuccess: (data) => {
      setReport(data);
      setSelectedActions(new Set());
    },
  });

  // Mutation for applying actions
  const applyMutation = useMutation({
    mutationFn: ({ actions, dryRun }: { actions: AlignmentAction[]; dryRun: boolean }) =>
      applyActions(actions, dryRun),
    onSuccess: (result) => {
      setLastApplyResult(result);
      if (!result.dry_run) {
        setSelectedActions(new Set());
        // Re-generate report after apply
        if (file) {
          generateMutation.mutate(file);
        }
      }
    },
  });

  // Handle file selection
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setReport(null);
      setLastApplyResult(null);
    }
  }, []);

  // Handle generate
  const handleGenerate = () => {
    if (file) {
      generateMutation.mutate(file);
    }
  };

  // Toggle action selection
  const toggleAction = (idx: number) => {
    const newSelected = new Set(selectedActions);
    if (newSelected.has(idx)) {
      newSelected.delete(idx);
    } else {
      newSelected.add(idx);
    }
    setSelectedActions(newSelected);
  };

  // Select all status update actions
  const selectAllStatusUpdates = () => {
    if (!report) return;
    const updateIndices = report.suggested_actions
      .map((a, idx) => (a.action === 'update_status' ? idx : -1))
      .filter((idx) => idx !== -1);
    setSelectedActions(new Set(updateIndices));
  };

  // Build selected actions
  const getSelectedActions = (): AlignmentAction[] => {
    if (!report) return [];
    return [...selectedActions].map((idx) => report.suggested_actions[idx]);
  };

  // Handle preview/apply
  const handlePreview = () => {
    const actions = getSelectedActions();
    if (actions.length > 0) {
      applyMutation.mutate({ actions, dryRun: true });
    }
  };

  const handleApply = () => {
    const actions = getSelectedActions();
    if (actions.length > 0) {
      applyMutation.mutate({ actions, dryRun: false });
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high':
        return 'text-red-400 bg-red-500/20';
      case 'medium':
        return 'text-yellow-400 bg-yellow-500/20';
      default:
        return 'text-blue-400 bg-blue-500/20';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">3-Way Alignment</h3>
        <p className="text-sm text-[var(--ff-text-secondary)]">
          Compare Excel sheet (source of truth), FibreFlow, and QContact tickets
        </p>
      </div>

      {/* File Upload */}
      <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-6">
        <div className="flex items-center gap-4">
          <label className="flex-1">
            <div className="flex items-center justify-center w-full h-32 border-2 border-dashed border-[var(--ff-border-medium)] rounded-lg hover:border-[var(--ff-accent)] transition-colors cursor-pointer">
              <div className="text-center">
                <Upload className="w-8 h-8 mx-auto mb-2 text-[var(--ff-text-tertiary)]" />
                <p className="text-sm text-[var(--ff-text-secondary)]">
                  {file ? file.name : 'Drop Excel file or click to browse'}
                </p>
                <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
                  Expected columns: Status, FT Ref, DR Number
                </p>
              </div>
            </div>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileChange}
              className="hidden"
            />
          </label>
          <button
            onClick={handleGenerate}
            disabled={!file || generateMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 text-white bg-[var(--ff-accent)] rounded-lg hover:opacity-90 transition-colors disabled:opacity-50"
          >
            {generateMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <FileSpreadsheet className="w-4 h-4" />
            )}
            Generate Report
          </button>
        </div>
      </div>

      {/* Error */}
      {generateMutation.isError && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-red-400" />
          <span className="text-red-400">{generateMutation.error?.message}</span>
        </div>
      )}

      {/* Report */}
      {report && (
        <>
          {/* Source Summary */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <FileSpreadsheet className="w-4 h-4 text-green-400" />
                <p className="text-sm font-medium text-[var(--ff-text-primary)]">Excel (Source)</p>
              </div>
              <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{report.sources.excel.total}</p>
              <p className="text-xs text-[var(--ff-text-tertiary)]">
                {report.sources.excel.resolved} resolved, {report.sources.excel.in_progress} in progress
              </p>
            </div>

            <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <Database className="w-4 h-4 text-blue-400" />
                <p className="text-sm font-medium text-[var(--ff-text-primary)]">FibreFlow</p>
              </div>
              <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{report.sources.fibreflow.total}</p>
              <p className="text-xs text-[var(--ff-text-tertiary)]">
                {report.sources.fibreflow.from_qcontact} from QContact
              </p>
            </div>

            <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <MessageSquare className="w-4 h-4 text-purple-400" />
                <p className="text-sm font-medium text-[var(--ff-text-primary)]">QContact</p>
              </div>
              <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{report.sources.qcontact.total}</p>
              <p className="text-xs text-[var(--ff-text-tertiary)]">
                {report.sources.qcontact.available ? 'Connected' : 'Unavailable'}
              </p>
            </div>
          </div>

          {/* Alignment Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-[var(--ff-bg-secondary)] border border-green-500/20 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="w-4 h-4 text-green-400" />
                <p className="text-sm text-[var(--ff-text-secondary)]">In All Three</p>
              </div>
              <p className="text-2xl font-bold text-green-400">{report.summary.in_all_three}</p>
            </div>

            <div className="bg-[var(--ff-bg-secondary)] border border-blue-500/20 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <ArrowRight className="w-4 h-4 text-blue-400" />
                <p className="text-sm text-[var(--ff-text-secondary)]">Excel + FF Only</p>
              </div>
              <p className="text-2xl font-bold text-blue-400">{report.summary.in_excel_and_fibreflow}</p>
            </div>

            <div className="bg-[var(--ff-bg-secondary)] border border-red-500/20 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <XCircle className="w-4 h-4 text-red-400" />
                <p className="text-sm text-[var(--ff-text-secondary)]">Excel Only</p>
              </div>
              <p className="text-2xl font-bold text-red-400">{report.summary.in_excel_only}</p>
            </div>

            <div className="bg-[var(--ff-bg-secondary)] border border-yellow-500/20 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-yellow-400" />
                <p className="text-sm text-[var(--ff-text-secondary)]">Status Mismatches</p>
              </div>
              <p className="text-2xl font-bold text-yellow-400">{report.summary.status_mismatches}</p>
            </div>
          </div>

          {/* Apply Result */}
          {lastApplyResult && (
            <div
              className={cn(
                'p-4 rounded-lg border',
                lastApplyResult.success ? 'bg-green-500/10 border-green-500/20' : 'bg-red-500/10 border-red-500/20'
              )}
            >
              <div className="flex items-center gap-2">
                {lastApplyResult.success ? (
                  <CheckCircle2 className="w-5 h-5 text-green-400" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-red-400" />
                )}
                <span className={lastApplyResult.success ? 'text-green-400' : 'text-red-400'}>
                  Applied: {lastApplyResult.applied}, Skipped: {lastApplyResult.skipped}, Errors:{' '}
                  {lastApplyResult.errors.length}
                </span>
              </div>
              <button
                onClick={() => setLastApplyResult(null)}
                className="mt-2 text-xs text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Suggested Actions */}
          {report.suggested_actions.length > 0 && (
            <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-sm font-semibold text-[var(--ff-text-primary)]">
                  Suggested Actions ({report.suggested_actions.length})
                </h4>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-[var(--ff-text-secondary)]">
                    {selectedActions.size} selected
                  </span>
                  <button
                    onClick={selectAllStatusUpdates}
                    className="text-sm text-[var(--ff-accent)] hover:underline"
                  >
                    Select Status Updates
                  </button>
                  {selectedActions.size > 0 && (
                    <button
                      onClick={() => setSelectedActions(new Set())}
                      className="text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-2 max-h-80 overflow-y-auto">
                {report.suggested_actions.map((action, idx) => (
                  <div
                    key={idx}
                    onClick={() => toggleAction(idx)}
                    className={cn(
                      'flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                      selectedActions.has(idx)
                        ? 'bg-[var(--ff-accent)]/10 border-[var(--ff-accent)]/30'
                        : 'bg-[var(--ff-bg-tertiary)] border-[var(--ff-border-light)] hover:border-[var(--ff-border-medium)]'
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={selectedActions.has(idx)}
                      onChange={() => toggleAction(idx)}
                      className="rounded border-[var(--ff-border-medium)]"
                    />
                    <span
                      className={cn('px-2 py-0.5 text-xs rounded', getPriorityColor(action.priority))}
                    >
                      {action.priority}
                    </span>
                    <span className="font-mono text-sm text-[var(--ff-text-primary)]">{action.ft_ref}</span>
                    {action.dr_number && (
                      <span className="text-xs text-[var(--ff-text-tertiary)]">({action.dr_number})</span>
                    )}
                    <span className="flex-1 text-sm text-[var(--ff-text-secondary)]">{action.details}</span>
                  </div>
                ))}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-2 mt-4 pt-4 border-t border-[var(--ff-border-light)]">
                <button
                  onClick={handlePreview}
                  disabled={selectedActions.size === 0 || applyMutation.isPending}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--ff-text-primary)] bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-secondary)] transition-colors disabled:opacity-50"
                >
                  <Eye className="w-4 h-4" />
                  Preview
                </button>
                <button
                  onClick={handleApply}
                  disabled={selectedActions.size === 0 || applyMutation.isPending}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm text-white bg-[var(--ff-accent)] rounded-lg hover:opacity-90 transition-colors disabled:opacity-50"
                >
                  {applyMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4" />
                  )}
                  Apply Selected
                </button>
              </div>
            </div>
          )}

          {/* Status Mismatches Detail */}
          {report.details.status_mismatches.length > 0 && (
            <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
              <h4 className="text-sm font-semibold text-[var(--ff-text-primary)] mb-4">
                Status Mismatches ({report.details.status_mismatches.length})
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--ff-border-light)]">
                      <th className="text-left py-2 px-3 text-[var(--ff-text-secondary)] font-medium">FT Ref</th>
                      <th className="text-left py-2 px-3 text-[var(--ff-text-secondary)] font-medium">DR Number</th>
                      <th className="text-left py-2 px-3 text-[var(--ff-text-secondary)] font-medium">Excel</th>
                      <th className="text-center py-2 px-3"></th>
                      <th className="text-left py-2 px-3 text-[var(--ff-text-secondary)] font-medium">FibreFlow</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.details.status_mismatches.slice(0, 20).map((m, idx) => (
                      <tr key={idx} className="border-b border-[var(--ff-border-light)]">
                        <td className="py-2 px-3 font-mono text-[var(--ff-text-primary)]">{m.ft_ref}</td>
                        <td className="py-2 px-3 text-[var(--ff-text-secondary)]">{m.dr_number || '-'}</td>
                        <td className="py-2 px-3">
                          <span className="px-2 py-0.5 text-xs rounded bg-green-500/20 text-green-400">
                            {m.excel_status}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-center">
                          <ArrowRight className="w-4 h-4 text-[var(--ff-text-tertiary)] inline" />
                        </td>
                        <td className="py-2 px-3">
                          <span className="px-2 py-0.5 text-xs rounded bg-yellow-500/20 text-yellow-400">
                            {m.fibreflow_status || 'N/A'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {report.details.status_mismatches.length > 20 && (
                  <p className="text-xs text-[var(--ff-text-tertiary)] mt-2 text-center">
                    Showing 20 of {report.details.status_mismatches.length}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Report timestamp */}
          <p className="text-xs text-[var(--ff-text-tertiary)] text-right">
            Report generated: {new Date(report.generated_at).toLocaleString()}
          </p>
        </>
      )}
    </div>
  );
}
