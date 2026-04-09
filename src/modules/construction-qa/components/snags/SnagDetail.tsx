/**
 * SnagDetail — Expanded inline snag detail (accordion).
 * 3-column photo comparison: Before | During | After.
 * Status changes, assignment, verification actions.
 * Pole resolution widget delegated to SnagPoleResolution.
 *
 * Photo column logic lives in SnagPhotoColumn.tsx.
 */

'use client';

import { useState, useCallback } from 'react';
import { X, ExternalLink, Ticket, MapPin } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Snag, SnagPhoto, SnagStatus } from '../../types/snag.types';
import { updateSnag, createNocTicket } from '../../services/snagService';
import { log } from '@/lib/logger';
import toast from 'react-hot-toast';
import { PhotoColumn } from './SnagPhotoColumn';
import { SnagPoleResolution } from './SnagPoleResolution';

interface SnagDetailProps {
  snag: Snag;
  photos: SnagPhoto[];
  onClose: () => void;
  onUpdated: (updated: Snag) => void;
  onPhotoAdded: (photo: SnagPhoto) => void;
  onPhotoDeleted: (photoId: string) => void;
}

/** Workflow order — matches NOC Kanban columns */
const STATUS_OPTIONS: { value: SnagStatus; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'pending_qa', label: 'Pending QA' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'verified', label: 'Verified' },
  { value: 'closed', label: 'Closed' },
  { value: 'wont_fix', label: "Won't Fix" },
];

/** Forward/backward transitions aligned to the agreed workflow */
const WORKFLOW_ACTIONS: Record<string, {
  forward?: { status: SnagStatus; label: string };
  backward?: { status: SnagStatus; label: string };
}> = {
  open:        { forward: { status: 'assigned',    label: 'Assign' } },
  assigned:    { forward: { status: 'in_progress', label: 'Start Work' },       backward: { status: 'open',        label: 'Unassign' } },
  in_progress: { forward: { status: 'pending_qa',  label: 'Mark as Fixed' },    backward: { status: 'assigned',    label: 'Back to Assigned' } },
  pending_qa:  { forward: { status: 'resolved',    label: 'Approve QA' },       backward: { status: 'in_progress', label: 'Reject QA' } },
  fixed:       { forward: { status: 'resolved',    label: 'Approve QA' },       backward: { status: 'in_progress', label: 'Reject QA' } },
  resolved:    { forward: { status: 'verified',    label: 'Customer Confirmed' }, backward: { status: 'in_progress', label: 'Customer Unhappy' } },
  verified:    { forward: { status: 'closed',      label: 'Close' },            backward: { status: 'in_progress', label: 'Reopen' } },
  closed:      {                                                                  backward: { status: 'open',        label: 'Reopen' } },
};

