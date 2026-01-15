'use client';

/**
 * Handover Center Page Client Component
 *
 * 🟢 WORKING: Manages ticket handover process between teams
 *
 * Features:
 * - Tickets pending handover (Build → QA, QA → Maintenance)
 * - Gate status visualization (X/5 gates passed)
 * - Blocker identification
 * - Handover wizard integration
 * - Handover history and audit trail
 */

import { HandoverWizard } from '@/modules/ticketing/components/Handover/HandoverWizard';
import { HandoverHistory } from '@/modules/ticketing/components/Handover/HandoverHistory';
import { useState, useEffect, useCallback } from 'react';
import {
  ArrowRight,
  CheckCircle,
  AlertTriangle,
  Loader2,
  RefreshCw,
  Shield,
  Wrench,
  ClipboardCheck,
  XCircle,
} from 'lucide-react';
import { HandoverType, OwnerType } from '@/modules/ticketing/types/handover';

type ViewMode = 'pending' | 'history';
type HandoverFilter = 'all' | HandoverType;

interface PendingTicket {
  ticket_id: string;
  ticket_uid: string;
  title: string;
  status: string;
  project_name: string | null;
  current_owner: OwnerType | null;
  pending_handover_type: HandoverType;
  gate_status: { passed: number; total: number };
  blockers: string[];
  can_handover: boolean;
}

interface ApiResponse {
  success: boolean;
  data: PendingTicket[];
  pagination: { total: number; limit: number; offset: number; has_more: boolean };
  summary: {
    ready_for_handover: number;
    blocked: number;
    by_type: Record<string, number>;
  };
}

