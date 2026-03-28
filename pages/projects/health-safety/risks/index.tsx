/**
 * Risk Register Page
 * /projects/health-safety/risks
 */

import type { NextPage } from 'next';
import React, { useState } from 'react';
import Head from 'next/head';
import useSWR from 'swr';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { projectsConfig } from '@/modules/navigation';
import { Plus, AlertTriangle } from 'lucide-react';
import { RiskMatrix, RiskForm } from '@/modules/health-safety/components/risk';
import { RISK_LEVEL_CONFIG, RISK_CATEGORIES } from '@/modules/health-safety/types/risk.types';
import type { RiskLevel } from '@/modules/health-safety/types/risk.types';

const fetcher = (url: string) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  });

function RiskRegisterContent() {
  const [showForm, setShowForm] = useState(false);
  const [levelFilter, setLevelFilter] = useState<string>('');

  const params = new URLSearchParams();
  if (levelFilter) params.set('risk_level', levelFilter);

  const { data, mutate } = useSWR(
    `/api/health-safety/risks?${params}`,
    fetcher,
    { refreshInterval: 30000, revalidateOnFocus: true, errorRetryCount: 3 }
  );

  const risks = data?.data?.risks || [];
  const matrix = data?.data?.matrix || [];
  const stats = data?.data?.stats || {};

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Risk Register</h1>
          <p className="text-sm text-[var(--ff-text-secondary)]">
            Identify hazards, assess risks, and track controls
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 bg-[var(--ff-primary-500)] hover:bg-[var(--ff-primary-600)] text-white rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Risk
        </button>
      </div>

      {/* Stats + Matrix layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Risk Matrix */}
        <div className="p-4 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
          <h3 className="text-sm font-semibold text-[var(--ff-text-primary)] mb-3">Risk Matrix</h3>
          <RiskMatrix data={matrix} onCellClick={(l, s) => {
            // Could filter to specific cell
          }} />
        </div>

        {/* Stats */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-[var(--ff-text-primary)]">Summary</h3>
          <div className="grid grid-cols-2 gap-3">
            {(['extreme', 'high', 'medium', 'low'] as RiskLevel[]).map((level) => {
              const cfg = RISK_LEVEL_CONFIG[level];
              const count = stats[level] || 0;
              const colorMap: Record<string, string> = {
                red: 'border-red-500/30 text-red-400',
                orange: 'border-orange-500/30 text-orange-400',
                yellow: 'border-yellow-500/30 text-yellow-400',
                green: 'border-green-500/30 text-green-400',
              };
              return (
                <button
                  key={level}
                  type="button"
                  onClick={() => setLevelFilter(levelFilter === level ? '' : level)}
                  className={`p-3 rounded-lg border bg-[var(--ff-bg-secondary)] text-left transition-colors ${
                    levelFilter === level ? 'ring-2 ring-[var(--ff-primary-500)]' : ''
                  } ${colorMap[cfg.color]}`}
                >
                  <div className="text-xs opacity-70">{cfg.label}</div>
                  <div className="text-2xl font-bold">{count}</div>
                  <div className="text-[10px] opacity-50 mt-0.5">{cfg.action}</div>
                </button>
              );
            })}
          </div>
          {stats.overdue_review > 0 && (
            <div className="flex items-center gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs">
              <AlertTriangle className="w-3.5 h-3.5" />
              {stats.overdue_review} risk(s) overdue for review
            </div>
          )}
        </div>
      </div>

      {/* Risk list */}
      <div>
        <h3 className="text-sm font-semibold text-[var(--ff-text-primary)] mb-3">
          {levelFilter ? `${RISK_LEVEL_CONFIG[levelFilter as RiskLevel]?.label} Risks` : 'All Active Risks'}
          <span className="text-[var(--ff-text-tertiary)] font-normal ml-2">({risks.length})</span>
        </h3>

        {risks.length === 0 ? (
          <div className="text-center py-8 text-[var(--ff-text-tertiary)]">
            No risks found. Click &quot;New Risk&quot; to add a hazard assessment.
          </div>
        ) : (
          <div className="space-y-2">
            {risks.map((risk: any) => {
              const levelCfg = RISK_LEVEL_CONFIG[risk.risk_level as RiskLevel];
              const catCfg = RISK_CATEGORIES[risk.risk_category as keyof typeof RISK_CATEGORIES];
              const colorMap: Record<string, string> = {
                red: 'bg-red-500/10 text-red-400 border-red-500/30',
                orange: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
                yellow: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
                green: 'bg-green-500/10 text-green-400 border-green-500/30',
              };
              return (
                <div
                  key={risk.id}
                  className="p-4 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-[var(--ff-text-primary)]">
                        {risk.hazard_description}
                      </p>
                      <div className="flex items-center gap-2 mt-1 text-xs text-[var(--ff-text-tertiary)]">
                        <span className="px-1.5 py-0.5 rounded bg-[var(--ff-bg-tertiary)]">{catCfg?.label}</span>
                        {risk.project_name && <span>· {risk.project_name}</span>}
                        {risk.site_location && <span>· {risk.site_location}</span>}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${colorMap[levelCfg?.color || 'green']}`}>
                        {risk.risk_score} — {levelCfg?.label}
                      </span>
                      {risk.residual_risk_score !== risk.risk_score && (
                        <span className="text-[10px] text-[var(--ff-text-tertiary)]">
                          Residual: {risk.residual_risk_score}
                        </span>
                      )}
                    </div>
                  </div>
                  {risk.existing_controls && (
                    <p className="mt-2 text-xs text-[var(--ff-text-secondary)]">
                      <span className="font-medium">Controls:</span> {risk.existing_controls}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showForm && (
        <RiskForm
          onSuccess={() => { setShowForm(false); mutate(); }}
          onCancel={() => setShowForm(false)}
        />
      )}
    </div>
  );
}

const RiskRegisterPage: NextPage = () => (
  <AppLayout>
    <Head>
      <title>Risk Register | H&S | FibreFlow</title>
    </Head>
    <ModulePage config={projectsConfig}>
      <RiskRegisterContent />
    </ModulePage>
  </AppLayout>
);

export const getServerSideProps = async () => ({ props: {} });

export default RiskRegisterPage;
