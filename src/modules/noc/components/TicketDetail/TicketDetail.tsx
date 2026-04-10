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

import React, { useState, useEffect } from 'react';
import {
  AlertTriangle,
  RefreshCw,
  FileText,
  Activity,
  CheckSquare,
  History,
  MessageSquare,
  Paperclip,
} from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
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
import { NearbyTickets } from './NearbyTickets';
import { NotesTab } from './NotesTab';
import { AttachmentsTab } from './AttachmentsTab';
import { useTicketNotes } from '../../hooks/useTicketNotesWithMutations';

interface TicketDetailProps {
  /** Ticket ID to display */
  ticketId: string;
  /** Show compact version */
  compact?: boolean;
  /** Back link URL */
  backLink?: string;
}

type TabKey = 'overview' | 'activity' | 'notes' | 'attachments' | 'verification';

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
    { key: 'attachments', label: 'Attachments', icon: Paperclip },
    { key: 'verification', label: 'Verification', icon: CheckSquare },
  ];

  // Loading state
  if (isLoading) {
    return (
      <LoadingSpinner className="p-12" size="lg" label="Loading ticket..." />
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

              {/* Before Photo — show first photo attachment on overview */}
              <BeforePhoto ticketId={ticketId} />

              {/* QA Readiness Check (on overview) — only for field tickets, not dev_ops */}
              {ticket.type !== 'dev_ops' &&
                (ticket.status === 'in_progress' ||
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

          {/* Attachments Tab */}
          {activeTab === 'attachments' && (
            <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-6">
              <AttachmentsTab ticketId={ticketId} />
            </div>
          )}

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

          {/* Nearby Tickets - Show tickets within 100m */}
          <NearbyTickets
            ticketId={ticketId}
            gpsCoordinates={
              typeof ticket.gps_coordinates === 'string'
                ? ticket.gps_coordinates
                : ticket.gps_coordinates
                  ? `${ticket.gps_coordinates.latitude},${ticket.gps_coordinates.longitude}`
                  : null
            }
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

/** Classify a photo as before/after based on filename conventions */
function classifyPhoto(filename: string): 'before' | 'after' | 'other' {
  const lower = (filename ?? '').toLowerCase();
  if (lower.includes('before') || lower.includes('snag-before')) return 'before';
  if (lower.includes('after') || lower.includes('snag-after') || lower.includes('fix')) return 'after';
  return 'other';
}

/** Fetches and displays Before / After photo comparison for a ticket on the Overview tab */
function BeforePhoto({ ticketId }: { ticketId: string }) {
  const [photos, setPhotos] = useState<Array<{ id: string; filename: string; storage_url: string }>>([]);

  useEffect(() => {
    fetch(`/api/noc/tickets/${ticketId}/attachments`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.success && data.data?.attachments?.length > 0) {
          const imageAttachments = data.data.attachments.filter(
            (a: { file_type: string; mime_type: string; storage_url: string }) =>
              a.file_type === 'photo' ||
              a.file_type === 'image' ||
              a.file_type?.startsWith('image/') ||
              a.mime_type?.startsWith('image/') ||
              /\.(jpg|jpeg|png|gif|webp)$/i.test(a.storage_url ?? '')
          );
          setPhotos(imageAttachments);
        }
      })
      .catch(() => {});
  }, [ticketId]);

  if (photos.length === 0) return null;

  const beforePhotos = photos.filter((p) => classifyPhoto(p.filename) === 'before');
  const afterPhotos = photos.filter((p) => classifyPhoto(p.filename) === 'after');
  const otherPhotos = photos.filter((p) => classifyPhoto(p.filename) === 'other');

  // If no clear before/after split, treat first photos as before
  const displayBefore = beforePhotos.length > 0 ? beforePhotos : (otherPhotos.length > 0 ? otherPhotos : photos);
  const displayAfter = afterPhotos;

  return (
    <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-6">
      <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-3">
        Photo Evidence
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* BEFORE column */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-red-400 bg-red-500/10 px-2 py-0.5 rounded">
              Before
            </span>
          </div>
          {displayBefore.length > 0 ? displayBefore.map((photo) => (
            <a
              key={photo.id}
              href={photo.storage_url}
              target="_blank"
              rel="noopener noreferrer"
              className="block overflow-hidden rounded-lg border-2 border-red-500/30 hover:border-red-500/60 transition-colors mb-2"
            >
              <img
                src={photo.storage_url}
                alt={photo.filename}
                className="w-full h-48 object-cover"
                loading="lazy"
              />
              <div className="px-3 py-2 bg-[var(--ff-bg-tertiary)]">
                <span className="text-xs text-[var(--ff-text-secondary)]">{photo.filename}</span>
              </div>
            </a>
          )) : (
            <div className="h-48 rounded-lg border-2 border-dashed border-zinc-700 flex items-center justify-center">
              <span className="text-xs text-zinc-500">No before photo</span>
            </div>
          )}
        </div>

        {/* AFTER column */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-green-400 bg-green-500/10 px-2 py-0.5 rounded">
              After
            </span>
          </div>
          {displayAfter.length > 0 ? displayAfter.map((photo) => (
            <a
              key={photo.id}
              href={photo.storage_url}
              target="_blank"
              rel="noopener noreferrer"
              className="block overflow-hidden rounded-lg border-2 border-green-500/30 hover:border-green-500/60 transition-colors mb-2"
            >
              <img
                src={photo.storage_url}
                alt={photo.filename}
                className="w-full h-48 object-cover"
                loading="lazy"
              />
              <div className="px-3 py-2 bg-[var(--ff-bg-tertiary)]">
                <span className="text-xs text-[var(--ff-text-secondary)]">{photo.filename}</span>
              </div>
            </a>
          )) : (
            <div className="h-48 rounded-lg border-2 border-dashed border-zinc-700 flex flex-col items-center justify-center gap-2">
              <span className="text-xs text-zinc-500">No after photo yet</span>
              <span className="text-[10px] text-zinc-600">Upload via Attachments tab or Verification step</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
