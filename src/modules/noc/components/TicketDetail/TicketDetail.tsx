/**
 * TicketDetail Component - Main ticket detail view with tabs
 *
 * Features:
 * - Complete ticket information display
 * - Ticket header with all key details
 * - Tabbed interface: Overview, Activity, Verification
 * - QA readiness panel
 * - Ticket actions
 * - Loading and error states
 * - Responsive layout
 */

'use client';

import React, { useState } from 'react';
import {
  Loader2,
  AlertTriangle,
  RefreshCw,
  FileText,
  Activity,
  CheckSquare,
  History,
  MessageSquare,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTicket } from '../../hooks/useTicket';
import { useTicketActivities } from '../../hooks/useTicketActivities';
import { TicketHeader } from './TicketHeader';
import { TicketActions } from './TicketActions';
import { TicketTimeline } from './TicketTimeline';
import { ActivityTab } from './ActivityTab';
import { VerificationChecklist } from '../Verification/VerificationChecklist';
import { QAReadinessCheck } from '../QAReadiness/QAReadinessCheck';
import { AssignmentPanel } from '../Assignment/AssignmentPanel';
import { RelatedTickets } from './RelatedTickets';
import { NotesTab } from './NotesTab';
import { useTicketNotes } from '../../hooks/useTicketNotesWithMutations';

interface TicketDetailProps {
  /** Ticket ID to display */
  ticketId: string;
  /** Show compact version */
  compact?: boolean;
  /** Back link URL */
  backLink?: string;
}

type TabKey = 'overview' | 'activity' | 'notes' | 'verification';

interface Tab {
  key: TabKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
}

/**
 * Main ticket detail component with tabs
 */
