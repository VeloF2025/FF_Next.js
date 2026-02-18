/**
 * Project Procurement Tab Component
 * Sprint 1: Project Hub Foundation
 *
 * Displays procurement summary (BOQ, RFQ, PO, GRN) with quick links
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { log } from '@/lib/logger';

interface ProcurementData {
  boqs: number;
  boqsApproved: number;
  boqsDraft: number;
  rfqs: number;
  rfqsOpen: number;
  pendingRFQs: number;
  pos: number;
  pendingPOs: number;
  approvedPOs: number;
  completedPOs: number;
  totalPoValue: number;
  approvedPoValue: number;
  grns: number;
  pendingGRNs: number;
  totalGrnValue: number;
}

interface ProjectProcurementTabProps {
  projectId: string;
}

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(amount);

export function ProjectProcurementTab({ projectId }: ProjectProcurementTabProps) {
  const router = useRouter();
  const [data, setData] = useState<ProcurementData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        const response = await fetch(`/api/projects/${projectId}/procurement-summary`);
        if (!response.ok) throw new Error('Failed to fetch procurement data');
        const result = await response.json();
        setData(result.data);
      } catch (err) {
        log.error('Error fetching procurement', { error: err, projectId });
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [projectId]);

  if (loading) {
    return (
      <div className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-[var(--ff-bg-secondary)] rounded w-1/4" />
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-24 bg-[var(--ff-bg-secondary)] rounded" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-[var(--ff-card-bg)] rounded-lg border border-red-500/30 p-6">
        <div className="text-red-400 text-center">{error}</div>
      </div>
    );
  }

  if (!data) return null;

  const modules = [
    {
      id: 'boq',
      label: 'Bill of Quantities',
      count: data.boqs,
      subtext: `${data.boqsApproved} approved, ${data.boqsDraft} draft`,
      icon: 'document',
      color: 'blue',
      link: `/app/procurement/boq?project=${projectId}`,
    },
    {
      id: 'rfq',
      label: 'Request for Quotes',
      count: data.rfqs,
      subtext: `${data.rfqsOpen} open`,
      badge: data.pendingRFQs > 0 ? data.pendingRFQs : undefined,
      icon: 'mail',
      color: 'purple',
      link: `/app/procurement/rfq?project=${projectId}`,
    },
    {
      id: 'po',
      label: 'Purchase Orders',
      count: data.pos,
      subtext: formatCurrency(data.totalPoValue),
      badge: data.pendingPOs > 0 ? data.pendingPOs : undefined,
      icon: 'shopping-cart',
      color: 'green',
      link: `/app/procurement/orders?project=${projectId}`,
    },
    {
      id: 'grn',
      label: 'Goods Received',
      count: data.grns,
      subtext: formatCurrency(data.totalGrnValue),
      badge: data.pendingGRNs > 0 ? data.pendingGRNs : undefined,
      icon: 'truck',
      color: 'orange',
      link: `/app/procurement/stock/goods-receipt?project=${projectId}`,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Value Summary */}
      <div className="bg-gradient-to-r from-green-500/10 to-blue-500/10 rounded-lg border border-green-500/30 p-4">
        <div className="grid grid-cols-2 gap-6">
          <div>
            <div className="text-xs text-green-400 font-medium tracking-wide mb-1">
              Total PO Value
            </div>
            <div className="text-2xl font-bold text-[var(--ff-text-primary)]">
              {formatCurrency(data.totalPoValue)}
            </div>
            <div className="text-sm text-[var(--ff-text-secondary)] mt-1">
              {formatCurrency(data.approvedPoValue)} approved
            </div>
          </div>
          <div>
            <div className="text-xs text-blue-400 font-medium tracking-wide mb-1">
              Total Received
            </div>
            <div className="text-2xl font-bold text-[var(--ff-text-primary)]">
              {formatCurrency(data.totalGrnValue)}
            </div>
            <div className="text-sm text-[var(--ff-text-secondary)] mt-1">
              {data.grns} goods receipts
            </div>
          </div>
        </div>
      </div>

      {/* Module Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {modules.map(module => (
          <ModuleCard
            key={module.id}
            {...module}
            onClick={() => router.push(module.link)}
          />
        ))}
      </div>

      {/* Alerts */}
      {(data.pendingPOs > 0 || data.pendingRFQs > 0) && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div className="text-sm text-[var(--ff-text-primary)]">
              {data.pendingPOs > 0 && (
                <span>{data.pendingPOs} PO{data.pendingPOs > 1 ? 's' : ''} pending approval. </span>
              )}
              {data.pendingRFQs > 0 && (
                <span>{data.pendingRFQs} RFQ{data.pendingRFQs > 1 ? 's' : ''} awaiting responses.</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-4">
        <button
          onClick={() => router.push(`/app/procurement/boq/create?project=${projectId}`)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          Create BOQ
        </button>
        <button
          onClick={() => router.push(`/app/procurement/rfq/create?project=${projectId}`)}
          className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          Create RFQ
        </button>
        <button
          onClick={() => router.push(`/app/procurement?project=${projectId}`)}
          className="px-4 py-2 bg-[var(--ff-bg-secondary)] hover:bg-[var(--ff-border-light)] text-[var(--ff-text-primary)] rounded-lg text-sm font-medium transition-colors"
        >
          View All Procurement
        </button>
      </div>
    </div>
  );
}

function ModuleCard({ label, count, subtext, badge, icon, color, onClick }: {
  label: string;
  count: number;
  subtext: string;
  badge?: number;
  icon: string;
  color: string;
  onClick: () => void;
}) {
  const colorClasses: Record<string, string> = {
    blue: 'bg-blue-500/10 border-blue-500/30 hover:border-blue-500/50',
    purple: 'bg-purple-500/10 border-purple-500/30 hover:border-purple-500/50',
    green: 'bg-green-500/10 border-green-500/30 hover:border-green-500/50',
    orange: 'bg-orange-500/10 border-orange-500/30 hover:border-orange-500/50',
  };

  const iconColorClasses: Record<string, string> = {
    blue: 'text-blue-400',
    purple: 'text-purple-400',
    green: 'text-green-400',
    orange: 'text-orange-400',
  };

  const icons: Record<string, JSX.Element> = {
    document: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
    mail: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    ),
    'shopping-cart': (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    ),
    truck: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
      </svg>
    ),
  };

  return (
    <div
      onClick={onClick}
      className={`rounded-lg border p-4 cursor-pointer transition-colors ${colorClasses[color]}`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className={iconColorClasses[color]}>{icons[icon]}</div>
        {badge !== undefined && (
          <span className="px-2 py-0.5 text-xs rounded-full bg-yellow-500/20 text-yellow-400">
            {badge} pending
          </span>
        )}
      </div>
      <div className="text-3xl font-bold text-[var(--ff-text-primary)] mb-1">
        {count}
      </div>
      <div className="text-sm font-medium text-[var(--ff-text-primary)]">{label}</div>
      <div className="text-xs text-[var(--ff-text-secondary)] mt-1">{subtext}</div>
    </div>
  );
}

export default ProjectProcurementTab;
