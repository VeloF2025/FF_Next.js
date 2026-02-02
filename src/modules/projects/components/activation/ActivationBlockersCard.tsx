/**
 * ActivationBlockersCard
 * Displays activation requirements for projects in planning status
 */

import { useState, useEffect } from 'react';
import {
  Lock,
  Unlock,
  CheckCircle,
  XCircle,
  FileText,
  Shield,
  Users,
  AlertTriangle,
  Loader2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { ActivationCheck } from '../../services/activationService';

interface ActivationBlockersCardProps {
  projectId: string;
  projectStatus: string;
  onActivate?: () => void;
  onRefresh?: () => void;
}

interface BlockerItemProps {
  label: string;
  met: boolean;
  message: string;
  icon: React.ReactNode;
  details?: string[];
}

function BlockerItem({ label, met, message, icon, details }: BlockerItemProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-b border-[var(--ff-border-light)] last:border-b-0 py-3">
      <div
        className={`flex items-start gap-3 ${details?.length ? 'cursor-pointer' : ''}`}
        onClick={() => details?.length && setExpanded(!expanded)}
      >
        <div className={`p-1.5 rounded ${met ? 'bg-green-100 dark:bg-green-900/30' : 'bg-red-100 dark:bg-red-900/30'}`}>
          {met ? (
            <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400" />
          ) : (
            <XCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[var(--ff-text-secondary)]">{icon}</span>
              <span className="font-medium text-[var(--ff-text-primary)]">{label}</span>
            </div>
            {details?.length ? (
              expanded ? (
                <ChevronUp className="w-4 h-4 text-[var(--ff-text-secondary)]" />
              ) : (
                <ChevronDown className="w-4 h-4 text-[var(--ff-text-secondary)]" />
              )
            ) : null}
          </div>
          <p className={`text-sm mt-0.5 ${met ? 'text-green-600 dark:text-green-400' : 'text-[var(--ff-text-secondary)]'}`}>
            {message}
          </p>
        </div>
      </div>
      {expanded && details && details.length > 0 && (
        <div className="mt-2 ml-10 space-y-1">
          {details.map((detail, i) => (
            <div key={i} className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
              <AlertTriangle className="w-3 h-3" />
              <span>{detail}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ActivationBlockersCard({
  projectId,
  projectStatus,
  onActivate,
  onRefresh,
}: ActivationBlockersCardProps) {
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState(false);
  const [check, setCheck] = useState<ActivationCheck | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadActivationStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const loadActivationStatus = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/activation-check`);
      const data = await response.json();
      if (data.success) {
        setCheck(data.data.check);
      } else {
        setError(data.error || 'Failed to load activation status');
      }
    } catch (err) {
      setError('Failed to load activation status');
    } finally {
      setLoading(false);
    }
  };

  const handleActivate = async () => {
    if (!check?.canActivate || activating) return;

    setActivating(true);
    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.blockers) {
          // Refresh to show updated blockers
          await loadActivationStatus();
        }
        alert(data.error || 'Failed to activate project');
        return;
      }

      onActivate?.();
      onRefresh?.();
    } catch (err) {
      alert('Failed to activate project');
    } finally {
      setActivating(false);
    }
  };

  // Only show for planning status
  if (projectStatus?.toLowerCase() !== 'planning') {
    return null;
  }

  if (loading) {
    return (
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
        <div className="flex items-center gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-[var(--ff-text-secondary)]" />
          <span className="text-[var(--ff-text-secondary)]">Checking activation requirements...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-red-300 dark:border-red-800">
        <div className="flex items-center justify-between">
          <span className="text-red-600 dark:text-red-400">{error}</span>
          <button
            onClick={loadActivationStatus}
            className="text-sm text-[var(--ff-accent)] hover:underline"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!check) return null;

  const { blockers, summary, canActivate } = check;

  return (
    <div className={`bg-[var(--ff-bg-secondary)] rounded-lg border ${
      canActivate
        ? 'border-green-300 dark:border-green-800'
        : 'border-[var(--ff-border-light)]'
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-[var(--ff-border-light)]">
        <div className="flex items-center gap-3">
          {canActivate ? (
            <Unlock className="w-5 h-5 text-green-600" />
          ) : (
            <Lock className="w-5 h-5 text-[var(--ff-text-secondary)]" />
          )}
          <div>
            <h3 className="font-semibold text-[var(--ff-text-primary)]">
              Activation Requirements
            </h3>
            <p className="text-sm text-[var(--ff-text-secondary)]">
              {summary.met}/{summary.total} requirements met
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadActivationStatus}
            className="p-1.5 rounded hover:bg-[var(--ff-bg-tertiary)] transition-colors"
            title="Refresh"
          >
            <svg className="w-4 h-4 text-[var(--ff-text-secondary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="px-4 py-3 border-b border-[var(--ff-border-light)]">
        <div className="h-2 bg-[var(--ff-bg-tertiary)] rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-500 ${
              canActivate ? 'bg-green-500' : 'bg-blue-500'
            }`}
            style={{ width: `${(summary.met / summary.total) * 100}%` }}
          />
        </div>
      </div>

      {/* Blockers */}
      <div className="p-4">
        <BlockerItem
          label="Client PO"
          met={blockers.clientPO.met}
          message={blockers.clientPO.message}
          icon={<FileText className="w-4 h-4" />}
          details={blockers.clientPO.activePOs?.map(po => `${po.poNumber}: R${po.totalValue.toLocaleString()}`)}
        />
        <BlockerItem
          label="Wayleaves"
          met={blockers.wayleaves.met}
          message={blockers.wayleaves.message}
          icon={<FileText className="w-4 h-4" />}
          details={blockers.wayleaves.expired}
        />
        <BlockerItem
          label="H&S Compliance"
          met={blockers.hsCompliance.met}
          message={blockers.hsCompliance.message}
          icon={<Shield className="w-4 h-4" />}
        />
        <BlockerItem
          label="Contractor Signed"
          met={blockers.contractorSigned.met}
          message={blockers.contractorSigned.message}
          icon={<Users className="w-4 h-4" />}
          details={blockers.contractorSigned.signedAgreements}
        />
      </div>

      {/* Activate Button */}
      <div className="p-4 border-t border-[var(--ff-border-light)]">
        <button
          onClick={handleActivate}
          disabled={!canActivate || activating}
          className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-colors ${
            canActivate
              ? 'bg-green-600 text-white hover:bg-green-700'
              : 'bg-gray-100 text-gray-400 cursor-not-allowed dark:bg-gray-800 dark:text-gray-500'
          }`}
        >
          {activating ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Activating...
            </>
          ) : canActivate ? (
            <>
              <Unlock className="w-4 h-4" />
              Activate Project
            </>
          ) : (
            <>
              <Lock className="w-4 h-4" />
              Complete Requirements to Activate
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export default ActivationBlockersCard;
