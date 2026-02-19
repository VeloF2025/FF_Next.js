/**
 * FaultReportDetail Component
 * Full detail view with resolution workflow actions
 */

import { useState } from 'react';
import { X, AlertTriangle, CheckCircle, Search, Wrench, Trash2, Shield } from 'lucide-react';
import type { FaultReportListItem, FaultResolutionStatusValue } from '@/types/procurement/fault.types';

interface FaultReportDetailProps {
  faultReport: FaultReportListItem;
  updateFaultReport: (id: string, data: Record<string, unknown>) => Promise<boolean>;
  onUpdate: () => void;
  onClose: () => void;
}

interface WorkflowAction {
  label: string;
  targetStatus: FaultResolutionStatusValue;
  icon: React.ReactNode;
  buttonClass: string;
  requiresNotes: boolean;
}

const STATUS_LABELS: Record<FaultResolutionStatusValue, string> = {
  open: 'Open',
  investigating: 'Investigating',
  confirmed: 'Confirmed',
  resolved: 'Resolved',
  warranty_claim: 'Warranty Claim',
  scrapped: 'Scrapped',
};

const STATUS_BADGE: Record<FaultResolutionStatusValue, string> = {
  open: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
  investigating: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  confirmed: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  resolved: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  warranty_claim: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  scrapped: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

const SEVERITY_BADGE: Record<string, string> = {
  minor: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  major: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  critical: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

function getWorkflowActions(status: FaultResolutionStatusValue): WorkflowAction[] {
  switch (status) {
    case 'open':
      return [{
        label: 'Start Investigation',
        targetStatus: 'investigating',
        icon: <Search className="h-4 w-4" />,
        buttonClass: 'bg-blue-600 hover:bg-blue-700',
        requiresNotes: false,
      }];
    case 'investigating':
      return [{
        label: 'Confirm Fault',
        targetStatus: 'confirmed',
        icon: <AlertTriangle className="h-4 w-4" />,
        buttonClass: 'bg-yellow-600 hover:bg-yellow-700',
        requiresNotes: false,
      }];
    case 'confirmed':
      return [
        {
          label: 'Resolve',
          targetStatus: 'resolved',
          icon: <CheckCircle className="h-4 w-4" />,
          buttonClass: 'bg-green-600 hover:bg-green-700',
          requiresNotes: true,
        },
        {
          label: 'Warranty Claim',
          targetStatus: 'warranty_claim',
          icon: <Shield className="h-4 w-4" />,
          buttonClass: 'bg-purple-600 hover:bg-purple-700',
          requiresNotes: false,
        },
        {
          label: 'Scrap',
          targetStatus: 'scrapped',
          icon: <Trash2 className="h-4 w-4" />,
          buttonClass: 'bg-red-600 hover:bg-red-700',
          requiresNotes: true,
        },
      ];
    default:
      return [];
  }
}

export function FaultReportDetail({ faultReport, updateFaultReport, onUpdate, onClose }: FaultReportDetailProps) {
  const [activeAction, setActiveAction] = useState<WorkflowAction | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const workflowActions = getWorkflowActions(faultReport.resolutionStatus);

  const handleAction = (action: WorkflowAction) => {
    setActiveAction(action);
    setResolutionNotes('');
    setSubmitError(null);
  };

  const handleConfirmAction = async () => {
    if (!activeAction) return;

    if (activeAction.requiresNotes && !resolutionNotes.trim()) {
      setSubmitError('Resolution notes are required for this action.');
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    const payload: Record<string, unknown> = {
      resolutionStatus: activeAction.targetStatus,
    };

    if (resolutionNotes.trim()) {
      payload.resolutionNotes = resolutionNotes.trim();
    }

    const success = await updateFaultReport(faultReport.id, payload);
    setSubmitting(false);

    if (success) {
      onUpdate();
    } else {
      setSubmitError('Failed to update fault report. Please try again.');
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-gray-200 p-6 dark:border-gray-700">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-orange-500/10 p-2">
            <Wrench className="h-5 w-5 text-orange-500" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Fault Report
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 font-mono">{faultReport.id}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-2">
        {/* Details */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Fault Details
          </h3>

          <div className="grid grid-cols-2 gap-3">
            <InfoField label="Item Code" value={faultReport.itemCode} />
            <InfoField label="Serial Number" value={faultReport.serialNumber} />
            <InfoField label="Supplier" value={faultReport.supplierName} />
            <InfoField label="Reported By" value={faultReport.discoveredByName} />
            <InfoField
              label="Reported At"
              value={new Date(faultReport.createdAt).toLocaleString()}
            />
            {faultReport.resolvedAt && (
              <InfoField
                label="Resolved At"
                value={new Date(faultReport.resolvedAt).toLocaleString()}
              />
            )}
          </div>

          <div className="flex gap-3">
            <div>
              <p className="mb-1 text-xs text-gray-500 dark:text-gray-400">Severity</p>
              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${SEVERITY_BADGE[faultReport.severity]}`}>
                {faultReport.severity}
              </span>
            </div>
            <div>
              <p className="mb-1 text-xs text-gray-500 dark:text-gray-400">Status</p>
              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[faultReport.resolutionStatus]}`}>
                {STATUS_LABELS[faultReport.resolutionStatus]}
              </span>
            </div>
          </div>

          <div>
            <p className="mb-1 text-xs text-gray-500 dark:text-gray-400">Description</p>
            <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-900 dark:bg-gray-900/50 dark:text-white">
              {faultReport.description}
            </p>
          </div>
        </div>

        {/* Resolution Workflow */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Resolution Workflow
          </h3>

          {workflowActions.length === 0 ? (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900/30 dark:text-gray-400">
              This fault report is in a terminal state ({STATUS_LABELS[faultReport.resolutionStatus]}) and requires no further action.
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Current status: <strong className="text-gray-900 dark:text-white">{STATUS_LABELS[faultReport.resolutionStatus]}</strong>
              </p>
              <div className="flex flex-wrap gap-2">
                {workflowActions.map((action) => (
                  <button
                    key={action.targetStatus}
                    onClick={() => handleAction(action)}
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-white ${action.buttonClass}`}
                  >
                    {action.icon}
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Action confirmation panel */}
          {activeAction && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20">
              <p className="mb-3 text-sm font-medium text-blue-900 dark:text-blue-300">
                Confirm: {activeAction.label}
              </p>

              <div className="mb-3">
                <label className="mb-1 block text-xs font-medium text-blue-800 dark:text-blue-400">
                  Resolution Notes{activeAction.requiresNotes && <span className="ml-1 text-red-500">*</span>}
                </label>
                <textarea
                  value={resolutionNotes}
                  onChange={(e) => setResolutionNotes(e.target.value)}
                  rows={3}
                  placeholder={activeAction.requiresNotes ? 'Required: explain the resolution...' : 'Optional notes...'}
                  className="w-full rounded-md border border-blue-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-blue-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500"
                />
              </div>

              {submitError && (
                <p className="mb-2 text-xs text-red-600 dark:text-red-400">{submitError}</p>
              )}

              <div className="flex gap-2">
                <button
                  onClick={handleConfirmAction}
                  disabled={submitting}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {submitting ? 'Updating...' : 'Confirm'}
                </button>
                <button
                  onClick={() => setActiveAction(null)}
                  disabled={submitting}
                  className="rounded-lg border border-blue-300 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50 dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-900/30"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoField({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className="text-sm font-medium text-gray-900 dark:text-white">{value ?? '-'}</p>
    </div>
  );
}
