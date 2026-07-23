/**
 * CAPA detail info - assignment/dates grid, description, root cause, evidence photos
 */

import React from 'react';
import type { CAPA } from '@/modules/health-safety/types/capa.types';

type CAPAWithNames = CAPA & {
  assigned_to_name?: string | null;
  created_by_name?: string | null;
  completed_by_name?: string | null;
  verified_by_name?: string | null;
};

function Field({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-[var(--ff-text-tertiary)] uppercase tracking-wide mb-1">{label}</p>
      <p className="text-[var(--ff-text-primary)]">{value ?? '—'}</p>
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
      <h2 className="text-sm font-semibold text-[var(--ff-text-secondary)] uppercase tracking-wider mb-4">
        {title}
      </h2>
      {children}
    </div>
  );
}

export function CAPADetailInfo({ capa }: { capa: CAPAWithNames }) {
  const fmt = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : undefined);
  const hasRootCause = capa.root_cause_method || (capa.root_cause_analysis?.length ?? 0) > 0;
  const photos = Array.isArray(capa.evidence_photos) ? capa.evidence_photos : [];

  return (
    <>
      <SectionCard title="Details">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm mb-4">
          <Field label="Due Date" value={fmt(capa.due_date)} />
          <Field label="Assigned To" value={capa.assigned_to_name} />
          <Field label="Created By" value={capa.created_by_name} />
          <Field label="Completed" value={capa.completed_at ? `${fmt(capa.completed_at)} — ${capa.completed_by_name || 'Unknown'}` : undefined} />
          <Field label="Verified" value={capa.verified_at ? `${fmt(capa.verified_at)} — ${capa.verified_by_name || 'Unknown'}` : undefined} />
          <Field label="Created" value={fmt(capa.created_at)} />
        </div>
        {capa.description && (
          <div>
            <p className="text-xs text-[var(--ff-text-tertiary)] uppercase tracking-wide mb-1">Description</p>
            <p className="text-sm text-[var(--ff-text-primary)] whitespace-pre-wrap">{capa.description}</p>
          </div>
        )}
      </SectionCard>

      {hasRootCause && (
        <SectionCard title="Root Cause Analysis">
          {capa.root_cause_method && (
            <p className="text-sm text-[var(--ff-text-secondary)] mb-3 capitalize">
              Method: {capa.root_cause_method.replace(/_/g, ' ')}
            </p>
          )}
          {(capa.root_cause_analysis ?? []).length > 0 && (
            <ul className="space-y-2 mb-3">
              {capa.root_cause_analysis!.map((entry) => (
                <li key={entry.step} className="text-sm bg-[var(--ff-bg-tertiary)] rounded p-3">
                  <p className="font-medium text-[var(--ff-text-primary)]">
                    {entry.step}. {entry.question}
                  </p>
                  <p className="text-[var(--ff-text-secondary)] mt-1">{entry.answer}</p>
                </li>
              ))}
            </ul>
          )}
          {capa.preventive_actions && (
            <div>
              <p className="text-xs text-[var(--ff-text-tertiary)] uppercase tracking-wide mb-1">Preventive Actions</p>
              <p className="text-sm text-[var(--ff-text-primary)] whitespace-pre-wrap">{capa.preventive_actions}</p>
            </div>
          )}
        </SectionCard>
      )}

      {photos.length > 0 && (
        <SectionCard title="Evidence Photos">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {photos.map((photo, i) => (
              <a
                key={i}
                href={photo.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block aspect-square rounded-lg overflow-hidden border border-[var(--ff-border-light)]"
              >
                <img src={photo.url} alt={photo.caption || `Evidence photo ${i + 1}`} className="w-full h-full object-cover" />
              </a>
            ))}
          </div>
        </SectionCard>
      )}
    </>
  );
}
