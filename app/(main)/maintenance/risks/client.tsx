'use client';

/**
 * Risk Acceptance Review Page Client Component
 *
 * 🟢 WORKING: Manages QA risk acceptances using ModulePage for consistent tab navigation
 *
 * Features:
 * - Active risk acceptances list
 * - Expiring risks (approaching resolution deadlines)
 * - Resolved risks history
 * - Risk resolution actions
 * - Follow-up scheduling
 */

import { useState, useEffect, useCallback } from 'react';
import { ModulePage } from '@/components/module-page';
import { maintenanceConfig } from '@/modules/navigation';
import { AlertTriangle, Clock, CheckCircle, Loader2, RefreshCw, ExternalLink } from 'lucide-react';
import { RiskAcceptanceStatus } from '@/modules/maintenance/types/riskAcceptance';

type RiskFilter = 'active' | 'expiring' | 'resolved';

interface RiskAcceptanceWithTicket {
  id: string;
  ticket_id: string;
  ticket_uid?: string;
  ticket_title?: string;
  project_name?: string;
  risk_type: string;
  risk_description: string;
  conditions?: string;
  status: RiskAcceptanceStatus;
  risk_expiry_date?: string;
  requires_followup: boolean;
  followup_date?: string;
  accepted_by: string;
  created_at: string;
  resolved_at?: string;
  resolved_by?: string;
  resolution_notes?: string;
}

interface ApiResponse {
  success: boolean;
  data: RiskAcceptanceWithTicket[];
  pagination: { total: number; limit: number; offset: number; has_more: boolean };
  counts: { active: number; resolved: number; expired: number; escalated: number };
}

