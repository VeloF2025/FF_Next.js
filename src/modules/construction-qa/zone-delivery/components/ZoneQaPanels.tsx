import { useState } from 'react';
import type { ZoneQaCommand } from '../hooks/useZoneDeliveryZone';
import type { ZoneDeliveryView, ZoneQaDiscipline, ZoneQaStatus } from '../types/zoneDelivery.types';
import { ZoneDeliveryActionDialog, type AuditedActionValues } from './ZoneDeliveryActionDialog';

interface Props {
  zone: ZoneDeliveryView;
  canApprove: boolean;
  mutating: boolean;
  onRecord: (input: ZoneQaCommand) => Promise<void>;
}
const labels: Record<ZoneQaStatus, string> = {
  not_started: 'Not started', in_progress: 'In progress', passed: 'Passed', failed: 'Failed',
};

export function ZoneQaPanels({ zone, canApprove, mutating, onRecord }: Props) {
  const [discipline, setDiscipline] = useState<ZoneQaDiscipline | null>(null);
  const [status, setStatus] = useState<'in_progress' | 'passed' | 'failed'>('in_progress');
  const [notes, setNotes] = useState('');
  const [snags, setSnags] = useState('');
  const qa = discipline === 'civil' ? zone.civilQa : zone.opticalQa;
  const submit = async (meta: AuditedActionValues) => {
    if (!discipline) return;
    await onRecord({
      ...meta, discipline, status, notes: notes.trim(),
      snagIds: snags.split(',').map(value => value.trim()).filter(Boolean),
      expectedRowVersion: zone.rowVersion,
    });
  };

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        {(['civil', 'optical'] as const).map(item => {
          const value = item === 'civil' ? zone.civilQa : zone.opticalQa;
          const title = `${item === 'civil' ? 'Civil' : 'Optical'} Zone QA`;
          return (
            <section key={item} aria-label={title} className="rounded-lg border border-[var(--border-color)] p-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-[var(--ff-text-primary)]">{title}</h2>
                {canApprove && zone.status !== 'handed_over' && (
                  <button type="button" onClick={() => setDiscipline(item)} className="rounded border border-[var(--border-color)] px-3 py-2 text-sm" aria-label={`Record ${title}`}>Record QA</button>
                )}
              </div>
              <p className="mt-2 text-sm">{labels[value.status]}</p>
              {value.effectiveAt && <p className="text-sm">Effective: {value.effectiveAt.slice(0, 10)}</p>}
              {value.approverEmail && <p className="text-sm">Approver: {value.approverEmail}</p>}
              {value.notes && <p className="mt-2 text-sm text-[var(--ff-text-secondary)]">{value.notes}</p>}
            </section>
          );
        })}
      </div>
      <ZoneDeliveryActionDialog open={discipline !== null} title={`Record ${discipline ?? ''} Zone QA`} submitting={mutating} onClose={() => setDiscipline(null)} onSubmit={submit}>
        <label className="block text-sm">
          QA status
          <select value={status} onChange={event => setStatus(event.target.value as typeof status)} className="mt-1 w-full rounded border border-[var(--border-color)] bg-transparent px-3 py-2">
            <option value="in_progress">In progress</option><option value="passed">Passed</option><option value="failed">Failed</option>
          </select>
        </label>
        <label className="block text-sm">
          QA notes
          <textarea value={notes} onChange={event => setNotes(event.target.value)} className="mt-1 w-full rounded border border-[var(--border-color)] bg-transparent px-3 py-2" />
        </label>
        <label className="block text-sm">
          Snag IDs
          <input required={status === 'failed'} value={snags} onChange={event => setSnags(event.target.value)} placeholder="Comma separated" className="mt-1 w-full rounded border border-[var(--border-color)] bg-transparent px-3 py-2" />
        </label>
        {qa?.status === 'failed' && <p className="text-xs text-[var(--ff-text-secondary)]">Current QA is failed; record a new supervised outcome after repair.</p>}
      </ZoneDeliveryActionDialog>
    </>
  );
}
