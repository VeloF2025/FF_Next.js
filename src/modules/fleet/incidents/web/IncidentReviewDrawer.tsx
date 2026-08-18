/**
 * Detail, evidence timeline, delivery summary, and actions (Task 8).
 * Keyboard reachable like `operations/web/OperationalEvidenceDrawer.tsx`:
 * Escape closes, Tab loops inside the panel, focus returns to the opener.
 * Never renders coordinates — only the incident's own snapshot labels,
 * bounded evidence-snapshot key/value pairs, and VF Storage evidence links.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { incidentApi, IncidentApiError, type EvidenceUploadBody } from './incidentApi';
import { IncidentActionPanel } from './IncidentActionPanel';
import type { IncidentDetail } from '../types';

function sast(value: string | null): string {
  return value ? new Date(value).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' }) : 'Not recorded';
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the selected file'));
    reader.onload = () => resolve(String(reader.result ?? '').split(',').pop() ?? '');
    reader.readAsDataURL(file);
  });
}

function EvidenceUploadForm({ incidentId, canEdit, onUploaded }: { incidentId: string; canEdit: boolean; onUploaded: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!canEdit) return null;

  async function upload(): Promise<void> {
    if (!file) return;
    setUploading(true); setError(null);
    try {
      const base64 = await readAsBase64(file);
      const body: EvidenceUploadBody = {
        evidenceType: file.type === 'application/pdf' ? 'document' : 'photo',
        mimeType: file.type, base64, filename: file.name, description: description.trim() || null,
      };
      await incidentApi.uploadEvidence(incidentId, body);
      setFile(null); setDescription('');
      onUploaded();
    } catch (caught) {
      setError(caught instanceof IncidentApiError ? caught.message : 'Could not upload this file');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2">
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <label className="block text-sm">Attach evidence
        <input aria-label="Evidence file" type="file" accept="image/*,application/pdf"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)} className="mt-1 block w-full" />
      </label>
      <label className="block text-sm">Description (optional)
        <input aria-label="Evidence description" value={description} onChange={(event) => setDescription(event.target.value)} className="mt-1 block w-full" />
      </label>
      <button type="button" disabled={!file || uploading} onClick={() => void upload()} className="rounded border border-[var(--ff-border-light)] px-3 py-2 text-sm disabled:opacity-50">
        {uploading ? 'Uploading…' : 'Upload evidence'}
      </button>
    </div>
  );
}

function DetailSections({ detail }: { detail: IncidentDetail }) {
  const snapshotEntries = Object.entries(detail.evidenceSnapshot);
  return (
    <div className="space-y-4 text-sm text-[var(--ff-text-secondary)]">
      <section aria-label="Identity and schedule">
        <p><strong className="text-[var(--ff-text-primary)]">Staff:</strong> {detail.staffName ?? 'Unassigned'}</p>
        <p><strong className="text-[var(--ff-text-primary)]">Project / site:</strong> {detail.projectName ?? 'No project'} · {detail.operationalSiteName ?? 'No site'}</p>
        <p><strong className="text-[var(--ff-text-primary)]">Detected:</strong> {sast(detail.detectedAt)} · <strong>Opened:</strong> {sast(detail.openedAt)}</p>
        <p><strong className="text-[var(--ff-text-primary)]">Condition last seen:</strong> {sast(detail.conditionLastSeenAt)} · <strong>Cleared:</strong> {sast(detail.conditionClearedAt)}</p>
      </section>
      {snapshotEntries.length > 0 && <section aria-label="Reasons and freshness">
        <h4 className="font-medium text-[var(--ff-text-primary)]">Reasons / freshness</h4>
        <ul>{snapshotEntries.map(([key, value]) => <li key={key}>{key.replaceAll('_', ' ')}: {String(value)}</li>)}</ul>
      </section>}
      <section aria-label="Notification recipients and delivery">
        <h4 className="font-medium text-[var(--ff-text-primary)]">Delivery</h4>
        <p>{detail.delivery.delivered} delivered · {detail.delivery.suppressed} suppressed · {detail.delivery.failed} failed</p>
      </section>
      {(detail.linkedHsReference || detail.linkedMaintenanceReference) && <section aria-label="Linked references">
        {detail.linkedHsReference && <p><strong className="text-[var(--ff-text-primary)]">H&amp;S reference:</strong> {detail.linkedHsReference}</p>}
        {detail.linkedMaintenanceReference && <p><strong className="text-[var(--ff-text-primary)]">Maintenance reference:</strong> {detail.linkedMaintenanceReference}</p>}
      </section>}
      <section aria-label="Activity history">
        <h4 className="font-medium text-[var(--ff-text-primary)]">Activity history</h4>
        {detail.actions.length === 0 ? <p>No recorded activity yet.</p> : <ul>{detail.actions.map((action) => (
          <li key={action.id}>{sast(action.occurredAt)} — {action.actionType.replaceAll('_', ' ')}{action.note ? `: ${action.note}` : ''}</li>
        ))}</ul>}
      </section>
      <section aria-label="Attachments">
        <h4 className="font-medium text-[var(--ff-text-primary)]">Attachments</h4>
        {detail.evidence.length === 0 ? <p>No evidence attached yet.</p> : <ul>{detail.evidence.map((item) => (
          <li key={item.id}><a href={item.storageUrl} target="_blank" rel="noreferrer" className="underline">{item.originalFilename ?? item.evidenceType}</a>{item.description ? ` — ${item.description}` : ''}</li>
        ))}</ul>}
      </section>
    </div>
  );
}

export interface IncidentReviewDrawerProps {
  incidentId: string;
  canEdit: boolean;
  returnFocus: HTMLElement | null;
  onClose: () => void;
  onChanged: () => void;
}

export function IncidentReviewDrawer({ incidentId, canEdit, returnFocus, onClose, onChanged }: IncidentReviewDrawerProps) {
  const drawer = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [detail, setDetail] = useState<IncidentDetail | null>(null);
  const [error, setError] = useState<IncidentApiError | null>(null);

  const load = async (): Promise<void> => {
    try { setDetail(await incidentApi.detail(incidentId)); setError(null); }
    catch (caught) { setError(caught instanceof IncidentApiError ? caught : new IncidentApiError('Incident could not be loaded', 0, 'UNKNOWN_ERROR')); }
  };

  useEffect(() => {
    setDetail(null); setError(null);
    void load();
    closeButton.current?.focus();
    return () => { if (returnFocus?.isConnected) returnFocus.focus(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentId]);

  function handleKeys(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(drawer.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])') ?? []);
    if (!focusable.length) return;
    const first = focusable[0]!; const last = focusable.at(-1)!;
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  }

  const refreshAfterChange = (): void => { void load(); onChanged(); };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={drawer} role="dialog" aria-modal="true" aria-label="Incident review" onKeyDown={handleKeys}
        className="h-full w-full max-w-xl overflow-y-auto bg-[var(--ff-bg-secondary)] p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">{detail?.incidentReference ?? 'Incident'}</h3>
          <button ref={closeButton} type="button" aria-label="Close incident review" onClick={onClose} className="rounded border border-[var(--ff-border-light)] px-3 py-2">Close</button>
        </div>
        {error && <p role="alert" className="mt-4 text-sm text-red-700">{error.kind === 'permission' ? 'You cannot view this incident.' : 'This incident could not be loaded.'}</p>}
        {!detail && !error && <p className="mt-4 text-[var(--ff-text-secondary)]">Loading incident…</p>}
        {detail && <div className="mt-4 space-y-5">
          <DetailSections detail={detail} />
          <IncidentActionPanel incident={detail} canEdit={canEdit} onSubmitted={refreshAfterChange} />
          <EvidenceUploadForm incidentId={detail.id} canEdit={canEdit} onUploaded={refreshAfterChange} />
        </div>}
      </div>
    </div>
  );
}
