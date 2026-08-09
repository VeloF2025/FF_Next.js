import type { ZoneDeliveryView } from '../types/zoneDelivery.types';

export interface HandoverSubmission {
  projectId: string;
  zoneNo: number;
  fac: File;
  cac: File;
  effectiveAt: string;
  reason?: string;
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { message?: string };
}

const SOURCE = 'works-qa-toolbar';

async function unwrap<T>(response: Response, fallback: string): Promise<T> {
  const payload = await response.json() as Envelope<T>;
  if (!response.ok || !payload.success || payload.data === undefined) {
    throw new Error(payload.error?.message ?? fallback);
  }
  return payload.data;
}

export interface ZoneHandoverState {
  rowVersion: number;
  /** True when an active FAC or CAC is already on file for the zone. */
  hasEvidence: boolean;
}

/**
 * What the zone already has recorded, or an empty state when it has nothing.
 *
 * A zone with no delivery-state row reports version 0, and a zone with no
 * canonical PON rows fails the read outright — both mean "nothing has been
 * recorded here yet", which the document upload accepts as version 0 and then
 * creates. The failure is deliberately not surfaced: the upload that follows
 * reports the real problem if there is one.
 *
 * `hasEvidence` matters because registering a document over an active one of
 * the same type counts as a correction, and the command then demands a reason.
 * Without knowing this up front the dialog would only ask for a reason when the
 * date was back-dated, so retrying a half-finished handover with today's date
 * failed on a field the operator could not see.
 */
export async function readZoneHandoverState(
  projectId: string,
  zoneNo: number,
): Promise<ZoneHandoverState> {
  const query = `project_id=${encodeURIComponent(projectId)}&zone_no=${zoneNo}`;
  const response = await fetch(`/api/zone-delivery/zone?${query}`, { credentials: 'include' });
  if (!response.ok) return { rowVersion: 0, hasEvidence: false };
  const payload = await response.json() as Envelope<ZoneDeliveryView>;
  const documents = payload.data?.documents ?? [];
  return {
    rowVersion: payload.data?.rowVersion ?? 0,
    hasEvidence: documents.some(document =>
      document.active && (document.documentType === 'fac' || document.documentType === 'cac')),
  };
}

async function uploadDocument(
  submission: HandoverSubmission,
  documentType: 'fac' | 'cac',
  file: File,
  expectedRowVersion: number,
): Promise<number> {
  const form = new FormData();
  form.set('projectId', submission.projectId);
  form.set('zoneNo', String(submission.zoneNo));
  form.set('expectedRowVersion', String(expectedRowVersion));
  form.set('effectiveAt', submission.effectiveAt);
  form.set('source', SOURCE);
  form.set('documentType', documentType);
  if (submission.reason) form.set('reason', submission.reason);
  form.set('file', file);

  const response = await fetch('/api/zone-delivery/document', {
    method: 'POST',
    credentials: 'include',
    body: form,
  });
  const view = await unwrap<ZoneDeliveryView>(
    response,
    `Unable to upload the ${documentType.toUpperCase()}.`,
  );
  return view.rowVersion;
}

/**
 * Record a zone handover: upload the FAC, upload the CAC, then declare the
 * date. Three commands, because each document registration is itself an
 * audited write that bumps the zone's row version — so the version has to be
 * carried forward from each response rather than read once up front.
 *
 * The declaration is last on purpose. It refuses unless both documents are
 * already active, so a half-finished sequence leaves evidence on the zone but
 * no handover date. Re-running it then supersedes the documents it already
 * uploaded rather than duplicating them — but that counts as a correction, so
 * the retry needs a reason; `readZoneHandoverState` is what lets the dialog ask
 * for one before the operator submits.
 */
export async function submitZoneHandover(submission: HandoverSubmission): Promise<void> {
  const { rowVersion: current } = await readZoneHandoverState(
    submission.projectId,
    submission.zoneNo,
  );
  let rowVersion = current;
  rowVersion = await uploadDocument(submission, 'fac', submission.fac, rowVersion);
  rowVersion = await uploadDocument(submission, 'cac', submission.cac, rowVersion);

  const response = await fetch('/api/zone-delivery/zone', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: submission.projectId,
      zoneNo: submission.zoneNo,
      expectedRowVersion: rowVersion,
      effectiveAt: submission.effectiveAt,
      source: SOURCE,
      ...(submission.reason ? { reason: submission.reason } : {}),
    }),
  });
  await unwrap<ZoneDeliveryView>(response, 'Unable to record the zone handover.');
}
