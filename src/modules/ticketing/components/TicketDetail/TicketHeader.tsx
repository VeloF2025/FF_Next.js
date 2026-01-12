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

import React from 'react';
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
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
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

/**
 * 🟢 WORKING: Generate Google Maps URL from GPS coordinates
 */
function getGoogleMapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

/**
 * 🟢 WORKING: Ticket header component
 */
export function TicketHeader({ ticket, backLink = '/ticketing/tickets', onStatusChange, onPriorityChange }: TicketHeaderProps) {
  // Get GPS coordinates from enrichment or ticket
  const gps = ticket.fibreflow_enrichment?.fibreflow_gps
    || ticket.fibreflow_enrichment?.onemap_gps
    || (ticket.gps_coordinates ? parseGPSString(ticket.gps_coordinates) : null);

  return (
    <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-6">
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
          <h1 className="text-3xl font-bold text-[var(--ff-text-primary)] mb-2">{ticket.ticket_uid}</h1>

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

      {/* Title */}
      <h2 className="text-xl font-semibold text-[var(--ff-text-primary)] mb-4">{ticket.title}</h2>

      {/* Contact Information Section */}
      {(ticket.client_name || ticket.client_contact || ticket.client_email) && (
        <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4 mb-4">
          <h3 className="text-sm font-semibold text-[var(--ff-text-secondary)] mb-3 uppercase tracking-wider">
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
                  {(ticket as any).assigned_user?.name?.charAt(0) || 'U'}
                </span>
              </div>
              <p className="text-sm text-[var(--ff-text-primary)]">
                {(ticket as any).assigned_user?.name || 'Assigned'}
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
          <h3 className="text-sm font-semibold text-[var(--ff-text-secondary)] mb-3 uppercase tracking-wider flex items-center gap-2">
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

  const lat = parseFloat(parts[0]);
  const lng = parseFloat(parts[1]);

  if (isNaN(lat) || isNaN(lng)) return null;

  return { latitude: lat, longitude: lng, address: null };
}
