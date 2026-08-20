/**
 * Detail, evidence timeline, delivery summary, and actions (Task 8).
 * Keyboard reachable like `operations/web/OperationalEvidenceDrawer.tsx`:
 * Escape closes, Tab loops inside the panel, focus returns to the opener.
 * Never renders coordinates — only the incident's own snapshot labels,
 * bounded evidence-snapshot key/value pairs, and VF Storage evidence links.
 *
 * The driver-input status line renders `detail.driverInput` — computed
 * server-side by `../reviewQueries.ts#getIncidentDriverInputSummary` via
 * the same `deriveDriverInputState` the driver's own `/my` portal uses
 * (`../driver/inputState.ts`), never a client-side re-derivation from the
 * action timeline (PR7 review I2: the previous ordering-only heuristic
 * could not tell "response window closed" from "driver hasn't answered
 * yet"). `respondBy`/`deliveryFailed` surface the durable
 * `fleet_incident_driver_input_requests` columns that were previously
 * written but never read anywhere a manager could see them (PR7 review
 * I3). The correction-link section renders `detail.correctionLinks` —
 * `../reviewQueries.ts#getIncidentCorrectionLinks`, gated by the same
 * project-scope check as the rest of this detail read (PR7 review C1).
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { incidentApi, IncidentApiError, type EvidenceUploadBody } from './incidentApi';
import { IncidentActionPanel } from './IncidentActionPanel';
import type { IncidentAction, IncidentDetail, IncidentVisibility } from '../types';
import type { AttendanceCorrectionState, DriverInputState } from '../driver/types';

function sast(value: string | null): string {
  return value ? new Date(value).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' }) : 'Not recorded';
}

/** No badge for `not_requested` — matches the driver portal's own "no action needed" treatment; there is nothing for a manager to be told about yet. */
const MANAGER_DRIVER_INPUT_LABELS: Partial<Record<DriverInputState, string>> = {
  requested: 'Awaiting driver', responded: 'Driver responded',
  expired: 'Response window expired', closed: 'Response window closed',
};
const DRIVER_ACTION_LABELS: Partial<Record<IncidentAction['actionType'], string>> = {
  driver_input_requested: 'Requested driver input', driver_response_received: 'Driver responded',
};
/** Migration 503's three-way classification (design §9) — rendered on every action/evidence
 * row so a manager can never mistake an internal note for one the driver can see, or a
 * manager-authored row for one the driver actually submitted. */
const VISIBILITY_LABELS: Record<IncidentVisibility, string> = {
  internal: 'Internal', shared_with_driver: 'Shared with driver', driver_submitted: 'Driver submitted',
};
const CORRECTION_STATE_LABELS: Record<AttendanceCorrectionState, string> = {
  pending: 'Pending', approved: 'Approved', rejected: 'Declined', cancelled: 'Cancelled',
};

function VisibilityBadge({ visibility }: { visibility: IncidentVisibility }) {
  return <span className="ml-1 text-xs uppercase text-[var(--ff-text-tertiary)]">[{VISIBILITY_LABELS[visibility]}]</span>;
}

function DriverInputStatus({ driverInput }: { driverInput: IncidentDetail['driverInput'] }) {
  const label = MANAGER_DRIVER_INPUT_LABELS[driverInput.state];
  if (!label) return null;
  return (
    <div>
      <p role="status" className="text-sm font-medium text-[var(--ff-text-primary)]">{label}</p>
      {driverInput.state === 'requested' && driverInput.respondBy && (
        <p className="text-sm text-[var(--ff-text-secondary)]">Response due {sast(driverInput.respondBy)}</p>
      )}
      {driverInput.deliveryFailed && (
        <p role="alert" className="text-sm text-amber-700">The driver was not notified — delivery failed.</p>
      )}
    </div>
  );
}

function CorrectionLinks({ correctionLinks }: { correctionLinks: IncidentDetail['correctionLinks'] }) {
  if (correctionLinks.length === 0) return null;
  return (
    <section aria-label="Attendance corrections">
      <h4 className="font-medium text-[var(--ff-text-primary)]">Attendance corrections</h4>
      <ul>{correctionLinks.map((link) => (
        <li key={link.id} data-testid={`correction-link-${link.id}`}>
          {CORRECTION_STATE_LABELS[link.correctionState]} — linked {sast(link.linkedAt)}
        </li>
      ))}</ul>
    </section>
  );
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
      <CorrectionLinks correctionLinks={detail.correctionLinks} />
      <section aria-label="Activity history">
        <h4 className="font-medium text-[var(--ff-text-primary)]">Activity history</h4>
        {detail.actions.length === 0 ? <p>No recorded activity yet.</p> : <ul>{detail.actions.map((action) => {
          const driverLabel = DRIVER_ACTION_LABELS[action.actionType];
          const authorship = action.actionType === 'driver_response_received' ? 'Driver' : action.actionType === 'driver_input_requested' ? 'Sent to driver' : null;
          return (
            <li key={action.id} data-testid={`action-${action.id}`}>
              {sast(action.occurredAt)} — {driverLabel ?? action.actionType.replaceAll('_', ' ')}
              {authorship && <span className="ml-1 text-xs uppercase text-[var(--ff-text-tertiary)]">({authorship})</span>}
              <VisibilityBadge visibility={action.visibility} />
              {action.note ? `: ${action.note}` : ''}
            </li>
          );
        })}</ul>}
      </section>
      <section aria-label="Attachments">
        <h4 className="font-medium text-[var(--ff-text-primary)]">Attachments</h4>
        {detail.evidence.length === 0 ? <p>No evidence attached yet.</p> : <ul>{detail.evidence.map((item) => (
          <li key={item.id} data-testid={`evidence-${item.id}`}>
            <a href={item.storageUrl} target="_blank" rel="noreferrer" className="underline">{item.originalFilename ?? item.evidenceType}</a>
            {item.description ? ` — ${item.description}` : ''}
            <VisibilityBadge visibility={item.visibility} />
          </li>
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
          <DriverInputStatus driverInput={detail.driverInput} />
          <DetailSections detail={detail} />
          <IncidentActionPanel incident={detail} canEdit={canEdit} onSubmitted={refreshAfterChange} />
          <EvidenceUploadForm incidentId={detail.id} canEdit={canEdit} onUploaded={refreshAfterChange} />
        </div>}
      </div>
    </div>
  );
}
