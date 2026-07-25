/**
 * Provider flip card — super admin only.
 *
 * Switches the 1:1 WhatsApp transport between the legacy bridge and the Meta
 * Cloud API. The first click only opens a confirmation; nothing is sent until
 * it is accepted, and the server independently requires that confirmation.
 */

import React, { useState } from 'react';
import { AlertTriangle, ArrowLeftRight } from 'lucide-react';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { waAdminApi } from '../services/waAdminApiService';
import type { WaProvider } from '../types/wa-admin.types';

interface WaProviderFlipCardProps {
  provider: WaProvider;
  cloudConfigured: boolean;
  /** Called after a successful flip so the parent can re-read readiness. */
  onFlipped: () => void;
}

const WaProviderFlipCard: React.FC<WaProviderFlipCardProps> = ({ provider, cloudConfigured, onFlipped }) => {
  const [confirming, setConfirming] = useState(false);
  const [flipping, setFlipping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const target: WaProvider = provider === 'cloud' ? 'bridge' : 'cloud';
  // Only the switch *to* cloud depends on credentials; falling back to the
  // bridge is the rollback path and must always stay available.
  const blocked = target === 'cloud' && !cloudConfigured;

  const handleConfirm = async () => {
    setFlipping(true);
    setError(null);

    const result = await waAdminApi.goLive.setProvider({ provider: target, confirm: true });

    setFlipping(false);

    if (result.success && result.data) {
      setConfirming(false);
      onFlipped();
      return;
    }

    setError(result.error || 'Failed to switch provider');
  };

  return (
    <section className="border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
      <div className="bg-[var(--ff-bg-secondary)] px-4 py-3 border-b border-[var(--ff-border-light)]">
        <h4 className="font-medium text-[var(--ff-text-primary)]">Switch 1:1 provider</h4>
        <p className="text-sm text-[var(--ff-text-secondary)]">
          Super admin only. Affects every 1:1 send — group messages always stay on the bridge.
        </p>
      </div>

      <div className="p-4 space-y-3">
        <button
          onClick={() => {
            setError(null);
            setConfirming(true);
          }}
          disabled={blocked || flipping}
          className="inline-flex items-center gap-2 px-4 py-2 border border-[var(--ff-border-medium)] text-[var(--ff-text-primary)] rounded hover:bg-[var(--ff-bg-tertiary)] disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          <ArrowLeftRight className="w-4 h-4" aria-hidden="true" />
          Switch to {target}
        </button>

        {blocked && (
          <p className="text-sm text-[var(--ff-text-secondary)]">
            Set every Cloud credential before switching to cloud.
          </p>
        )}

        {confirming && (
          <div
            data-testid="wa-flip-confirm"
            className="p-3 border border-yellow-500/30 bg-yellow-500/10 rounded space-y-3"
          >
            <div className="flex items-start gap-2 text-sm text-yellow-700 dark:text-yellow-400">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
              <p>
                This immediately routes all 1:1 WhatsApp sends through <strong>{target}</strong>. Confirm the
                test send succeeded first.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleConfirm}
                disabled={flipping}
                className="inline-flex items-center gap-2 px-3 py-2 bg-yellow-600 text-white text-sm rounded hover:bg-yellow-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:ring-offset-2"
              >
                {flipping && <InlineSpinner size="sm" />}
                Yes, switch to {target}
              </button>
              <button
                onClick={() => setConfirming(false)}
                disabled={flipping}
                className="px-3 py-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-tertiary)] rounded disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-gray-500"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {error && (
          <div role="alert" className="p-3 border border-red-500/30 bg-red-500/10 rounded text-sm text-red-700 dark:text-red-400">
            {error}
          </div>
        )}
      </div>
    </section>
  );
};

export default WaProviderFlipCard;