export default function HandoverCenterPageClient() {
  const [viewMode, setViewMode] = useState<ViewMode>('pending');
  const [filter, setFilter] = useState<HandoverFilter>('all');
  const [selectedTicket, setSelectedTicket] = useState<PendingTicket | null>(null);
  const [historyTicketId, setHistoryTicketId] = useState<string | null>(null);
  const [tickets, setTickets] = useState<PendingTicket[]>([]);
  const [summary, setSummary] = useState({
    ready_for_handover: 0,
    blocked: 0,
    by_type: {} as Record<string, number>,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch pending handovers
  const fetchPendingHandovers = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      let url = '/api/ticketing/handovers/pending?';

      if (filter !== 'all') {
        url += `handover_type=${filter}`;
      }

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('Failed to fetch pending handovers');
      }

      const result: ApiResponse = await response.json();
      if (result.success) {
        setTickets(result.data);
        if (result.summary) {
          setSummary(result.summary);
        }
      } else {
        throw new Error('API returned error');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load pending handovers');
    } finally {
      setIsLoading(false);
    }
  }, [filter]);

  // Fetch on mount and filter change
  useEffect(() => {
    if (viewMode === 'pending') {
      fetchPendingHandovers();
    }
  }, [fetchPendingHandovers, viewMode]);

  // Handle handover completion
  const handleHandoverComplete = () => {
    setSelectedTicket(null);
    fetchPendingHandovers();
  };

  // Get handover type display info
  const getHandoverTypeInfo = (type: HandoverType) => {
    switch (type) {
      case HandoverType.BUILD_TO_QA:
        return {
          label: 'Build → QA',
          icon: ClipboardCheck,
          color: 'text-blue-400',
          bgColor: 'bg-blue-500/20',
        };
      case HandoverType.QA_TO_MAINTENANCE:
        return {
          label: 'QA → Maintenance',
          icon: Wrench,
          color: 'text-purple-400',
          bgColor: 'bg-purple-500/20',
        };
      case HandoverType.MAINTENANCE_COMPLETE:
        return {
          label: 'Maintenance Complete',
          icon: Shield,
          color: 'text-green-400',
          bgColor: 'bg-green-500/20',
        };
      default:
        return {
          label: type,
          icon: ArrowRight,
          color: 'text-gray-400',
          bgColor: 'bg-gray-500/20',
        };
    }
  };

  // Get owner type label
  const getOwnerLabel = (owner: OwnerType | null) => {
    switch (owner) {
      case OwnerType.BUILD:
        return 'Build Team';
      case OwnerType.QA:
        return 'QA Team';
      case OwnerType.MAINTENANCE:
        return 'Maintenance Team';
      default:
        return 'Unassigned';
    }
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Handover Center</h1>
          <p className="text-[var(--ff-text-secondary)]">
            Manage ticket handovers between Build, QA, and Maintenance teams
          </p>
        </div>
        {viewMode === 'pending' && (
          <button
            onClick={fetchPendingHandovers}
            disabled={isLoading}
            className="flex items-center gap-2 px-4 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        )}
      </div>

      {/* View Mode Toggle */}
      <div className="mb-6 flex gap-2 border-b border-[var(--ff-border-light)]">
        <button
          onClick={() => setViewMode('pending')}
          className={`flex items-center gap-2 px-4 py-2 font-medium transition-colors ${
            viewMode === 'pending'
              ? 'text-blue-400 border-b-2 border-blue-400'
              : 'text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-secondary)]'
          }`}
        >
          <ArrowRight className="w-4 h-4" />
          Pending Handovers
          {summary.ready_for_handover + summary.blocked > 0 && (
            <span className="px-2 py-0.5 text-xs bg-blue-500/20 text-blue-400 rounded-full">
              {summary.ready_for_handover + summary.blocked}
            </span>
          )}
        </button>
        <button
          onClick={() => setViewMode('history')}
          className={`flex items-center gap-2 px-4 py-2 font-medium transition-colors ${
            viewMode === 'history'
              ? 'text-blue-400 border-b-2 border-blue-400'
              : 'text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-secondary)]'
          }`}
        >
          <CheckCircle className="w-4 h-4" />
          Handover History
        </button>
      </div>

      {/* Content Area */}
      {viewMode === 'history' ? (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-md border border-[var(--ff-border-light)]">
          {historyTicketId ? (
            <div>
              <div className="p-4 border-b border-[var(--ff-border-light)] flex items-center justify-between">
                <h2 className="font-medium text-[var(--ff-text-primary)]">Handover History</h2>
                <button
                  onClick={() => setHistoryTicketId(null)}
                  className="text-sm text-blue-400 hover:underline"
                >
                  ← Back to ticket list
                </button>
              </div>
              <HandoverHistory ticketId={historyTicketId} />
            </div>
          ) : (
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4 text-[var(--ff-text-primary)]">
                Select a Ticket to View History
              </h2>
              <p className="text-[var(--ff-text-tertiary)] mb-4">
                Choose a ticket from the pending list or enter a ticket ID to view its handover history.
              </p>
              <div className="flex gap-2 mb-4">
                <input
                  type="text"
                  placeholder="Enter ticket ID (e.g., TKT-001)"
                  className="flex-1 px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)]"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const input = e.currentTarget.value.trim();
                      if (input) {
                        setHistoryTicketId(input);
                      }
                    }
                  }}
                />
                <button
                  onClick={() => setViewMode('pending')}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  View Pending
                </button>
              </div>
              {tickets.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-[var(--ff-text-secondary)] mb-2">
                    Recent Pending Tickets:
                  </h3>
                  <div className="space-y-1">
                    {tickets.slice(0, 5).map((ticket) => (
                      <button
                        key={ticket.ticket_id}
                        onClick={() => setHistoryTicketId(ticket.ticket_id)}
                        className="w-full text-left px-3 py-2 bg-[var(--ff-bg-tertiary)] rounded hover:bg-[var(--ff-bg-primary)] transition-colors"
                      >
                        <span className="font-mono text-blue-400 mr-2">{ticket.ticket_uid}</span>
                        <span className="text-[var(--ff-text-secondary)]">{ticket.title}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div>
          {/* Summary Cards */}
          <div className="mb-6 grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
              <div className="text-2xl font-bold text-[var(--ff-text-primary)]">
                {summary.ready_for_handover}
              </div>
              <div className="text-sm text-green-400">Ready for Handover</div>
            </div>
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
              <div className="text-2xl font-bold text-[var(--ff-text-primary)]">
                {summary.blocked}
              </div>
              <div className="text-sm text-orange-400">Blocked</div>
            </div>
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
              <div className="text-2xl font-bold text-[var(--ff-text-primary)]">
                {summary.by_type?.BUILD_TO_QA || 0}
              </div>
              <div className="text-sm text-blue-400">Build → QA</div>
            </div>
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
              <div className="text-2xl font-bold text-[var(--ff-text-primary)]">
                {summary.by_type?.QA_TO_MAINTENANCE || 0}
              </div>
              <div className="text-sm text-purple-400">QA → Maintenance</div>
            </div>
          </div>

          {/* Filter Buttons */}
          <div className="mb-4 flex gap-2 flex-wrap">
            <button
              onClick={() => setFilter('all')}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                filter === 'all'
                  ? 'bg-blue-600 text-white'
                  : 'bg-[var(--ff-bg-secondary)] text-[var(--ff-text-secondary)] border border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)]'
              }`}
            >
              All Types
            </button>
            <button
              onClick={() => setFilter(HandoverType.BUILD_TO_QA)}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                filter === HandoverType.BUILD_TO_QA
                  ? 'bg-blue-600 text-white'
                  : 'bg-[var(--ff-bg-secondary)] text-[var(--ff-text-secondary)] border border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)]'
              }`}
            >
              Build → QA
            </button>
            <button
              onClick={() => setFilter(HandoverType.QA_TO_MAINTENANCE)}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                filter === HandoverType.QA_TO_MAINTENANCE
                  ? 'bg-blue-600 text-white'
                  : 'bg-[var(--ff-bg-secondary)] text-[var(--ff-text-secondary)] border border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)]'
              }`}
            >
              QA → Maintenance
            </button>
            <button
              onClick={() => setFilter(HandoverType.MAINTENANCE_COMPLETE)}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                filter === HandoverType.MAINTENANCE_COMPLETE
                  ? 'bg-green-600 text-white'
                  : 'bg-[var(--ff-bg-secondary)] text-[var(--ff-text-secondary)] border border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)]'
              }`}
            >
              Maintenance Complete
            </button>
          </div>

          {/* Pending Tickets List */}
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-md border border-[var(--ff-border-light)]">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 text-[var(--ff-text-tertiary)] animate-spin" />
                <span className="ml-3 text-[var(--ff-text-tertiary)]">Loading pending handovers...</span>
              </div>
            ) : error ? (
              <div className="p-6 text-center">
                <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-3" />
                <p className="text-red-400">{error}</p>
                <button
                  onClick={fetchPendingHandovers}
                  className="mt-4 px-4 py-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors"
                >
                  Retry
                </button>
              </div>
            ) : tickets.length === 0 ? (
              <div className="p-6 text-center">
                <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-3" />
                <p className="text-[var(--ff-text-secondary)]">No tickets pending handover</p>
                <p className="text-sm text-[var(--ff-text-tertiary)] mt-1">
                  All handovers are up to date
                </p>
              </div>
            ) : (
              <div className="divide-y divide-[var(--ff-border-light)]">
                {tickets.map((ticket) => {
                  const typeInfo = getHandoverTypeInfo(ticket.pending_handover_type);
                  const TypeIcon = typeInfo.icon;

                  return (
                    <div
                      key={ticket.ticket_id}
                      className={`p-4 hover:bg-[var(--ff-bg-tertiary)] transition-colors cursor-pointer ${
                        selectedTicket?.ticket_id === ticket.ticket_id ? 'bg-blue-500/10' : ''
                      }`}
                      onClick={() => setSelectedTicket(ticket)}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          {/* Ticket Info */}
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-sm font-mono text-blue-400">
                              {ticket.ticket_uid}
                            </span>
                            {ticket.project_name && (
                              <span className="text-xs text-[var(--ff-text-tertiary)]">
                                in {ticket.project_name}
                              </span>
                            )}
                          </div>

                          {/* Title */}
                          <h3 className="font-medium text-[var(--ff-text-primary)] mb-2">
                            {ticket.title}
                          </h3>

                          {/* Handover Type & Owner */}
                          <div className="flex flex-wrap items-center gap-2 text-xs mb-2">
                            <span
                              className={`flex items-center gap-1 px-2 py-1 rounded ${typeInfo.bgColor} ${typeInfo.color}`}
                            >
                              <TypeIcon className="w-3 h-3" />
                              {typeInfo.label}
                            </span>
                            <span className="text-[var(--ff-text-tertiary)]">
                              Current: {getOwnerLabel(ticket.current_owner)}
                            </span>
                          </div>

                          {/* Gate Progress */}
                          <div className="flex items-center gap-2 mb-2">
                            <div className="flex-1 h-2 bg-[var(--ff-bg-tertiary)] rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${
                                  ticket.can_handover ? 'bg-green-500' : 'bg-orange-500'
                                }`}
                                style={{
                                  width: `${
                                    ticket.gate_status.total > 0
                                      ? (ticket.gate_status.passed / ticket.gate_status.total) * 100
                                      : 0
                                  }%`,
                                }}
                              />
                            </div>
                            <span className="text-xs text-[var(--ff-text-secondary)] whitespace-nowrap">
                              {ticket.gate_status.passed}/{ticket.gate_status.total} gates
                            </span>
                          </div>

                          {/* Blockers */}
                          {ticket.blockers.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {ticket.blockers.slice(0, 3).map((blocker, idx) => (
                                <span
                                  key={idx}
                                  className="text-xs px-2 py-0.5 bg-red-500/20 text-red-400 rounded"
                                >
                                  {blocker}
                                </span>
                              ))}
                              {ticket.blockers.length > 3 && (
                                <span className="text-xs text-red-400">
                                  +{ticket.blockers.length - 3} more
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Status & Action */}
                        <div className="flex flex-col items-end gap-2">
                          {ticket.can_handover ? (
                            <span className="flex items-center gap-1 px-2 py-1 text-xs bg-green-500/20 text-green-400 rounded border border-green-500/30">
                              <CheckCircle className="w-3 h-3" />
                              Ready
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 px-2 py-1 text-xs bg-orange-500/20 text-orange-400 rounded border border-orange-500/30">
                              <XCircle className="w-3 h-3" />
                              Blocked
                            </span>
                          )}

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedTicket(ticket);
                            }}
                            className={`px-3 py-1 text-xs rounded transition-colors ${
                              ticket.can_handover
                                ? 'bg-green-600 text-white hover:bg-green-700'
                                : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-primary)]'
                            }`}
                          >
                            {ticket.can_handover ? 'Start Handover' : 'View Details'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Handover Wizard Modal */}
          {selectedTicket && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
              <div className="relative w-full max-w-4xl max-h-[90vh] overflow-y-auto bg-[var(--ff-bg-primary)] rounded-lg shadow-xl m-4">
                <button
                  onClick={() => setSelectedTicket(null)}
                  className="absolute top-4 right-4 p-2 text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)] transition-colors"
                >
                  <XCircle className="w-6 h-6" />
                </button>
                <HandoverWizard
                  ticketId={selectedTicket.ticket_id}
                  handoverType={selectedTicket.pending_handover_type}
                  onComplete={handleHandoverComplete}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