export default function RiskAcceptanceReviewPageClient() {
  const [filter, setFilter] = useState<RiskFilter>('active');
  const [risks, setRisks] = useState<RiskAcceptanceWithTicket[]>([]);
  const [counts, setCounts] = useState({ active: 0, resolved: 0, expired: 0, escalated: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch risks based on filter
  const fetchRisks = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      let url = '/api/maintenance/risk-acceptances?';

      switch (filter) {
        case 'active':
          url += 'status=active';
          break;
        case 'expiring':
          url += 'expiring_within_days=7';
          break;
        case 'resolved':
          url += 'status=resolved';
          break;
      }

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('Failed to fetch risk acceptances');
      }

      const result: ApiResponse = await response.json();
      if (result.success) {
        setRisks(result.data);
        if (result.counts) {
          setCounts(result.counts);
        }
      } else {
        throw new Error('API returned error');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load risks');
    } finally {
      setIsLoading(false);
    }
  }, [filter]);

  // Fetch on mount and filter change
  useEffect(() => {
    fetchRisks();
  }, [fetchRisks]);

  // Resolve a risk
  const handleResolve = async (riskId: string, notes: string) => {
    try {
      const response = await fetch(`/api/maintenance/risk-acceptances/${riskId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resolved_by: 'current-user', // Would come from auth context
          resolution_notes: notes
        })
      });

      if (response.ok) {
        // Refresh the list
        fetchRisks();
      }
    } catch (err) {
      // Handle error
    }
  };

  // Format date for display
  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-ZA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  // Check if risk is expiring soon
  const isExpiringSoon = (dateStr?: string) => {
    if (!dateStr) return false;
    const expiry = new Date(dateStr);
    const now = new Date();
    const daysUntilExpiry = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return daysUntilExpiry <= 7 && daysUntilExpiry >= 0;
  };

  // Get status badge color
  const getStatusColor = (status: RiskAcceptanceStatus) => {
    switch (status) {
      case 'active':
        return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      case 'resolved':
        return 'bg-green-500/20 text-green-400 border-green-500/30';
      case 'expired':
        return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'escalated':
        return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
      default:
        return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
  };

  // Header actions for ModulePage
  const headerActions = (
    <button
      onClick={fetchRisks}
      disabled={isLoading}
      className="flex items-center gap-2 px-4 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors disabled:opacity-50"
    >
      <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
      Refresh
    </button>
  );

  return (
    <ModulePage config={maintenanceConfig} headerActions={headerActions}>
      <div className="flex flex-col h-full">
        {/* Filter Tabs with Counts */}
      <div className="mb-6 flex gap-2 border-b border-[var(--ff-border-light)]">
        <button
          onClick={() => setFilter('active')}
          className={`flex items-center gap-2 px-4 py-2 font-medium transition-colors ${
            filter === 'active'
              ? 'text-yellow-400 border-b-2 border-yellow-400'
              : 'text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-secondary)]'
          }`}
        >
          <AlertTriangle className="w-4 h-4" />
          Active Risks
          {counts.active > 0 && (
            <span className="px-2 py-0.5 text-xs bg-yellow-500/20 text-yellow-400 rounded-full">
              {counts.active}
            </span>
          )}
        </button>
        <button
          onClick={() => setFilter('expiring')}
          className={`flex items-center gap-2 px-4 py-2 font-medium transition-colors ${
            filter === 'expiring'
              ? 'text-orange-400 border-b-2 border-orange-400'
              : 'text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-secondary)]'
          }`}
        >
          <Clock className="w-4 h-4" />
          Expiring Soon
        </button>
        <button
          onClick={() => setFilter('resolved')}
          className={`flex items-center gap-2 px-4 py-2 font-medium transition-colors ${
            filter === 'resolved'
              ? 'text-green-400 border-b-2 border-green-400'
              : 'text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-secondary)]'
          }`}
        >
          <CheckCircle className="w-4 h-4" />
          Resolved
          {counts.resolved > 0 && (
            <span className="px-2 py-0.5 text-xs bg-green-500/20 text-green-400 rounded-full">
              {counts.resolved}
            </span>
          )}
        </button>
      </div>

      {/* Expiring Warning Banner */}
      {filter === 'expiring' && risks.length > 0 && (
        <div className="mb-6 p-4 bg-orange-500/10 border border-orange-500/20 rounded-lg">
          <div className="flex items-start gap-3">
            <Clock className="w-5 h-5 text-orange-400 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-medium text-orange-300">Risks Requiring Immediate Attention</h3>
              <p className="mt-1 text-sm text-orange-400/80">
                These risk acceptances are approaching their expiry dates and require resolution
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Content Area */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-md border border-[var(--ff-border-light)]">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-[var(--ff-text-tertiary)] animate-spin" />
            <span className="ml-3 text-[var(--ff-text-tertiary)]">Loading risks...</span>
          </div>
        ) : error ? (
          <div className="p-6 text-center">
            <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-3" />
            <p className="text-red-400">{error}</p>
            <button
              onClick={fetchRisks}
              className="mt-4 px-4 py-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors"
            >
              Retry
            </button>
          </div>
        ) : risks.length === 0 ? (
          <div className="p-6 text-center">
            <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-3" />
            <p className="text-[var(--ff-text-secondary)]">
              {filter === 'active' && 'No active risk acceptances'}
              {filter === 'expiring' && 'No risks expiring within 7 days'}
              {filter === 'resolved' && 'No resolved risk acceptances'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--ff-border-light)]">
            {risks.map((risk) => (
              <div key={risk.id} className="p-4 hover:bg-[var(--ff-bg-tertiary)] transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    {/* Ticket Info */}
                    <div className="flex items-center gap-2 mb-2">
                      <a
                        href={`/maintenance/tickets/${risk.ticket_id}`}
                        className="text-sm font-mono text-blue-400 hover:underline flex items-center gap-1"
                      >
                        {risk.ticket_uid || 'Unknown'}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                      {risk.project_name && (
                        <span className="text-xs text-[var(--ff-text-tertiary)]">
                          in {risk.project_name}
                        </span>
                      )}
                    </div>

                    {/* Risk Title/Description */}
                    <h3 className="font-medium text-[var(--ff-text-primary)] mb-1">
                      {risk.ticket_title || 'Untitled Ticket'}
                    </h3>
                    <p className="text-sm text-[var(--ff-text-secondary)] mb-2">
                      {risk.risk_description}
                    </p>

                    {/* Risk Type & Conditions */}
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="px-2 py-1 bg-[var(--ff-bg-tertiary)] rounded text-[var(--ff-text-tertiary)]">
                        {risk.risk_type.replace(/_/g, ' ')}
                      </span>
                      {risk.conditions && (
                        <span className="text-[var(--ff-text-tertiary)]">
                          Conditions: {risk.conditions}
                        </span>
                      )}
                    </div>

                    {/* Dates */}
                    <div className="flex items-center gap-4 mt-2 text-xs text-[var(--ff-text-tertiary)]">
                      <span>Created: {formatDate(risk.created_at)}</span>
                      {risk.risk_expiry_date && (
                        <span className={isExpiringSoon(risk.risk_expiry_date) ? 'text-orange-400' : ''}>
                          Expires: {formatDate(risk.risk_expiry_date)}
                        </span>
                      )}
                      {risk.resolved_at && (
                        <span className="text-green-400">
                          Resolved: {formatDate(risk.resolved_at)}
                        </span>
                      )}
                    </div>

                    {/* Resolution Notes */}
                    {risk.resolution_notes && (
                      <div className="mt-2 p-2 bg-green-500/10 rounded text-sm text-green-400">
                        <strong>Resolution:</strong> {risk.resolution_notes}
                      </div>
                    )}
                  </div>

                  {/* Status Badge & Actions */}
                  <div className="flex flex-col items-end gap-2">
                    <span
                      className={`px-2 py-1 text-xs font-medium rounded border ${getStatusColor(
                        risk.status
                      )}`}
                    >
                      {risk.status.toUpperCase()}
                    </span>

                    {risk.status === 'active' && (
                      <button
                        onClick={() => {
                          const notes = prompt('Enter resolution notes:');
                          if (notes) {
                            handleResolve(risk.id, notes);
                          }
                        }}
                        className="px-3 py-1 text-xs bg-green-500/20 text-green-400 rounded hover:bg-green-500/30 transition-colors"
                      >
                        Resolve
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      </div>
    </ModulePage>
  );
}
