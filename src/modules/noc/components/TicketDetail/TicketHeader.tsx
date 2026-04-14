/**
 * TicketHeader Component - Ticket detail header
 *
 * 🟢 WORKING: Production-ready ticket header component
 *
 * Features:
 * - Display ticket UID, title, status, priority
 * - QA ready indicator
 * - SLA breach warning
 * - Creation and update timestamps
 * - Assigned user display
 * - Contact information (from QContact)
 * - DR Number with map link
 * - Back navigation button
 */

'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Clock,
  User,
  AlertTriangle,
  CheckCircle2,
  MapPin,
  Phone,
  Mail,
  ExternalLink,
  Share2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { log } from '@/lib/logger';
import { useAuth } from '@/contexts/AuthContext';
import { getVisibleActions } from '@/modules/construction-qa/utils/snagPermissions';
import { formatDistanceToNow } from 'date-fns';
import { ClickableStatusBadge } from './ClickableStatusBadge';
import { ClickablePriorityBadge } from './ClickablePriorityBadge';
import type { EnrichedTicket } from '../../types/ticket';

interface TicketHeaderProps {
  /** Ticket data */
  ticket: EnrichedTicket;
  /** Back link URL */
  backLink?: string;
  /** Callback when status changes */
  onStatusChange?: (newStatus: string) => void;
  /** Callback when priority changes */
  onPriorityChange?: (newPriority: string) => void;
}

/** Forward/backward/reject workflow transitions — aligned to NOC Kanban columns */
const TICKET_WORKFLOW_ACTIONS: Record<string, {
  forward?: { status: string; label: string };
  backward?: { status: string; label: string };
  reject?: { status: string; label: string };
}> = {
  open:            { forward: { status: 'assigned',    label: 'Assign' } },
  assigned:        { forward: { status: 'in_progress', label: 'Start Work' },        backward: { status: 'open',        label: 'Unassign' }, reject: { status: 'cancelled', label: 'Not Resolvable' } },
  in_progress:     { forward: { status: 'pending_qa',  label: 'Submit for QA' },     backward: { status: 'assigned',    label: 'Back to Assigned' }, reject: { status: 'cancelled', label: 'Not Resolvable' } },
  pending_qa:      { forward: { status: 'resolved',    label: 'Approve QA' },        backward: { status: 'in_progress', label: 'Reject QA' } },
  qa_in_progress:  { forward: { status: 'resolved',    label: 'Approve QA' },        backward: { status: 'in_progress', label: 'Reject QA' } },
  qa_rejected:     { forward: { status: 'pending_qa',  label: 'Resubmit for QA' },   backward: { status: 'assigned',    label: 'Back to Assigned' } },
  qa_approved:     { forward: { status: 'resolved',    label: 'Mark Resolved' } },
  pending_handover:{ forward: { status: 'resolved',    label: 'Mark Resolved' } },
  handed_to_ops:   { forward: { status: 'resolved',    label: 'Mark Resolved' } },
  resolved:        { forward: { status: 'closed',      label: 'Close Ticket' },      backward: { status: 'in_progress', label: 'Reopen' } },
  verified:        { forward: { status: 'closed',      label: 'Close Ticket' },      backward: { status: 'in_progress', label: 'Reopen' } },
  closed:          {                                                                   backward: { status: 'open',        label: 'Reopen' } },
  cancelled:       {                                                                   backward: { status: 'open',        label: 'Reopen' } },
};

/** DevOps tickets are internal — skip verified, close directly */
const DEVOPS_RESOLVED_ACTIONS: {
  forward?: { status: string; label: string };
  backward?: { status: string; label: string };
  reject?: { status: string; label: string };
} = {
  forward: { status: 'closed', label: 'Close Ticket' },
  backward: { status: 'in_progress', label: 'Fix Not Working' },
};

/** Get workflow actions for a given status, with ticket-type overrides */
function getWorkflowActions(status: string, ticketType?: string) {
  const actions = TICKET_WORKFLOW_ACTIONS[status];
  if (!actions) return undefined;
  if (status === 'resolved' && ticketType === 'dev_ops') {
    return DEVOPS_RESOLVED_ACTIONS;
  }
  return actions;
}

