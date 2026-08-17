import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CreateRuleVersionInput, OperationalStatusRule } from '../ruleQueries';
import { operationsApi, RULE_FIELDS } from './operationsApi';

type NumericKey = (typeof RULE_FIELDS)[number]['key'];
type Draft = Record<NumericKey, string> & { effectiveFrom: string; changeReason: string };
const inputUnit: Record<string, string> = { min: 'minutes', m: 'metres', readings: 'readings', 'km/h': 'km/h' };
function effectiveDefault(): string { const value = new Date(Date.now() + 5 * 60_000); value.setMinutes(value.getMinutes() - value.getTimezoneOffset()); return value.toISOString().slice(0, 16); }
function draftFrom(rule: OperationalStatusRule): Draft { return Object.assign({ effectiveFrom: effectiveDefault(), changeReason: '' }, Object.fromEntries(RULE_FIELDS.map((field) => [field.key, String(rule[field.key])]))) as Draft; }
function fieldError(field: (typeof RULE_FIELDS)[number], value: string): string | null {
  const number = Number(value); if (!value.trim() || !Number.isFinite(number) || number < field.minimum) {
    if (field.key === 'approachingMinReadings') return 'Use a whole number of at least 2.';
    return field.integer ? 'Use a non-negative whole number.' : 'Use a non-negative number.';
  }
  if (field.integer && !Number.isInteger(number)) return 'Use a non-negative whole number.'; return null;
}
function toInput(rule: OperationalStatusRule, draft: Draft): CreateRuleVersionInput {
  return { timezone: rule.timezone, effectiveFrom: new Date(draft.effectiveFrom).toISOString(), changeReason: draft.changeReason.trim(),
    monitoringBeforeMinutes: Number(draft.monitoringBeforeMinutes), monitoringAfterMinutes: Number(draft.monitoringAfterMinutes), arrivalDwellMinutes: Number(draft.arrivalDwellMinutes),
    wrongSiteConfirmationMinutes: Number(draft.wrongSiteConfirmationMinutes), earlyDepartureConfirmationMinutes: Number(draft.earlyDepartureConfirmationMinutes),
    approachingDistanceMeters: Number(draft.approachingDistanceMeters), approachingMinReadings: Number(draft.approachingMinReadings),
    minimumMovingSpeedKmh: Number(draft.minimumMovingSpeedKmh), evidenceMismatchToleranceMeters: Number(draft.evidenceMismatchToleranceMeters) };
}

export function StatusRulesDialog({ open, onClose, canEdit }: { open: boolean; onClose: () => void; canEdit: boolean }) {
  const [rules, setRules] = useState<OperationalStatusRule[]>([]); const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(false); const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { setLoading(true); try { const next = await operationsApi.listRules(); setRules(next); if (next[0]) setDraft(draftFrom(next[0])); setError(null); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not load operational rules'); } finally { setLoading(false); } }, []);
  useEffect(() => { if (open) void load(); }, [open, load]);
  const current = rules.find((rule) => rule.effectiveTo === null) ?? rules[0];
  const errors = useMemo(() => new Map(RULE_FIELDS.map((field) => [field.key, draft ? fieldError(field, draft[field.key]) : 'Required'])), [draft]);
  const changes = current && draft ? RULE_FIELDS.filter((field) => Number(draft[field.key]) !== current[field.key]) : [];
  const valid = Boolean(current && draft?.changeReason.trim() && draft.effectiveFrom && Date.parse(draft.effectiveFrom) > Date.now() && [...errors.values()].every((value) => value === null));
  async function create() { if (!current || !draft || !valid) return; setSaving(true); setError(null); try { await operationsApi.createRule(toInput(current, draft)); await load(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not create rule version'); } finally { setSaving(false); } }
  if (!open) return null;
  return <div role="dialog" aria-modal="true" aria-label="Operational status rules" className="fixed inset-0 z-50 overflow-auto bg-black/60 p-6"><div className="mx-auto max-w-4xl space-y-4 rounded-lg bg-[var(--ff-bg-primary)] p-6">
    <header className="flex justify-between"><div><h2 className="text-xl font-semibold">Operational status rules</h2><p>Versioned thresholds use {current?.timezone ?? 'Africa/Johannesburg'}.</p></div><button type="button" onClick={onClose} aria-label="Close status rules">Close</button></header>
    {loading && !current && <p>Loading rules…</p>}{error && <p role="alert" className="text-red-400">{error}</p>}
    <p className="rounded border p-3"><strong>GPS freshness is read-only.</strong> Provider/account freshness remains managed by tracking-provider configuration.</p>
    {current && draft && canEdit && <section className="space-y-3" aria-label="Create rule version"><h3 className="font-semibold">Current thresholds</h3><div className="grid gap-3 md:grid-cols-3">
      {RULE_FIELDS.map((field) => <label key={field.key}>{field.label} ({inputUnit[field.unit]})<input className="block w-full" aria-label={`${field.label} (${inputUnit[field.unit]})`} type="number" step={field.integer ? 1 : 'any'} min={field.minimum} value={draft[field.key]} onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })} />{errors.get(field.key) && <span className="text-sm text-red-400">{errors.get(field.key)}</span>}</label>)}
      </div><label>Effective from<input className="block" aria-label="Effective from" type="datetime-local" value={draft.effectiveFrom} min={effectiveDefault()} onChange={(event) => setDraft({ ...draft, effectiveFrom: event.target.value })} /></label>
      <label>Change reason<textarea className="block w-full" aria-label="Change reason" value={draft.changeReason} onChange={(event) => setDraft({ ...draft, changeReason: event.target.value })} /></label>
      <section aria-label="Rule change summary"><h3 className="font-semibold">Before / after</h3>{changes.length ? <ul>{changes.map((field) => <li key={field.key}>{field.label}: {current[field.key]} {field.unit} → {draft[field.key]} {field.unit}</li>)}</ul> : <p>No threshold changes.</p>}</section>
      <button type="button" disabled={!valid || saving} onClick={() => void create()}>{saving ? 'Creating version…' : 'Create rule version'}</button>
    </section>}
    <section aria-label="Rule history"><h3 className="font-semibold">Version history</h3>{rules.map((rule) => <article key={rule.id} className="border-t py-2"><strong>Version {rule.version}</strong><span> · effective {new Date(rule.effectiveFrom).toLocaleString()}</span><p>{rule.changeReason ?? 'No reason recorded'}</p></article>)}</section>
  </div></div>;
}
