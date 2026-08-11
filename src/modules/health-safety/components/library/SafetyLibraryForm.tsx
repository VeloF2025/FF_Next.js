/**
 * Safety Library form — create or edit an MSDS / SWP / method statement / JSA.
 *
 * Owns the form state, the modal shell and the submit; the fields themselves
 * live in SafetyLibraryFields so both stay inside the 200-line component limit.
 *
 * Switching an existing MSDS to a procedure clears the chemical values here as
 * well as server-side, because those columns are msds-only in the DB
 * (hs_safety_library_chemical_fields_msds_only).
 */

import React, { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { log } from '@/lib/logger';
import {
  SAFETY_LIBRARY_TYPES,
  type HSSafetyLibraryEntry,
  type SafetyLibraryContentType,
} from '@/modules/health-safety/types/library.types';
import { SafetyLibraryFields, type SafetyLibraryFormValues } from './SafetyLibraryFields';

interface SafetyLibraryFormProps {
  /** Present = edit that entry; absent = create a new one */
  entry?: HSSafetyLibraryEntry;
  onSuccess: () => void;
  onCancel: () => void;
}

export function SafetyLibraryForm({ entry, onSuccess, onCancel }: SafetyLibraryFormProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const dialogRef = useRef<HTMLDivElement>(null);

  const [form, setForm] = useState<SafetyLibraryFormValues>({
    content_type: (entry?.content_type ?? 'msds') as SafetyLibraryContentType,
    title: entry?.title ?? '',
    reference: entry?.reference ?? '',
    version: entry?.version ?? '',
    project_id: entry?.project_id ?? '',
    file_url: entry?.file_url ?? '',
    file_name: entry?.file_name ?? '',
    effective_date: entry?.effective_date?.slice(0, 10) ?? '',
    review_date: entry?.review_date?.slice(0, 10) ?? '',
    supplier: entry?.supplier ?? '',
    ghs_hazard_class: entry?.ghs_hazard_class ?? '',
    storage_location: entry?.storage_location ?? '',
    notes: entry?.notes ?? '',
  });

  useEffect(() => {
    fetch('/api/projects', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setProjects(d.data || []))
      .catch((err) => log.error('Failed to load projects', { error: err }));
  }, []);

  // Escape closes the dialog (focus handling matches RiskForm).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleKeyDown);
    dialogRef.current?.querySelector<HTMLElement>('select, input')?.focus();
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  const isChemical = SAFETY_LIBRARY_TYPES[form.content_type].has_chemical_fields;
  const set = (field: string, value: string) => setForm((p) => ({ ...p, [field]: value }));

  // Changing away from MSDS must also drop the chemical values, or the API
  // rejects the resulting row (they are msds-only in the DB).
  const setContentType = (value: SafetyLibraryContentType) =>
    setForm((p) =>
      SAFETY_LIBRARY_TYPES[value].has_chemical_fields
        ? { ...p, content_type: value }
        : { ...p, content_type: value, supplier: '', ghs_hazard_class: '', storage_location: '' }
    );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) {
      setError('Title is required');
      return;
    }
    setSubmitting(true);
    setError(null);

    const payload = {
      content_type: form.content_type,
      title: form.title.trim(),
      reference: form.reference || null,
      version: form.version || null,
      project_id: form.project_id || null,
      file_url: form.file_url || null,
      file_name: form.file_name || null,
      effective_date: form.effective_date || null,
      review_date: form.review_date || null,
      notes: form.notes || null,
      supplier: isChemical ? form.supplier || null : null,
      ghs_hazard_class: isChemical ? form.ghs_hazard_class || null : null,
      storage_location: isChemical ? form.storage_location || null : null,
    };

    try {
      const res = await fetch(
        entry ? `/api/health-safety/library/${entry.id}` : '/api/health-safety/library',
        {
          method: entry ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload),
        }
      );
      const json = await res.json();
      if (!res.ok || json?.success === false) {
        setError(json?.error?.message || json?.error || 'Failed to save entry');
        setSubmitting(false);
        return;
      }
      onSuccess();
    } catch (err) {
      log.error('Failed to save safety library entry', { error: err });
      setError('Network error saving entry');
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onCancel}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-dialog-title"
        className="bg-[var(--ff-bg-primary)] rounded-xl border border-[var(--ff-border-light)] w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-[var(--ff-border-light)]">
          <h2 id="library-dialog-title" className="text-lg font-semibold text-[var(--ff-text-primary)]">
            {entry ? 'Edit Library Entry' : 'New Library Entry'}
          </h2>
          <Button variant="ghost" size="icon" onClick={onCancel} aria-label="Close dialog">
            <X className="w-5 h-5" aria-hidden="true" />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && <div className="p-2 text-sm text-red-400 bg-red-500/10 rounded-lg border border-red-500/30">{error}</div>}

          <SafetyLibraryFields
            form={form}
            projects={projects}
            isChemical={isChemical}
            set={set}
            setContentType={setContentType}
            entryId={entry?.id}
          />

          <div className="flex items-center gap-3 pt-3 border-t border-[var(--ff-border-light)]">
            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? 'Saving...' : entry ? 'Save changes' : 'Add to Library'}
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
