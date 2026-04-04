'use client';

/**
 * AssetVerificationPanel Component
 *
 * Shows verification status for an asset and allows scanning
 * a label to verify the asset details.
 *
 * Sprint 4: Asset-Procurement Integration
 */

import { useState, useCallback } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  Clock,
  Camera,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
} from 'lucide-react';
import { LabelScanner, type VerificationResult } from './LabelScanner';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { log } from '@/lib/logger';
import { formatDisplayDateTime } from '@/utils/dateFormat';

// ============================================================================
// TYPES
// ============================================================================

export interface AssetVerificationPanelProps {
  /** Asset ID */
  assetId: string;
  /** Current verification status */
  verificationStatus: 'verified' | 'mismatch' | 'pending' | null;
  /** Last verification date */
  verifiedAt: string | null;
  /** Verified by (user name) */
  verifiedBy: string | null;
  /** Callback when verification completes */
  onVerificationComplete?: (result: VerificationResult) => void;
  /** Compact mode for sidebar */
  compact?: boolean;
}

// ============================================================================
// STATUS CONFIG
// ============================================================================

const STATUS_CONFIG = {
  verified: {
    label: 'Verified',
    icon: ShieldCheck,
    color: 'green',
    bgClass: 'bg-green-100 dark:bg-green-900/30',
    textClass: 'text-green-700 dark:text-green-300',
    borderClass: 'border-green-200 dark:border-green-800',
    iconClass: 'text-green-500',
  },
  mismatch: {
    label: 'Mismatch',
    icon: ShieldAlert,
    color: 'orange',
    bgClass: 'bg-orange-100 dark:bg-orange-900/30',
    textClass: 'text-orange-700 dark:text-orange-300',
    borderClass: 'border-orange-200 dark:border-orange-800',
    iconClass: 'text-orange-500',
  },
  pending: {
    label: 'Pending Verification',
    icon: ShieldQuestion,
    color: 'gray',
    bgClass: 'bg-secondary',
    textClass: 'text-muted-foreground',
    borderClass: 'border-gray-200 dark:border-gray-600',
    iconClass: 'text-gray-400',
  },
};

// ============================================================================
// COMPONENT
// ============================================================================

export function AssetVerificationPanel({
  assetId,
  verificationStatus,
  verifiedAt,
  verifiedBy,
  onVerificationComplete,
  compact = false,
}: AssetVerificationPanelProps) {
  const [scannerOpen, setScannerOpen] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [lastResult, setLastResult] = useState<VerificationResult | null>(null);

  const status = verificationStatus || 'pending';
  const config = STATUS_CONFIG[status];
  const StatusIcon = config.icon;

  // Handle verification result from scanner
  const handleVerified = useCallback(
    async (result: VerificationResult) => {
      setLastResult(result);
      setIsVerifying(true);

      try {
        // Save verification to database
        const response = await fetch(`/api/assets/${assetId}/verify-label`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            verified: result.verified,
            mismatches: result.mismatches,
          }),
        });

        if (!response.ok) {
          throw new Error('Failed to save verification');
        }

        // Callback to parent
        onVerificationComplete?.(result);
      } catch (err) {
        log.error('Error saving verification', { err, assetId, result }, 'AssetVerificationPanel');
      } finally {
        setIsVerifying(false);
      }
    },
    [assetId, onVerificationComplete]
  );


  // Compact mode - just badge and button
  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full ${config.bgClass} ${config.textClass}`}
        >
          <StatusIcon className="w-3 h-3" />
          {config.label}
        </span>
        <button
          onClick={() => setScannerOpen(true)}
          className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
          title="Verify with Label"
        >
          <Camera className="w-4 h-4" />
        </button>

        <LabelScanner
          isOpen={scannerOpen}
          onClose={() => setScannerOpen(false)}
          mode="verify"
          assetId={assetId}
          onVerified={handleVerified}
        />
      </div>
    );
  }

  // Full panel
  return (
    <div className={`rounded-lg border p-4 ${config.bgClass} ${config.borderClass}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <StatusIcon className={`w-5 h-5 ${config.iconClass}`} />
          <span className={`font-medium ${config.textClass}`}>
            {config.label}
          </span>
        </div>
        <button
          onClick={() => setScannerOpen(true)}
          disabled={isVerifying}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg transition-colors"
        >
          {isVerifying ? (
            <>
              <InlineSpinner size="sm" />
              Saving...
            </>
          ) : (
            <>
              <Camera className="w-4 h-4" />
              Verify with Label
            </>
          )}
        </button>
      </div>

      {/* Verification Details */}
      {verifiedAt && (
        <div className="space-y-1 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock className="w-4 h-4" />
            <span>Verified: {formatDisplayDateTime(verifiedAt)}</span>
          </div>
          {verifiedBy && (
            <div className="text-muted-foreground dark:text-gray-400 ml-6">
              by {verifiedBy}
            </div>
          )}
        </div>
      )}

      {/* Last Result Summary (if just verified) */}
      {lastResult && (
        <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-600">
          <div className="flex items-center gap-2 text-sm">
            {lastResult.verified ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                <span className="text-green-700 dark:text-green-300">
                  All fields match
                </span>
              </>
            ) : (
              <>
                <AlertTriangle className="w-4 h-4 text-orange-500" />
                <span className="text-orange-700 dark:text-orange-300">
                  {lastResult.mismatches.length} field(s) mismatch
                </span>
              </>
            )}
            <span className="text-gray-400 ml-auto">
              {Math.round(lastResult.confidence * 100)}% confidence
            </span>
          </div>

          {/* Mismatch details */}
          {lastResult.mismatches.length > 0 && (
            <div className="mt-2 space-y-1">
              {lastResult.mismatches.map((m) => (
                <div
                  key={m.field}
                  className="text-xs bg-card rounded p-2 flex items-center gap-2"
                >
                  <span className="text-muted-foreground w-24 capitalize">
                    {m.field.replace(/([A-Z])/g, ' $1').trim()}:
                  </span>
                  <span className="text-red-600 dark:text-red-400">
                    {m.found || 'Not detected'}
                  </span>
                  <span className="text-gray-400 text-xs">
                    (expected: {m.expected || 'N/A'})
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* No previous verification */}
      {!verifiedAt && !lastResult && (
        <p className="text-sm text-muted-foreground">
          This asset has not been verified yet. Scan the label to verify details.
        </p>
      )}

      {/* Scanner Modal */}
      <LabelScanner
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        mode="verify"
        assetId={assetId}
        onVerified={handleVerified}
      />
    </div>
  );
}

export default AssetVerificationPanel;
