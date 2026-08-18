/**
 * Fleet incident oversight-membership controls, split out of
 * `IncidentSettingsDialog.tsx` (Task 8) to keep that file under the
 * 200-line component cap once name resolution was added here.
 *
 * Membership rows render a resolved display name, never the raw `userId`
 * UUID — `useOversightUserNames` resolves names (active users only) via
 * `incidentApi.resolveOversightUserNames`, which is scoped to
 * `fleet.incidents-settings:edit` just like the add-member search below.
 * No person is ever hardcoded — membership is only ever added by searching
 * active FibreFlow users through `incidentApi.searchActiveUsers`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OversightMembership } from '../types';
import { incidentApi, IncidentApiError, type ActiveUserOption } from './incidentApi';

/** Resolves display names for a set of user ids, fetching only ids not already known.
 * Uses a ref (not a `names` dependency) so a resolved batch never re-triggers itself. */
function useOversightUserNames(userIds: readonly string[]): Record<string, string> {
  const [names, setNames] = useState<Record<string, string>>({});
  const namesRef = useRef(names);
  namesRef.current = names;
  const key = useMemo(() => Array.from(new Set(userIds)).sort().join(','), [userIds]);
  useEffect(() => {
    const ids = key ? key.split(',') : [];
    const missing = ids.filter((id) => !(id in namesRef.current));
    if (missing.length === 0) return;
    let cancelled = false;
    incidentApi.resolveOversightUserNames(missing)
      .then((resolved) => {
        if (cancelled || resolved.length === 0) return;
        setNames((previous) => ({ ...previous, ...Object.fromEntries(resolved.map((user) => [user.id, user.name])) }));
      })
      .catch(() => { /* Row stays on the "Resolving…" placeholder; never falls back to the raw UUID. */ });
    return () => { cancelled = true; };
  }, [key]);
  return names;
}

export function OversightSection({ canEdit }: { canEdit: boolean }) {
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
  const knownUserIds = useMemo(() => {
    const ids = members.map((member) => member.userId);
    return history ? [...ids, ...history.map((member) => member.userId)] : ids;
  }, [members, history]);
  const names = useOversightUserNames(knownUserIds);
  const displayName = (userId: string): string => names[userId] ?? 'Resolving…';
  return (
    <section aria-label="Fleet oversight membership" className="space-y-2">
      <h3 className="font-semibold text-[var(--ff-text-primary)]">Oversight membership</h3>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <ul>{members.map((member) => <li key={member.id} className="flex items-center gap-2 text-sm">
        <span>{displayName(member.userId)}</span>
        {canEdit && <><input aria-label={`Reason to end membership for ${displayName(member.userId)}`} value={endReasons[member.id] ?? ''}
          onChange={(event) => setEndReasons({ ...endReasons, [member.id]: event.target.value })} placeholder="Reason to end" className="rounded border px-2 py-1" />
        <button type="button" disabled={!(endReasons[member.id] ?? '').trim() || busy === member.id} onClick={() => void end(member)} className="rounded border px-2 py-1 disabled:opacity-50">End</button></>}
      </li>)}</ul>
      {canEdit && <div className="space-y-1">
        <label className="text-sm">Search active FibreFlow users
          <input aria-label="Search active FibreFlow users" value={query} onChange={(event) => setQuery(event.target.value)} className="ml-2 rounded border px-2 py-1" />
        </label>
        <ul>{matches.map((match) => <li key={match.id} className="text-sm">{match.name}{' '}
          <button type="button" disabled={busy === match.id} onClick={() => void add(match)} className="rounded border px-2 py-1">Add</button>
        </li>)}</ul>
      </div>}
      <button type="button" onClick={() => void toggleHistory()} className="text-sm underline">{history ? 'Hide' : 'Show'} history</button>
      {history && <ul>{history.map((member) => <li key={member.id} className="text-sm">{displayName(member.userId)}: {member.effectiveFrom} to {member.effectiveTo} — {member.reason ?? 'No reason recorded'}</li>)}</ul>}
    </section>
  );
}
