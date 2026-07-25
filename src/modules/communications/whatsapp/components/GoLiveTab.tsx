/**
 * Go Live Tab — WhatsApp Cloud provider readiness.
 *
 * Read-only status panel: which provider is active, which Cloud credentials
 * exist (presence only, never values), and the manual checklist that has to be
 * worked through before the provider is flipped.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { AlertCircle, CheckCircle2, Circle, RefreshCw, Rocket } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { waAdminApi } from '../services/waAdminApiService';
import type { WaReadiness } from '../types/wa-admin.types';
import { WA_GO_LIVE_CHECKLIST } from './goLiveChecklist';
import WaTestSendCard from './WaTestSendCard';

const GoLiveTab: React.FC = () => {
  const [readiness, setReadiness] = useState<WaReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchReadiness = useCallback(async () => {
    setLoading(true);
    setError(null);

    const result = await waAdminApi.goLive.readiness();

    if (result.success && result.data) {
      setReadiness(result.data);
    } else {
      setError(result.error || 'Failed to load go-live readiness');
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    fetchReadiness();
  }, [fetchReadiness]);

  if (loading) {
    return <LoadingSpinner className="py-12" size="lg" label="Loading readiness..." />;
  }

  if (error || !readiness) {
    return (
      <div className="text-center py-12" role="alert">
        <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" aria-hidden="true" />
        <p className="text-red-600 mb-4">{error || 'Readiness unavailable'}</p>
        <button
          onClick={fetchReadiness}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          <RefreshCw className="w-4 h-4" aria-hidden="true" />
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] flex items-center gap-2">
          <Rocket className="w-5 h-5 text-[var(--ff-text-secondary)]" aria-hidden="true" />
          Cloud Go-Live Readiness
        </h3>
        <button
          onClick={fetchReadiness}
          className="flex items-center gap-2 px-3 py-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-tertiary)] rounded transition-colors"
        >
          <RefreshCw className="w-4 h-4" aria-hidden="true" />
          Refresh
        </button>
      </div>

      {/* Active provider */}
      <section className="border border-[var(--ff-border-light)] rounded-lg p-4">
        <h4 className="font-medium text-[var(--ff-text-primary)] mb-2">Active 1:1 provider</h4>
        <p
          data-testid="wa-active-provider"
          className="text-2xl font-semibold text-[var(--ff-primary)]"
        >
          {readiness.provider}
        </p>
        <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
          Group messages always use the bridge — the Cloud API is 1:1 only.
        </p>
      </section>

      {/* Credential presence */}
      <section className="border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
        <div className="bg-[var(--ff-bg-secondary)] px-4 py-3 border-b border-[var(--ff-border-light)]">
          <h4 className="font-medium text-[var(--ff-text-primary)]">Cloud credentials</h4>
          <p className="text-sm text-[var(--ff-text-secondary)]">
            Presence only — values are never sent to the browser.
          </p>
        </div>
        <ul className="divide-y divide-[var(--ff-border-light)]">
          {readiness.cloudConfig.map((item) => (
            <li
              key={item.key}
              data-testid={`wa-key-${item.key}`}
              className="px-4 py-3 flex items-center justify-between gap-4"
            >
              <code className="text-sm text-[var(--ff-text-primary)]">{item.key}</code>
              <span
                className={`inline-flex items-center gap-1.5 text-sm font-medium ${
                  item.present ? 'text-green-600' : 'text-[var(--ff-text-secondary)]'
                }`}
              >
                {item.present ? (
                  <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                ) : (
                  <Circle className="w-4 h-4" aria-hidden="true" />
                )}
                {item.present ? 'Set' : 'Not set'}
              </span>
            </li>
          ))}
        </ul>
        {!readiness.cloudConfigured && (
          <div className="px-4 py-3 bg-yellow-500/10 border-t border-yellow-500/30 text-yellow-600 dark:text-yellow-400 text-sm">
            Cloud sending is not configured yet — at least one credential is missing.
          </div>
        )}
      </section>

      <WaTestSendCard />

      {/* Static checklist */}
      <section
        data-testid="wa-golive-checklist"
        className="border border-[var(--ff-border-light)] rounded-lg overflow-hidden"
      >
        <div className="bg-[var(--ff-bg-secondary)] px-4 py-3 border-b border-[var(--ff-border-light)]">
          <h4 className="font-medium text-[var(--ff-text-primary)]">Go-live checklist</h4>
          <p className="text-sm text-[var(--ff-text-secondary)]">
            Manual steps — the app cannot verify these, so nothing here self-ticks.
          </p>
        </div>
        <ol className="divide-y divide-[var(--ff-border-light)]">
          {WA_GO_LIVE_CHECKLIST.map((item, index) => (
            <li
              key={item.id}
              data-testid={`wa-checklist-item-${item.id}`}
              className="px-4 py-3 flex gap-3"
            >
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] text-xs font-medium flex items-center justify-center">
                {index + 1}
              </span>
              <div className="min-w-0">
                <p className="font-medium text-[var(--ff-text-primary)]">{item.title}</p>
                <p className="text-sm text-[var(--ff-text-secondary)] mt-0.5">{item.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
};

export default GoLiveTab;
