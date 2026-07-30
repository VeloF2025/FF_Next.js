import { useState } from 'react';
import type { DocumentUploadCommand } from '../hooks/useZoneDeliveryZone';
import type { ZoneDeliveryView } from '../types/zoneDelivery.types';
import { ZoneDeliveryActionDialog, type AuditedActionValues } from './ZoneDeliveryActionDialog';

interface Props {
  zone: ZoneDeliveryView;
  canManage: boolean;
  mutating: boolean;
  onUpload: (input: DocumentUploadCommand) => Promise<void>;
}

const names = { test_pack: 'test pack', fac: 'FAC', cac: 'CAC' } as const;

export function HandoverEvidencePanel({ zone, canManage, mutating, onUpload }: Props) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState<'test_pack' | 'fac' | 'cac'>('fac');
  const [ponStageId, setPonStageId] = useState(zone.pons[0]?.ponStageId ?? '');
  const active = zone.documents.filter(document => document.active);
  const submit = async (meta: AuditedActionValues) => {
    if (!file) return;
    await onUpload({
      ...meta, file, documentType, expectedRowVersion: zone.rowVersion,
      ...(documentType === 'test_pack' ? { ponStageId } : {}),
    });
  };

  return (
    <section aria-labelledby="evidence-heading" className="rounded-lg border border-[var(--border-color)] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="evidence-heading" className="font-semibold text-[var(--ff-text-primary)]">Handover evidence</h2>
        {canManage && zone.status !== 'handed_over' && (
          <button type="button" onClick={() => setOpen(true)} className="rounded border border-[var(--border-color)] px-3 py-2 text-sm">Upload evidence</button>
        )}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {(['fac', 'cac'] as const).map(type => {
          const document = active.find(item => item.documentType === type);
          return (
            <div key={type} className="rounded bg-[var(--hover-bg)] p-3 text-sm">
              <div className="font-medium text-[var(--ff-text-primary)]">{type.toUpperCase()}</div>
              {document ? (
                <>
                  <a href={document.url} target="_blank" rel="noreferrer" className="underline" aria-label={`Active ${type.toUpperCase()}`}>Active {type.toUpperCase()}</a>
                  <div className="break-all text-xs text-[var(--ff-text-secondary)]">SHA-256: {document.checksumSha256}</div>
                </>
              ) : <p className="text-[var(--ff-text-secondary)]">No active {type.toUpperCase()}</p>}
            </div>
          );
        })}
      </div>
      <div className="mt-3 space-y-2">
        {active.filter(document => document.documentType === 'test_pack').map(document => {
          const pon = zone.pons.find(item => item.ponStageId === document.ponStageId);
          return (
            <div key={document.id} className="text-sm">
              <a href={document.url} target="_blank" rel="noreferrer" className="underline" aria-label={`Active test pack for PON ${pon?.ponNo ?? 'unknown'}`}>
                Active test pack for PON {pon?.ponNo ?? 'unknown'}
              </a>
              <span className="ml-2 break-all text-xs text-[var(--ff-text-secondary)]">SHA-256: {document.checksumSha256}</span>
            </div>
          );
        })}
      </div>
      <ZoneDeliveryActionDialog open={open} title="Upload delivery evidence" submitting={mutating} onClose={() => setOpen(false)} onSubmit={submit}>
        <label className="block text-sm">
          Document type
          <select value={documentType} onChange={event => setDocumentType(event.target.value as typeof documentType)} className="mt-1 w-full rounded border border-[var(--border-color)] bg-transparent px-3 py-2">
            {Object.entries(names).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        {documentType === 'test_pack' && (
          <label className="block text-sm">
            PON
            <select required value={ponStageId} onChange={event => setPonStageId(event.target.value)} className="mt-1 w-full rounded border border-[var(--border-color)] bg-transparent px-3 py-2">
              {zone.pons.map(pon => <option key={pon.ponStageId} value={pon.ponStageId}>PON {pon.ponNo}</option>)}
            </select>
          </label>
        )}
        <label className="block text-sm">
          File
          <input type="file" required onChange={event => setFile(event.target.files?.[0] ?? null)} className="mt-1 block w-full" />
        </label>
      </ZoneDeliveryActionDialog>
    </section>
  );
}
