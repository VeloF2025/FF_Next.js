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
import { X } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Snag, SnagPhoto, SnagStatus } from '../../types/snag.types';
import { updateSnag } from '../../services/snagService';
import { log } from '@/lib/logger';
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

const STATUS_OPTIONS: { value: SnagStatus; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'fixed', label: 'Fixed' },
  { value: 'verified', label: 'Verified' },
  { value: 'closed', label: 'Closed' },
  { value: 'wont_fix', label: "Won't Fix" },
];

/** WORKING: Expanded inline snag detail with pole resolution */
export function SnagDetail({ snag: initialSnag, photos, onClose, onUpdated, onPhotoAdded, onPhotoDeleted }: SnagDetailProps) {
  const [snag, setSnag] = useState<Snag>(initialSnag);
  const [saving, setSaving] = useState(false);

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

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-4 mt-1">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">
            Snag #{snag.snag_number} — {snag.description}
          </h3>
          <p className="text-xs text-zinc-400 mt-0.5">
            {snag.category} | {snag.severity}
            {snag.noc_ticket_id && (
              <span className="ml-2 text-blue-400">NOC #{snag.noc_ticket_id}</span>
            )}
          </p>
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

      {/* Action row */}
      <div className="flex items-center gap-2 flex-wrap border-t border-zinc-800 pt-3">
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

        {snag.status === 'fixed' && (
          <button
            type="button"
            onClick={() => { void handleMarkVerified(); }}
            disabled={saving}
            className="text-xs bg-green-800 hover:bg-green-700 disabled:opacity-50 text-green-100 px-3 py-1.5 rounded font-medium"
          >
            Mark Verified
          </button>
        )}

        <button
          type="button"
          disabled
          className="text-xs bg-zinc-800 text-zinc-500 border border-zinc-700 px-3 py-1.5 rounded cursor-not-allowed"
          title="NOC ticket creation available in Phase 2"
        >
          Create NOC Ticket (Phase 2)
        </button>
      </div>

      {/* Timeline */}
      <div className="mt-3 border-t border-zinc-800 pt-3">
        <p className="text-xs text-zinc-500">
          Created {new Date(snag.created_at).toLocaleDateString('en-ZA')}
          {snag.report && (
            <span className="ml-1">— from {snag.report.report_number}</span>
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
  );
}
