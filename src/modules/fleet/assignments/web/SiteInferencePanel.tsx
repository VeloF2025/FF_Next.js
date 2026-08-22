import { useState } from 'react';
import type { SiteInferenceProposal } from '../inference/proposalQueries';
import type { AssignmentOption } from '../rosterQueries';

export interface SiteInferencePanelProps {
  proposals: SiteInferenceProposal[];
  projects: AssignmentOption[];
  canEdit: boolean;
  onDecide: (
    vehicleId: string,
    body: { decision: string; overrideProjectId?: string | null; expectedRevision: number | null },
  ) => Promise<void>;
  onApply: (vehicleId: string, confirmWarnings: boolean) => Promise<void>;
  onRevert: (vehicleId: string) => Promise<void>;
  onRecompute: () => Promise<void>;
}

const OUTCOME_LABEL: Record<string, string> = {
  confident: 'Confident',
  roaming: 'Roams between sites',
  insufficient_data: 'Not enough GPS',
  no_aoi_coverage: 'Never inside a project',
};

function percent(share: number | null): string {
  return share === null ? '—' : `${(share * 100).toFixed(1)}%`;
}

function hours(seconds: number): string {
  return `${(seconds / 3600).toFixed(1)}h`;
}

function evidence(proposal: SiteInferenceProposal): string {
  return `${percent(proposal.dominantShare)} of ${hours(proposal.dwellSeconds)} dwell · `
    + `${Math.round(proposal.pings)} pings · ${proposal.distinctDays} days`;
}

function day(iso: string | null): string {
  return typeof iso === 'string' ? iso.slice(0, 10) : 'unknown';
}

/**
 * Without this a vehicle that stopped reporting keeps its last `confident` row
 * looking identical to one recomputed this morning.
 */
function provenance(proposal: SiteInferenceProposal): string {
  return `Measured ${day(proposal.windowStart)} to ${day(proposal.windowEnd)}, `
    + `computed ${day(proposal.computedAt)}`;
}

/**
 * Proposals a person edits. Nothing here decides anything on its own: a row
 * only reaches the roster when someone assigns it and then applies it, and both
 * steps are separate buttons on purpose.
 */
export function SiteInferencePanel({
  proposals, projects, canEdit, onDecide, onApply, onRevert, onRecompute,
}: SiteInferencePanelProps) {
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(vehicleId: string, action: () => Promise<void>): Promise<void> {
    setPending(vehicleId);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Action failed');
    } finally {
      setPending(null);
    }
  }

  return <section className="space-y-3" aria-label="GPS site inference">
    <h2>GPS site inference</h2>
    <p>
      Suggestions from where each vehicle actually stood. Nothing is applied until
      a person assigns it and applies it.
    </p>
    {canEdit && <button
      type="button"
      disabled={pending !== null}
      onClick={() => void run('__recompute', onRecompute)}
    >Recompute from GPS</button>}
    {error && <p role="alert">{error}</p>}
    {proposals.length === 0 && <p>No proposals yet. Recompute to generate them.</p>}
    <ul>
      {proposals.map((proposal) => {
        const busy = pending === proposal.vehicleId;
        const override = overrides[proposal.vehicleId] ?? '';
        const canAssign = canEdit && (proposal.inferredProjectId !== null || override !== '');
        return <li key={proposal.vehicleId} className="space-y-1">
          <p>
            <strong>{proposal.registration}</strong>
            {' · '}{OUTCOME_LABEL[proposal.outcome] ?? proposal.outcome}
            {proposal.inferredProjectName !== null && ` · ${proposal.inferredProjectName}`}
          </p>
          <p>{evidence(proposal)}</p>
          <p>{provenance(proposal)}</p>
          {proposal.drivers.length === 0
            ? <p>No current driver</p>
            : <p>Driver: {proposal.drivers.map((driver) => driver.staffName).join(', ')}</p>}
          {proposal.drivers.some((driver) => driver.assignmentRegistration !== proposal.registration)
            && <p className="text-amber-300">
              The vehicle assignment records a different registration
              ({proposal.drivers.map((driver) => driver.assignmentRegistration).join(', ')}).
            </p>}
          {proposal.breakdown.length > 1 && <ul aria-label={`${proposal.registration} breakdown`}>
            {proposal.breakdown.map((entry) => <li key={entry.projectId}>
              {entry.projectName}: {percent(entry.share)} ({hours(entry.dwellSeconds)}, {entry.distinctDays} days)
            </li>)}
          </ul>}
          {proposal.decision !== null && <p>
            Decision: {proposal.decision}
            {proposal.decidedProjectName !== null && ` → ${proposal.decidedProjectName}`}
            {proposal.decisionMatchesInference === false && ' · differs from the current GPS reading'}
            {proposal.appliedAssignmentId !== null && ' · applied to the roster'}
            {typeof proposal.decidedAgainstComputedAt === 'string'
              && proposal.decidedAgainstComputedAt !== proposal.computedAt
              && ` · decided against evidence from ${day(proposal.decidedAgainstComputedAt)}`}
          </p>}
          {canEdit && <div className="flex flex-wrap gap-2">
            <select
              aria-label={`Override project for ${proposal.registration}`}
              value={override}
              onChange={(event) => setOverrides((current) => (
                { ...current, [proposal.vehicleId]: event.target.value }))}
            >
              <option value="">Use the inferred project</option>
              {projects.map((project) => <option key={project.id} value={project.id}>
                {project.label}
              </option>)}
            </select>
            <button
              type="button"
              disabled={busy || !canAssign}
              onClick={() => void run(proposal.vehicleId, () => onDecide(proposal.vehicleId, {
                decision: 'assigned',
                overrideProjectId: override === '' ? null : override,
                expectedRevision: proposal.decisionRevision,
              }))}
            >Assign</button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(proposal.vehicleId, () => onDecide(proposal.vehicleId, {
                decision: 'roaming_confirmed', expectedRevision: proposal.decisionRevision,
              }))}
            >Confirm roaming</button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(proposal.vehicleId, () => onDecide(proposal.vehicleId, {
                decision: 'rejected', expectedRevision: proposal.decisionRevision,
              }))}
            >Reject</button>
            <label>
              <input
                type="checkbox"
                aria-label={`Accept roster warnings for ${proposal.registration}`}
                checked={confirmed[proposal.vehicleId] === true}
                onChange={(event) => setConfirmed((current) => (
                  { ...current, [proposal.vehicleId]: event.target.checked }))}
              /> Accept roster warnings
            </label>
            <button
              type="button"
              disabled={busy || proposal.decision !== 'assigned' || proposal.appliedAssignmentId !== null}
              onClick={() => void run(proposal.vehicleId, () => onApply(
                proposal.vehicleId, confirmed[proposal.vehicleId] === true))}
            >Apply to roster</button>
            <button
              type="button"
              disabled={busy || proposal.appliedAssignmentId === null}
              onClick={() => void run(proposal.vehicleId, () => onRevert(proposal.vehicleId))}
            >Revert</button>
          </div>}
        </li>;
      })}
    </ul>
  </section>;
}