export function TicketDetail({ ticketId, compact = false, backLink }: TicketDetailProps) {
  const { ticket, isLoading, isError, error, refetch } = useTicket(ticketId);
  const { summary: activitySummary } = useTicketActivities(ticketId);
  const { summary: notesSummary } = useTicketNotes(ticketId);
  const [activeTab, setActiveTab] = useState<TabKey>('overview');

  // Handle action complete (refetch ticket data)
  const handleActionComplete = () => {
    refetch();
  };

  // Mock timeline events (for overview tab)
  const timelineEvents = React.useMemo(() => {
    if (!ticket) return [];

    const events = [
      {
        id: '1',
        type: 'created' as const,
        description: 'Ticket created',
        timestamp: new Date(ticket.created_at),
        user: ticket.created_by
          ? { id: ticket.created_by, name: 'System' }
          : undefined,
      },
    ];

    if (ticket.assigned_to) {
      events.push({
        id: '2',
        type: 'assignment' as const,
        description: 'Ticket assigned',
        timestamp: new Date(ticket.updated_at || ticket.created_at),
        user: { id: ticket.assigned_to, name: 'Assigned User' },
      });
    }

    if (ticket.status !== 'open') {
      events.push({
        id: '3',
        type: 'status_change' as const,
        description: `Status changed to ${ticket.status.replace(/_/g, ' ')}`,
        timestamp: new Date(ticket.updated_at || ticket.created_at),
      });
    }

    return events;
  }, [ticket]);

  // Define tabs
  const tabs: Tab[] = [
    { key: 'overview', label: 'Overview', icon: FileText },
    { key: 'activity', label: 'Activity', icon: Activity, badge: activitySummary.total },
    { key: 'notes', label: 'Notes', icon: MessageSquare, badge: notesSummary.total },
    { key: 'verification', label: 'Verification', icon: CheckSquare },
  ];

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-[var(--ff-text-secondary)] animate-spin mx-auto mb-3" />
          <p className="text-[var(--ff-text-secondary)]">Loading ticket...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (isError || !ticket) {
    return (
      <div className="p-8">
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-6">
          <div className="flex items-start gap-3 mb-4">
            <AlertTriangle className="w-6 h-6 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-red-400 mb-1">
                Error Loading Ticket
              </h3>
              <p className="text-sm text-red-300">
                {error?.message || 'Failed to fetch ticket details'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <TicketHeader
        ticket={ticket}
        backLink={backLink}
        onStatusChange={handleActionComplete}
        onPriorityChange={handleActionComplete}
      />

      {/* Tab Navigation */}
      <div className="border-b border-[var(--ff-border-light)]">
        <nav className="flex gap-1" aria-label="Tabs">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;

            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors',
                  isActive
                    ? 'border-blue-500 text-blue-400'
                    : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-light)]'
                )}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span
                    className={cn(
                      'px-1.5 py-0.5 rounded-full text-xs',
                      isActive
                        ? 'bg-blue-500/20 text-blue-400'
                        : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]'
                    )}
                  >
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      <div className={cn('grid gap-6', compact ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-3')}>
        {/* Main Content Area */}
        <div className={cn('space-y-6', compact ? 'lg:col-span-1' : 'lg:col-span-2')}>
          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <>
              {/* Description */}
              {ticket.description && (
                <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-3">
                    Description
                  </h3>
                  <p className="text-[var(--ff-text-secondary)] leading-relaxed whitespace-pre-wrap">
                    {ticket.description}
                  </p>
                </div>
              )}

              {/* QA Readiness Check (on overview) */}
              {(ticket.status === 'in_progress' ||
                ticket.status === 'pending_qa' ||
                ticket.status === 'qa_in_progress') && (
                <QAReadinessCheck ticketId={ticketId} />
              )}

              {/* Additional Details */}
              <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-6">
                <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">
                  Additional Details
                </h3>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Project - from enrichment or DR pattern */}
                  {ticket.fibreflow_enrichment?.project && (
                    <div>
                      <dt className="text-sm text-[var(--ff-text-secondary)] mb-1">Project</dt>
                      <dd className="text-sm text-[var(--ff-text-primary)] font-medium">
                        {ticket.fibreflow_enrichment.project.project_name}
                      </dd>
                    </div>
                  )}

                  {/* DR Number */}
                  {ticket.dr_number && (
                    <div>
                      <dt className="text-sm text-[var(--ff-text-secondary)] mb-1">DR Number</dt>
                      <dd className="text-sm text-[var(--ff-text-primary)] font-mono">
                        {ticket.dr_number}
                      </dd>
                    </div>
                  )}

                  <div>
                    <dt className="text-sm text-[var(--ff-text-secondary)] mb-1">Source</dt>
                    <dd className="text-sm text-[var(--ff-text-primary)] capitalize">
                      {ticket.source.replace(/_/g, ' ')}
                    </dd>
                  </div>

                  {ticket.external_id && (
                    <div>
                      <dt className="text-sm text-[var(--ff-text-secondary)] mb-1">External ID</dt>
                      <dd className="text-sm text-[var(--ff-text-primary)] font-mono">
                        {ticket.external_id}
                      </dd>
                    </div>
                  )}

                  {ticket.pole_number && (
                    <div>
                      <dt className="text-sm text-[var(--ff-text-secondary)] mb-1">Pole Number</dt>
                      <dd className="text-sm text-[var(--ff-text-primary)] font-mono">
                        {ticket.pole_number}
                      </dd>
                    </div>
                  )}

                  {ticket.pon_number && (
                    <div>
                      <dt className="text-sm text-[var(--ff-text-secondary)] mb-1">PON Number</dt>
                      <dd className="text-sm text-[var(--ff-text-primary)] font-mono">
                        {ticket.pon_number}
                      </dd>
                    </div>
                  )}

                  {ticket.ont_serial && (
                    <div>
                      <dt className="text-sm text-[var(--ff-text-secondary)] mb-1">ONT Serial</dt>
                      <dd className="text-sm text-[var(--ff-text-primary)] font-mono">
                        {ticket.ont_serial}
                      </dd>
                    </div>
                  )}

                  {ticket.ont_rx_level !== null && ticket.ont_rx_level !== undefined && (
                    <div>
                      <dt className="text-sm text-[var(--ff-text-secondary)] mb-1">
                        RX Power Level
                      </dt>
                      <dd className="text-sm text-[var(--ff-text-primary)]">
                        {ticket.ont_rx_level} dBm
                      </dd>
                    </div>
                  )}

                  {ticket.ont_model && (
                    <div>
                      <dt className="text-sm text-[var(--ff-text-secondary)] mb-1">ONT Model</dt>
                      <dd className="text-sm text-[var(--ff-text-primary)]">{ticket.ont_model}</dd>
                    </div>
                  )}

                  {ticket.address && (
                    <div className="sm:col-span-2">
                      <dt className="text-sm text-[var(--ff-text-secondary)] mb-1">Address</dt>
                      <dd className="text-sm text-[var(--ff-text-primary)]">{ticket.address}</dd>
                    </div>
                  )}

                  {ticket.guarantee_status && (
                    <div>
                      <dt className="text-sm text-[var(--ff-text-secondary)] mb-1">
                        Guarantee Status
                      </dt>
                      <dd className="text-sm text-[var(--ff-text-primary)] capitalize">
                        {ticket.guarantee_status.replace(/_/g, ' ')}
                      </dd>
                    </div>
                  )}

                  {ticket.billing_classification && (
                    <div>
                      <dt className="text-sm text-[var(--ff-text-secondary)] mb-1">
                        Billing Classification
                      </dt>
                      <dd className="text-sm text-[var(--ff-text-primary)] capitalize">
                        {ticket.billing_classification.replace(/_/g, ' ')}
                      </dd>
                    </div>
                  )}

                  {ticket.rectification_count > 0 && (
                    <div>
                      <dt className="text-sm text-[var(--ff-text-secondary)] mb-1">
                        Rectification Count
                      </dt>
                      <dd className="text-sm text-[var(--ff-text-primary)]">
                        {ticket.rectification_count}
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
            </>
          )}

          {/* Activity Tab */}
          {activeTab === 'activity' && (
            <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-6">
              <div className="flex items-center gap-2 mb-4">
                <History className="w-5 h-5 text-[var(--ff-text-secondary)]" />
                <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">
                  Activity Timeline
                </h3>
              </div>
              <ActivityTab ticketId={ticketId} />
            </div>
          )}

          {/* Notes Tab */}
          {activeTab === 'notes' && <NotesTab ticketId={ticketId} />}

          {/* Verification Tab */}
          {activeTab === 'verification' && (
            <VerificationChecklist ticketId={ticketId} editable groupByCategory />
          )}
        </div>

        {/* Right Column - Sidebar (always visible) */}
        <div className="space-y-6">
          {/* Assignment Panel */}
          <AssignmentPanel
            ticketId={ticketId}
            currentUserId={ticket.assigned_to}
            currentUserName={ticket.assigned_user?.name}
            currentTeamId={ticket.assigned_team_id}
            currentTeamName={ticket.assigned_team_info?.name || ticket.assigned_team}
            onAssignmentSaved={handleActionComplete}
          />

          {/* Related Tickets - Show other tickets for same DR */}
          <RelatedTickets
            ticketId={ticketId}
            drNumber={ticket.dr_number}
          />

          {/* Actions */}
          <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-6">
            <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Actions</h3>
            <TicketActions ticket={ticket} onActionComplete={handleActionComplete} />
          </div>

          {/* Quick Timeline (always show on sidebar) */}
          <TicketTimeline events={timelineEvents} />
        </div>
      </div>
    </div>
  );
}