/**
 * 🟢 WORKING: Generate Google Maps URL from GPS coordinates
 */
function getGoogleMapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

/**
 * 🟢 WORKING: Ticket header component
 */
export function TicketHeader({ ticket, backLink = '/noc/tickets', onStatusChange, onPriorityChange }: TicketHeaderProps) {
  const { currentUser: authUser } = useAuth();

  // Get GPS coordinates from enrichment or ticket — validate lat/lng are numeric
  const rawGps = ticket.fibreflow_enrichment?.fibreflow_gps
    || ticket.fibreflow_enrichment?.onemap_gps
    || ticket.gps_coordinates
    || null;
  const gps = rawGps && typeof rawGps.latitude === 'number' && typeof rawGps.longitude === 'number' ? rawGps : null;

  return (
    <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4 sm:p-6">
      {/* Back Button */}
      <Link
        href={backLink}
        className="inline-flex items-center gap-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] mb-4 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to tickets
      </Link>

      {/* Ticket UID and Badges */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold text-[var(--ff-text-primary)] mb-2">{ticket.ticket_uid}</h1>

          <div className="flex items-center gap-2 flex-wrap">
            <ClickableStatusBadge
              status={ticket.status}
              ticketId={ticket.id}
              onStatusChange={onStatusChange}
              showIcon
            />

            {/* Priority Badge */}
            <ClickablePriorityBadge
              priority={ticket.priority}
              ticketId={ticket.id}
              onPriorityChange={onPriorityChange}
              showIcon
            />

            {/* Source Badge */}
            {ticket.source && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-purple-500/20 text-purple-400 border border-purple-500/30 capitalize">
                {ticket.source.replace(/_/g, ' ')}
              </span>
            )}

            {/* QA Ready Indicator */}
            {ticket.qa_ready && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-green-500/20 text-green-400 border border-green-500/30">
                <CheckCircle2 className="w-3.5 h-3.5" />
                QA Ready
              </span>
            )}

            {/* SLA Breach Warning */}
            {ticket.sla_breached && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30">
                <AlertTriangle className="w-3.5 h-3.5" />
                SLA Breached
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Workflow Action Buttons — prominent, right below badges */}
      {(() => {
        const s = ticket.status;
        const actions = getWorkflowActions(s, ticket.ticket_type);
        if (!actions?.forward && !actions?.backward) return null;
        const vis = getVisibleActions(s, {
          userId: authUser?.id ?? null,
          userRole: authUser?.role ?? null,
          ticketAssignedTo: ticket.assigned_to ?? null,
        });
        return (
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            {actions.backward && vis.showBackward && (
              <button
                type="button"
                onClick={() => onStatusChange?.(actions.backward!.status)}
                className="text-sm sm:text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-200 px-4 py-2.5 sm:px-3 sm:py-1.5 rounded font-medium transition-colors"
              >
                ← {actions.backward.label}
              </button>
            )}
            {actions.forward && vis.showForward && (
              <button
                type="button"
                onClick={() => onStatusChange?.(actions.forward!.status)}
                className="text-sm sm:text-xs bg-green-800 hover:bg-green-700 text-green-100 px-4 py-2.5 sm:px-3 sm:py-1.5 rounded font-medium transition-colors"
              >
                {actions.forward.label} →
              </button>
            )}
            {actions.reject && vis.showReject && (
              <button
                type="button"
                onClick={() => onStatusChange?.(actions.reject!.status)}
                className="text-sm sm:text-xs bg-red-900 hover:bg-red-800 text-red-200 px-4 py-2.5 sm:px-3 sm:py-1.5 rounded transition-colors"
              >
                {actions.reject.label}
              </button>
            )}
            <ShareButton ticketId={ticket.id} />
          </div>
        );
      })()}

      {/* Title */}
      <h2 className="text-xl font-semibold text-[var(--ff-text-primary)] mb-4">{ticket.title}</h2>

      {/* Contact Information Section */}
      {(ticket.client_name || ticket.client_contact || ticket.client_email) && (
        <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4 mb-4">
          <h3 className="text-sm font-semibold text-[var(--ff-text-secondary)] mb-3 tracking-wide">
            Contact Information
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {ticket.client_name && (
              <div>
                <div className="flex items-center gap-2 text-sm text-[var(--ff-text-secondary)] mb-1">
                  <User className="w-4 h-4" />
                  Customer Name
                </div>
                <p className="text-sm text-[var(--ff-text-primary)] font-medium">{ticket.client_name}</p>
              </div>
            )}

            {ticket.client_contact && (
              <div>
                <div className="flex items-center gap-2 text-sm text-[var(--ff-text-secondary)] mb-1">
                  <Phone className="w-4 h-4" />
                  Phone
                </div>
                <a
                  href={`tel:${ticket.client_contact}`}
                  className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
                >
                  {ticket.client_contact}
                </a>
              </div>
            )}

            {ticket.client_email && (
              <div>
                <div className="flex items-center gap-2 text-sm text-[var(--ff-text-secondary)] mb-1">
                  <Mail className="w-4 h-4" />
                  Email
                </div>
                <a
                  href={`mailto:${ticket.client_email}`}
                  className="text-sm text-blue-400 hover:text-blue-300 transition-colors truncate block"
                >
                  {ticket.client_email}
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Meta Information */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-4 border-t border-[var(--ff-border-light)]">
        {/* Created */}
        <div>
          <div className="flex items-center gap-2 text-sm text-[var(--ff-text-secondary)] mb-1">
            <Clock className="w-4 h-4" />
            Created
          </div>
          <p className="text-sm text-[var(--ff-text-primary)]">
            {formatDistanceToNow(new Date(ticket.created_at), { addSuffix: true })}
          </p>
        </div>

        {/* Updated */}
        {ticket.updated_at && (
          <div>
            <div className="flex items-center gap-2 text-sm text-[var(--ff-text-secondary)] mb-1">
              <Clock className="w-4 h-4" />
              Updated
            </div>
            <p className="text-sm text-[var(--ff-text-primary)]">
              {formatDistanceToNow(new Date(ticket.updated_at), { addSuffix: true })}
            </p>
          </div>
        )}

        {/* Created By */}
        {ticket.created_user && (
          <div>
            <div className="flex items-center gap-2 text-sm text-[var(--ff-text-secondary)] mb-1">
              <User className="w-4 h-4" />
              Created By
            </div>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-purple-500 flex items-center justify-center">
                <span className="text-xs text-white font-medium">
                  {ticket.created_user.name?.charAt(0) || 'U'}
                </span>
              </div>
              <p className="text-sm text-[var(--ff-text-primary)]">
                {ticket.created_user.name}
              </p>
            </div>
          </div>
        )}

        {/* Assigned To */}
        {ticket.assigned_to && (
          <div>
            <div className="flex items-center gap-2 text-sm text-[var(--ff-text-secondary)] mb-1">
              <User className="w-4 h-4" />
              Assigned To
            </div>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center">
                <span className="text-xs text-white font-medium">
                  {ticket.assigned_user?.name?.charAt(0) || 'U'}
                </span>
              </div>
              <p className="text-sm text-[var(--ff-text-primary)]">
                {ticket.assigned_user?.name || 'Assigned'}
              </p>
            </div>
          </div>
        )}

        {/* DR Number with Map Link */}
        {ticket.dr_number && (
          <div>
            <div className="flex items-center gap-2 text-sm text-[var(--ff-text-secondary)] mb-1">
              <MapPin className="w-4 h-4" />
              DR Number
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-[var(--ff-text-primary)] font-mono">{ticket.dr_number}</span>
              {gps && (
                <a
                  href={getGoogleMapsUrl(gps.latitude, gps.longitude)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                  title="View on Google Maps"
                >
                  <ExternalLink className="w-3 h-3" />
                  Map
                </a>
              )}
            </div>
          </div>
        )}
      </div>

      {/* FibreFlow Cross-Reference Info */}
      {ticket.fibreflow_enrichment && (ticket.fibreflow_enrichment.sow_match_found || ticket.fibreflow_enrichment.onemap_match_found) && (
        <div className="mt-4 pt-4 border-t border-[var(--ff-border-light)]">
          <h3 className="text-sm font-semibold text-[var(--ff-text-secondary)] mb-3 tracking-wide flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-400" />
            FibreFlow Cross-Reference
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {ticket.fibreflow_enrichment.fibreflow_pole_number && (
              <div>
                <div className="text-xs text-[var(--ff-text-secondary)] mb-1">Pole Number</div>
                <p className="text-sm text-[var(--ff-text-primary)] font-mono">
                  {ticket.fibreflow_enrichment.fibreflow_pole_number}
                </p>
              </div>
            )}

            {ticket.fibreflow_enrichment.fibreflow_zone && (
              <div>
                <div className="text-xs text-[var(--ff-text-secondary)] mb-1">Zone</div>
                <p className="text-sm text-[var(--ff-text-primary)]">
                  {ticket.fibreflow_enrichment.fibreflow_zone}
                </p>
              </div>
            )}

            {ticket.fibreflow_enrichment.fibreflow_pon && (
              <div>
                <div className="text-xs text-[var(--ff-text-secondary)] mb-1">PON</div>
                <p className="text-sm text-[var(--ff-text-primary)]">
                  {ticket.fibreflow_enrichment.fibreflow_pon}
                </p>
              </div>
            )}

            {ticket.fibreflow_enrichment.fibreflow_municipality && (
              <div>
                <div className="text-xs text-[var(--ff-text-secondary)] mb-1">Municipality</div>
                <p className="text-sm text-[var(--ff-text-primary)]">
                  {ticket.fibreflow_enrichment.fibreflow_municipality}
                </p>
              </div>
            )}

            {ticket.fibreflow_enrichment.fibreflow_contractor && (
              <div>
                <div className="text-xs text-[var(--ff-text-secondary)] mb-1">Contractor</div>
                <p className="text-sm text-[var(--ff-text-primary)]">
                  {ticket.fibreflow_enrichment.fibreflow_contractor}
                </p>
              </div>
            )}

            {gps && (
              <div className="sm:col-span-2">
                <div className="text-xs text-[var(--ff-text-secondary)] mb-1">GPS Coordinates</div>
                <a
                  href={getGoogleMapsUrl(gps.latitude, gps.longitude)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 transition-colors"
                >
                  <MapPin className="w-4 h-4" />
                  {gps.latitude.toFixed(6)}, {gps.longitude.toFixed(6)}
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 🟢 WORKING: Parse GPS string to coordinates object
 * Handles formats like "-25.123,28.456" or "-25.123, 28.456"
 */
function parseGPSString(gpsString: string): { latitude: number; longitude: number; address: string | null } | null {
  if (!gpsString) return null;

  const parts = gpsString.split(',').map(p => p.trim());
  if (parts.length !== 2) return null;

  const lat = parseFloat(parts[0] ?? '');
  const lng = parseFloat(parts[1] ?? '');

  if (isNaN(lat) || isNaN(lng)) return null;

  return { latitude: lat, longitude: lng, address: null };
}

/** Share button — creates a share token and copies the public URL to clipboard */
function ShareButton({ ticketId }: { ticketId: string }) {
  const [sharing, setSharing] = useState(false);

  const handleShare = async () => {
    setSharing(true);
    try {
      const res = await fetch('/api/snags/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId }),
      });
      if (!res.ok) throw new Error('Failed to create share link');
      const json = await res.json();
      const url = json.data?.url;
      if (url) {
        await navigator.clipboard.writeText(url);
        toast.success('Share link copied to clipboard');
      }
    } catch (err) {
      log.error('Failed to create share link', { err, ticketId });
      toast.error('Failed to create share link');
    } finally {
      setSharing(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => { void handleShare(); }}
      disabled={sharing}
      className="text-xs bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-zinc-200 px-3 py-1.5 rounded font-medium transition-colors flex items-center gap-1.5 ml-auto"
    >
      <Share2 className="w-3.5 h-3.5" />
      {sharing ? 'Copying...' : 'Share'}
    </button>
  );
}
