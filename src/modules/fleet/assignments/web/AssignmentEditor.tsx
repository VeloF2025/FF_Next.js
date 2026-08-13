import { useMemo, useState } from 'react';
import type { AssignmentOptions } from '../rosterQueries';
import type { AssignmentKind, AssignmentProposalRow } from '../types';
import { assignmentApi, AssignmentApiError, type AssignmentPreview } from './assignmentApi';
import { ConflictReview } from './ConflictReview';

export function AssignmentEditor({ options, projectId, siteId, from, to, onCommitted }: { options: AssignmentOptions; projectId: string; siteId: string; from: string; to: string; onCommitted: () => Promise<void> | void }) {
  const [staffIds, setStaffIds] = useState<string[]>([]); const [vehicles, setVehicles] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [kind, setKind] = useState<AssignmentKind>('roster'); const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<AssignmentPreview | null>(null); const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false); const [error, setError] = useState<string | null>(null);
  const rows = useMemo<AssignmentProposalRow[]>(() => staffIds.map((staffId) => ({ staffId, projectId, operationalSiteId: siteId, startDate: from, endDate: kind === 'daily_override' ? from : to, assignmentKind: kind, vehicleAssignmentId: vehicles[staffId] || null, reason: kind === 'daily_override' ? reason.trim() || null : null })), [staffIds, projectId, siteId, from, to, kind, vehicles, reason]);
  const blocking = preview?.conflicts.some((item) => item.level === 'blocking') ?? false; const warnings = preview?.conflicts.some((item) => item.level === 'warning') ?? false;
  function toggleStaff(id: string) { setPreview(null); setStaffIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); }
  const teamRow = { projectId, operationalSiteId: siteId, startDate: from, endDate: kind === 'daily_override' ? from : to, assignmentKind: kind, vehicleAssignmentId: null, reason: kind === 'daily_override' ? reason.trim() || null : null };
  async function runPreview() { setPending(true); try { setError(null); setPreview(await assignmentApi.preview(rows, teamIds, teamIds.length ? teamRow : undefined)); setConfirmed(false); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Preview failed'); } finally { setPending(false); } }
  async function commit() { if (!preview || pending) return; setPending(true); try { setError(null); await assignmentApi.commit(rows, preview, confirmed, teamIds, teamIds.length ? teamRow : undefined); setPreview(null); setStaffIds([]); setTeamIds([]); await onCommitted(); } catch (caught) { if (caught instanceof AssignmentApiError) { if (caught.status === 409) setPreview(caught.conflicts.length ? { ...preview, conflicts: caught.conflicts } : null); } setError(caught instanceof Error ? caught.message : 'Commit failed'); } finally { setPending(false); } }
  const configured = Boolean(projectId && siteId && from && to);
  const visibleStaff = options.staff.filter((staff) => staff.label.toLowerCase().includes(search.trim().toLowerCase()));
  return <section className="space-y-3" aria-label="Assignment editor"><h2>Build assignment batch</h2>
    {!siteId && <p className="text-amber-300">Configure or select an operational site before assigning staff.</p>}
    <input aria-label="Search staff" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search staff" />
    <div className="space-y-2">{visibleStaff.map((staff) => <div key={staff.id}><label><input type="checkbox" checked={staffIds.includes(staff.id)} onChange={() => toggleStaff(staff.id)} /> {staff.label}</label>{staffIds.includes(staff.id) && <select aria-label={`Vehicle for ${staff.label}`} value={vehicles[staff.id] ?? ''} onChange={(event) => { setVehicles((current) => ({ ...current, [staff.id]: event.target.value })); setPreview(null); }}><option value="">No vehicle</option>{options.vehicles.filter((vehicle) => !vehicle.staffId || vehicle.staffId === staff.id).map((vehicle) => <option key={vehicle.vehicleAssignmentId ?? vehicle.id} value={vehicle.vehicleAssignmentId}>{vehicle.label}</option>)}</select>}</div>)}</div>
    <select aria-label="Teams" multiple value={teamIds} onChange={(event) => { setTeamIds(Array.from(event.target.selectedOptions, (option) => option.value)); setPreview(null); }}>{options.teams.map((team) => <option key={team.id} value={team.id}>{team.label}</option>)}</select>
    <select aria-label="Assignment kind" value={kind} onChange={(event) => { setKind(event.target.value as AssignmentKind); setPreview(null); }}><option value="roster">Roster</option><option value="daily_override">Daily override</option></select>
    {kind === 'daily_override' && <input aria-label="Override reason" value={reason} onChange={(event) => { setReason(event.target.value); setPreview(null); }} />}
    <button type="button" onClick={() => void runPreview()} disabled={pending || !configured || (!rows.length && !teamIds.length) || (kind === 'daily_override' && !reason.trim())}>Preview assignments</button>
    {preview && <><ConflictReview conflicts={preview.conflicts} />{preview.excludedStaffIds.length > 0 && <p>{preview.excludedStaffIds.length} inactive staff excluded</p>}{warnings && <label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> Confirm warnings</label>}<button type="button" onClick={() => void commit()} disabled={pending || blocking || (warnings && !confirmed)}>Commit assignments</button></>}
    {error && <p role="alert" className="text-red-300">{error}</p>}
  </section>;
}
