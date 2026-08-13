import { useState } from 'react';
import type { AssignmentProposalRow } from '../types';
import { assignmentApi, AssignmentApiError, type AssignmentPreview } from './assignmentApi';
import { ConflictReview } from './ConflictReview';

export function AssignmentEditor({ rows, onCommitted }: { rows: AssignmentProposalRow[]; onCommitted: () => Promise<void> | void }) {
  const [preview, setPreview] = useState<AssignmentPreview | null>(null);
  const [confirmedWarnings, setConfirmedWarnings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocking = preview?.conflicts.some((item) => item.level === 'blocking') ?? false;
  const warnings = preview?.conflicts.some((item) => item.level === 'warning') ?? false;
  async function runPreview() { try { setError(null); setPreview(await assignmentApi.preview(rows)); setConfirmedWarnings(false); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Preview failed'); } }
  async function commit() { if (!preview) return; try { setError(null); await assignmentApi.commit(rows, preview, confirmedWarnings); setPreview(null); await onCommitted(); } catch (caught) { if (caught instanceof AssignmentApiError && caught.status === 409) setPreview(null); setError(caught instanceof Error ? caught.message : 'Commit failed'); } }
  return <section className="space-y-3" aria-label="Assignment editor">
    <button type="button" onClick={() => void runPreview()} disabled={!rows.length}>Preview assignments</button>
    {preview && <><ConflictReview conflicts={preview.conflicts} />{warnings && <label><input type="checkbox" checked={confirmedWarnings} onChange={(event) => setConfirmedWarnings(event.target.checked)} /> Confirm warnings</label>}<button type="button" onClick={() => void commit()} disabled={blocking || (warnings && !confirmedWarnings)}>Commit assignments</button></>}
    {error && <p role="alert" className="text-red-300">{error}</p>}
  </section>;
}
