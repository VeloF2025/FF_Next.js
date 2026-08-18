/**
 * Compact rules and oversight settings dialog (Task 8), opened from the
 * queue rather than a separate settings page (design §11.1). `canEdit`
 * gates every mutation control; a view-only visitor (or a closed dialog)
 * only ever reads. No person is ever hardcoded — oversight membership is
 * only ever added by searching active FibreFlow users through
 * `incidentApi.searchActiveUsers` (`/api/admin/users`).
 */
import { useCallback, useEffect, useState } from 'react';
import { OUTCOMES } from '../reviewValidation';
import type { IncidentOutcome, IncidentRule, IncidentSeverity, IncidentType, OversightMembership } from '../types';
import { incidentApi, IncidentApiError, type ActiveUserOption } from './incidentApi';
const RULED_TYPES: readonly IncidentType[] = ['late', 'wrong_site', 'evidence_mismatch', 'left_early'];
const SEVERITIES: readonly IncidentSeverity[] = ['normal', 'high', 'critical'];
type BooleanDraftKey = 'enabled' | 'createsIncident' | 'immediateNotification' | 'inApp' | 'email' | 'whatsapp' | 'includeInMorningSummary';
type NumberDraftKey = 'acknowledgementTargetMinutes' | 'reminderIntervalMinutes' | 'maximumEscalationLevel';
const BOOLEAN_FIELDS: ReadonlyArray<{ key: BooleanDraftKey; label: string }> = [
  { key: 'enabled', label: 'Enabled' }, { key: 'createsIncident', label: 'Creates incident' },
  { key: 'immediateNotification', label: 'Immediate notification' }, { key: 'inApp', label: 'In-app' },
  { key: 'email', label: 'Email' }, { key: 'whatsapp', label: 'WhatsApp' }, { key: 'includeInMorningSummary', label: 'Include in morning summary' },
];
const NUMBER_FIELDS: ReadonlyArray<{ key: NumberDraftKey; label: string; min: number }> = [
  { key: 'acknowledgementTargetMinutes', label: 'Acknowledgement target (min)', min: 1 },
  { key: 'reminderIntervalMinutes', label: 'Reminder interval (min)', min: 1 },
  { key: 'maximumEscalationLevel', label: 'Maximum escalation level', min: 0 },
];
type Draft = Record<BooleanDraftKey, boolean> & Record<NumberDraftKey, string> & {
  severity: IncidentSeverity; evidenceRequiredOutcomes: IncidentOutcome[]; effectiveFrom: string; changeReason: string;
};
function effectiveDefault(): string {
  const value = new Date(Date.now() + 5 * 60_000);
  value.setMinutes(value.getMinutes() - value.getTimezoneOffset());
  return value.toISOString().slice(0, 16);
}
function draftFrom(rule: IncidentRule): Draft {
  return {
    enabled: rule.enabled, createsIncident: rule.createsIncident, immediateNotification: rule.immediateNotification,
    inApp: rule.channels.inApp, email: rule.channels.email, whatsapp: rule.channels.whatsapp, includeInMorningSummary: rule.includeInMorningSummary,
    acknowledgementTargetMinutes: String(rule.acknowledgementTargetMinutes), reminderIntervalMinutes: String(rule.reminderIntervalMinutes),
    maximumEscalationLevel: String(rule.maximumEscalationLevel), severity: rule.severity, evidenceRequiredOutcomes: rule.evidenceRequiredOutcomes,
    effectiveFrom: effectiveDefault(), changeReason: '',
  };
}
function draftValid(draft: Draft | null): boolean {
  if (!draft || !draft.changeReason.trim() || !draft.effectiveFrom || Date.parse(draft.effectiveFrom) <= Date.now()) return false;
  return NUMBER_FIELDS.every((field) => Number.isInteger(Number(draft[field.key])) && Number(draft[field.key]) >= field.min);
}
function RulesSection({ canEdit }: { canEdit: boolean }) {
  const [incidentType, setIncidentType] = useState<IncidentType>('late');
  const [rules, setRules] = useState<IncidentRule[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { const next = await incidentApi.listRules(incidentType); setRules(next); setDraft(next[0] ? draftFrom(next[0]) : null); setError(null); }
    catch (caught) { setError(caught instanceof IncidentApiError ? caught.message : 'Could not load incident rules'); }
  }, [incidentType]);
  useEffect(() => { void load(); }, [load]);
  async function create(): Promise<void> {
    if (!draft || !draftValid(draft)) return;
    setSaving(true); setError(null);
    try {
      await incidentApi.createRuleVersion({
        incidentType, enabled: draft.enabled, createsIncident: draft.createsIncident, severity: draft.severity,
        immediateNotification: draft.immediateNotification, channels: { inApp: draft.inApp, email: draft.email, whatsapp: draft.whatsapp },
        includeInMorningSummary: draft.includeInMorningSummary, acknowledgementTargetMinutes: Number(draft.acknowledgementTargetMinutes),
        reminderIntervalMinutes: Number(draft.reminderIntervalMinutes), maximumEscalationLevel: Number(draft.maximumEscalationLevel),
        evidenceRequiredOutcomes: draft.evidenceRequiredOutcomes, effectiveFrom: new Date(draft.effectiveFrom).toISOString(), changeReason: draft.changeReason.trim(),
      });
      await load();
    } catch (caught) { setError(caught instanceof IncidentApiError ? caught.message : 'Could not create a rule version'); }
    finally { setSaving(false); }
  }
  function toggleOutcome(outcome: IncidentOutcome): void {
    if (!draft) return;
    const has = draft.evidenceRequiredOutcomes.includes(outcome);
    setDraft({ ...draft, evidenceRequiredOutcomes: has ? draft.evidenceRequiredOutcomes.filter((item) => item !== outcome) : [...draft.evidenceRequiredOutcomes, outcome] });
  }
  return (
    <section aria-label="Incident rules" className="space-y-2">
      <h3 className="font-semibold text-[var(--ff-text-primary)]">Rules</h3>
      <label className="text-sm">Incident type
        <select aria-label="Rule incident type" value={incidentType} onChange={(event) => setIncidentType(event.target.value as IncidentType)} className="ml-2 rounded border px-2 py-1">
          {RULED_TYPES.map((type) => <option key={type} value={type}>{type.replaceAll('_', ' ')}</option>)}
        </select>
      </label>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {draft && canEdit && <div className="space-y-2 rounded border p-3">
        {BOOLEAN_FIELDS.map((field) => <label key={field.key} className="mr-3 inline-block text-sm">
          <input type="checkbox" checked={draft[field.key]} onChange={(event) => setDraft({ ...draft, [field.key]: event.target.checked })} /> {field.label}
        </label>)}
        <label className="block text-sm">Severity
          <select aria-label="Rule severity" value={draft.severity} onChange={(event) => setDraft({ ...draft, severity: event.target.value as IncidentSeverity })} className="ml-2 rounded border px-2 py-1">
            {SEVERITIES.map((severity) => <option key={severity} value={severity}>{severity}</option>)}
          </select>
        </label>
        {NUMBER_FIELDS.map((field) => <label key={field.key} className="mr-3 inline-block text-sm">{field.label}
          <input aria-label={field.label} type="number" min={field.min} value={draft[field.key]} onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })} className="ml-2 w-20 rounded border px-2 py-1" />
        </label>)}
        <fieldset className="text-sm"><legend>Evidence required for outcome</legend>
          {OUTCOMES.map((outcome) => <label key={outcome} className="mr-3 inline-block"><input type="checkbox" checked={draft.evidenceRequiredOutcomes.includes(outcome)} onChange={() => toggleOutcome(outcome)} /> {outcome.replaceAll('_', ' ')}</label>)}
        </fieldset>
        <label className="block text-sm">Effective from
          <input aria-label="Rule effective from" type="datetime-local" min={effectiveDefault()} value={draft.effectiveFrom} onChange={(event) => setDraft({ ...draft, effectiveFrom: event.target.value })} className="ml-2 rounded border px-2 py-1" />
        </label>
        <label className="block text-sm">Change reason
          <textarea aria-label="Rule change reason" value={draft.changeReason} onChange={(event) => setDraft({ ...draft, changeReason: event.target.value })} className="block w-full rounded border px-2 py-1" />
        </label>
        <button type="button" disabled={!draftValid(draft) || saving} onClick={() => void create()} className="rounded bg-[var(--ff-primary)] px-3 py-2 text-sm text-white disabled:opacity-50">
          {saving ? 'Creating version…' : 'Create rule version'}
        </button>
      </div>}
      <details><summary className="cursor-pointer text-sm">Version history ({rules.length})</summary>
        {rules.map((rule) => <p key={rule.id} className="text-sm">v{rule.version} — effective {new Date(rule.effectiveFrom).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}{rule.effectiveTo ? ` to ${new Date(rule.effectiveTo).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}` : ' (current)'}</p>)}
      </details>
    </section>
  );
}
function OversightSection({ canEdit }: { canEdit: boolean }) {
  const [members, setMembers] = useState<OversightMembership[]>([]);
  const [history, setHistory] = useState<OversightMembership[] | null>(null);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<ActiveUserOption[]>([]);
  const [endReasons, setEndReasons] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setMembers(await incidentApi.listOversightMembers(true)); setError(null); }
    catch (caught) { setError(caught instanceof IncidentApiError ? caught.message : 'Could not load oversight membership'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!query.trim()) { setMatches([]); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => { void incidentApi.searchActiveUsers(query.trim(), controller.signal).then(setMatches).catch(() => setMatches([])); }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query]);
  async function toggleHistory(): Promise<void> {
    if (history) { setHistory(null); return; }
    try { setHistory((await incidentApi.listOversightMembers(false)).filter((member) => member.effectiveTo !== null)); }
    catch (caught) { setError(caught instanceof IncidentApiError ? caught.message : 'Could not load oversight history'); }
  }
  async function add(user: ActiveUserOption): Promise<void> {
    setBusy(user.id); setError(null);
    try { await incidentApi.addOversightMember({ userId: user.id, reason: null }); setQuery(''); setMatches([]); await load(); }
    catch (caught) { setError(caught instanceof IncidentApiError ? caught.message : 'Could not add this oversight member'); }
    finally { setBusy(null); }
  }
  async function end(membership: OversightMembership): Promise<void> {
    const reason = (endReasons[membership.id] ?? '').trim();
    if (!reason) return;
    setBusy(membership.id); setError(null);
    try { await incidentApi.endOversightMembership({ membershipId: membership.id, reason }); await load(); }
    catch (caught) { setError(caught instanceof IncidentApiError ? caught.message : 'Could not end this oversight membership'); }
    finally { setBusy(null); }
  }
  return (
    <section aria-label="Fleet oversight membership" className="space-y-2">
      <h3 className="font-semibold text-[var(--ff-text-primary)]">Oversight membership</h3>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <ul>{members.map((member) => <li key={member.id} className="flex items-center gap-2 text-sm">
        <span>{member.userId}</span>
        {canEdit && <><input aria-label={`Reason to end membership for ${member.userId}`} value={endReasons[member.id] ?? ''}
          onChange={(event) => setEndReasons({ ...endReasons, [member.id]: event.target.value })} placeholder="Reason to end" className="rounded border px-2 py-1" />
        <button type="button" disabled={!(endReasons[member.id] ?? '').trim() || busy === member.id} onClick={() => void end(member)} className="rounded border px-2 py-1 disabled:opacity-50">End</button></>}
      </li>)}</ul>
      {canEdit && <div className="space-y-1">
        <label className="text-sm">Search active FibreFlow users
          <input aria-label="Search active FibreFlow users" value={query} onChange={(event) => setQuery(event.target.value)} className="ml-2 rounded border px-2 py-1" />
        </label>
        <ul>{matches.map((match) => <li key={match.id} className="text-sm">{match.label} ({match.email}){' '}
          <button type="button" disabled={busy === match.id} onClick={() => void add(match)} className="rounded border px-2 py-1">Add</button>
        </li>)}</ul>
      </div>}
      <button type="button" onClick={() => void toggleHistory()} className="text-sm underline">{history ? 'Hide' : 'Show'} history</button>
      {history && <ul>{history.map((member) => <li key={member.id} className="text-sm">{member.userId}: {member.effectiveFrom} to {member.effectiveTo} — {member.reason ?? 'No reason recorded'}</li>)}</ul>}
    </section>
  );
}
export interface IncidentSettingsDialogProps { open: boolean; onClose: () => void; canEdit: boolean }
export function IncidentSettingsDialog({ open, onClose, canEdit }: IncidentSettingsDialogProps) {
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label="Fleet incident settings" className="fixed inset-0 z-50 overflow-auto bg-black/60 p-6"
      onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}>
      <div className="mx-auto max-w-3xl space-y-4 rounded-lg bg-[var(--ff-bg-primary)] p-6">
        <header className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-[var(--ff-text-primary)]">Fleet incident settings</h2>
          <button type="button" autoFocus onClick={onClose} aria-label="Close Fleet incident settings" className="rounded border px-3 py-2 text-sm">Close</button>
        </header>
        <RulesSection canEdit={canEdit} />
        <OversightSection canEdit={canEdit} />
      </div>
    </div>
  );
}