/** WORKING: Expanded inline snag detail with pole resolution */
export function SnagDetail({ snag: initialSnag, photos, onClose, onUpdated, onPhotoAdded, onPhotoDeleted }: SnagDetailProps) {
  const [snag, setSnag] = useState<Snag>(initialSnag);
  const [saving, setSaving] = useState(false);
  const [creatingTicket, setCreatingTicket] = useState(false);

  const handleStatusChange = async (status: SnagStatus) => {
    setSaving(true);
    try {
      const updated = await updateSnag(snag.id, { status });
      setSnag(updated);
      onUpdated(updated);
    } catch (err) {
      log.error('Failed to update snag status', { err, snagId: snag.id });
    } finally {
      setSaving(false);
    }
  };

  const handleMarkVerified = async () => {
    setSaving(true);
    try {
      const updated = await updateSnag(snag.id, { status: 'verified' });
      setSnag(updated);
      onUpdated(updated);
    } catch (err) {
      log.error('Failed to verify snag', { err, snagId: snag.id });
    } finally {
      setSaving(false);
    }
  };

  const handlePoleLinked = useCallback((updated: Snag) => {
    setSnag(updated);
    onUpdated(updated);
  }, [onUpdated]);

  const handleCreateNocTicket = async () => {
    setCreatingTicket(true);
    try {
      const { snag: updatedSnag, ticket } = await createNocTicket(snag.id);
      setSnag(updatedSnag);
      onUpdated(updatedSnag);
      const uid = ticket?.ticket_uid ?? updatedSnag.noc_ticket_uid ?? 'Ticket';
      const ticketId = ticket?.id ?? updatedSnag.noc_ticket_id ?? '';
      toast.success(
        (t) => (
          <span>
            NOC ticket created:{' '}
            <a
              href={`/noc/tickets/${ticketId}`}
              className="font-semibold underline text-blue-600"
              onClick={() => toast.dismiss(t.id)}
            >
              {uid}
            </a>
          </span>
        ),
        { duration: 6000 }
      );
    } catch (err) {
      log.error('Failed to create NOC ticket', { err, snagId: snag.id });
      toast.error('Failed to create NOC ticket');
    } finally {
      setCreatingTicket(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm p-4 pt-16 overflow-y-auto" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 w-full max-w-3xl shadow-2xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">
            Snag #{snag.snag_number} — {snag.description}
          </h3>
          <p className="text-xs text-zinc-400 mt-0.5">
            {snag.category} | {snag.severity}
            {(() => {
              // Collect all unique pole refs from snag + photos
              const snagRefs = snag.pole_references ?? [];
              const photoRefs = photos
                .map((p) => p.pole_reference)
                .filter((r): r is string => Boolean(r));
              const allRefs = [...new Set([...snagRefs, ...photoRefs])];
              return allRefs.length > 0 ? (
                <span className="ml-2 text-zinc-300">Poles: {allRefs.join(', ')}</span>
              ) : null;
            })()}
            {snag.noc_ticket_uid && (
              <a
                href={`/noc/tickets/${snag.noc_ticket_id ?? ''}`}
                className="ml-2 text-blue-400 hover:text-blue-300 underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                {snag.noc_ticket_uid}
              </a>
            )}
          </p>
          {/* GPS from photo + distance to pole */}
          {(() => {
            const gpsPhoto = photos.find((p) => p.latitude != null && p.longitude != null);
            if (!gpsPhoto) return null;
            const photoLat = Number(gpsPhoto.latitude);
            const photoLon = Number(gpsPhoto.longitude);
            if (isNaN(photoLat) || isNaN(photoLon)) return null;
            const mapsUrl = `https://www.google.com/maps?q=${photoLat},${photoLon}`;

            // Calculate distance to pole if we have pole GPS
            const poleLat = snag.pole_latitude ? Number(snag.pole_latitude) : null;
            const poleLon = snag.pole_longitude ? Number(snag.pole_longitude) : null;
            let distanceM: number | null = null;
            if (poleLat != null && poleLon != null && !isNaN(poleLat) && !isNaN(poleLon)) {
              // Haversine formula
              const R = 6371000;
              const dLat = (poleLat - photoLat) * Math.PI / 180;
              const dLon = (poleLon - photoLon) * Math.PI / 180;
              const a = Math.sin(dLat / 2) ** 2 + Math.cos(photoLat * Math.PI / 180) * Math.cos(poleLat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
              distanceM = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            }

            return (
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
                >
                  <MapPin className="h-3 w-3" />
                  {photoLat.toFixed(6)}, {photoLon.toFixed(6)}
                </a>
                {distanceM != null && distanceM > 1 && (
                  <span className={`text-xs ${distanceM < 50 ? 'text-green-400' : distanceM < 200 ? 'text-yellow-400' : 'text-red-400'}`}>
                    {distanceM < 1000 ? `${Math.round(distanceM)}m from pole` : `${(distanceM / 1000).toFixed(1)}km from pole`}
                  </span>
                )}
                {distanceM != null && distanceM <= 1 && (
                  <span className="text-xs text-green-400">at pole</span>
                )}
              </div>
            );
          })()}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-zinc-500 hover:text-zinc-300 p-1"
          aria-label="Close detail"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Workflow action bar — immediately below header */}
      {(() => {
        const actions = WORKFLOW_ACTIONS[snag.status];
        return (
          <div className="flex items-center gap-2 flex-wrap mb-3 pb-3 border-b border-zinc-800">
            {/* Back button */}
            {actions?.backward && (
              <button
                type="button"
                onClick={() => { void handleStatusChange(actions.backward!.status); }}
                disabled={saving}
                className="text-xs bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-zinc-200 px-3 py-1.5 rounded font-medium transition-colors"
              >
                ← {actions.backward.label}
              </button>
            )}

            {/* Status dropdown */}
            <Select
              value={snag.status}
              onValueChange={(v) => { void handleStatusChange(v as SnagStatus); }}
              disabled={saving}
            >
              <SelectTrigger className="w-36 h-8 bg-zinc-800 border-zinc-700 text-zinc-100 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-zinc-800 border-zinc-700">
                {STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value} className="text-zinc-100 text-xs">
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Forward button */}
            {actions?.forward && (
              <button
                type="button"
                onClick={() => { void handleStatusChange(actions.forward!.status); }}
                disabled={saving}
                className="text-xs bg-green-800 hover:bg-green-700 disabled:opacity-50 text-green-100 px-3 py-1.5 rounded font-medium transition-colors"
              >
                {actions.forward.label} →
              </button>
            )}

            {/* NOC ticket link / create */}
            <div className="ml-auto">
              {snag.noc_ticket_id ? (
                <a
                  href={`/noc/tickets/${snag.noc_ticket_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs bg-blue-900/60 hover:bg-blue-800/60 text-blue-300 border border-blue-700 px-3 py-1.5 rounded font-medium transition-colors"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  NOC {snag.noc_ticket_uid ?? 'Ticket'}
                </a>
              ) : (
                <button
                  type="button"
                  onClick={() => { void handleCreateNocTicket(); }}
                  disabled={saving || creatingTicket}
                  className="flex items-center gap-1.5 text-xs bg-blue-900/60 hover:bg-blue-800/60 disabled:opacity-50 text-blue-300 border border-blue-700 px-3 py-1.5 rounded font-medium transition-colors"
                >
                  <Ticket className="h-3.5 w-3.5" />
                  {creatingTicket ? 'Creating...' : 'Create NOC Ticket'}
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {/* Pole Resolution */}
      {(snag.pole_references?.length ?? 0) > 0 && (
        <SnagPoleResolution snag={snag} onLinked={handlePoleLinked} />
      )}

      {/* 3-column photo comparison */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        {(['before', 'during', 'after'] as const).map((phase) => (
          <PhotoColumn
            key={phase}
            phase={phase}
            photos={photos}
            snagId={snag.id}
            onPhotoAdded={onPhotoAdded}
            onPhotoDeleted={onPhotoDeleted}
          />
        ))}
      </div>

      {/* Timeline */}
      <div className="mt-3 border-t border-zinc-800 pt-3">
        <p className="text-xs text-zinc-500">
          Audit {snag.audit_date ? new Date(snag.audit_date).toLocaleDateString('en-ZA') : new Date(snag.created_at).toLocaleDateString('en-ZA')}
          {snag.report_number && (
            <span className="ml-1">— {snag.report_number}</span>
          )}
        </p>
        {snag.assigned_at && (
          <p className="text-xs text-zinc-500">
            Assigned {new Date(snag.assigned_at).toLocaleDateString('en-ZA')}
          </p>
        )}
        {snag.fixed_at && (
          <p className="text-xs text-zinc-500">
            Fixed {new Date(snag.fixed_at).toLocaleDateString('en-ZA')}
          </p>
        )}
        {snag.verified_at && (
          <p className="text-xs text-zinc-500">
            Verified {new Date(snag.verified_at).toLocaleDateString('en-ZA')}
          </p>
        )}
      </div>
    </div>
    </div>
  );
}
