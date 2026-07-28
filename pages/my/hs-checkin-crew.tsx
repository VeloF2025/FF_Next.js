/**
 * /my/hs-checkin-crew — a supervisor records today's H&S declaration for a
 * subcontractor crew in one submission.
 *
 * This is a lead ATTESTING for other people, not a personal declaration —
 * weaker evidence, and the page says so. The contractor picker is mandatory:
 * without a contractor_id the rows never reach the compliance gate they exist
 * to feed. GPS is captured silently — no permission banner to fight on site.
 */

import type { NextPage } from 'next';
import React from 'react';
import { useRouter } from 'next/router';
import { Users } from 'lucide-react';
import { MyPortalShell } from '@/modules/attendance/portal/client/MyPortalShell';
import {
  YesNo,
  ActivityPicker,
  type CheckinActivityOption,
  CHECKIN_CARD as cardCls,
} from '@/modules/health-safety/components/checkin/CheckinPrompts';
import {
  CrewRows,
  type CrewRowValue,
  type RosterMember,
} from '@/modules/health-safety/components/checkin/CrewRows';
import {
  CrewOutcome,
  type CrewSubmitResult,
} from '@/modules/health-safety/components/checkin/CrewOutcome';

interface Project {
  id: string;
  project_name: string;
}
interface Contractor {
  id: string;
  company_name: string;
}

function newCrewRow(key: number): CrewRowValue {
  return { key, name: '', teamMemberId: null, fit: true };
}

const labelCls = 'block text-sm font-medium text-neutral-200 mb-2';
const inputCls =
  'w-full px-3 py-2.5 bg-neutral-950 border border-neutral-700 rounded-lg text-neutral-100 focus:outline-none focus:ring-2 focus:ring-emerald-500';

const HsCheckinCrewPage: NextPage & { getLayout?: (p: React.ReactElement) => React.ReactElement } = () => {
  const router = useRouter();
  const [loading, setLoading] = React.useState(true);
  const [notAllowed, setNotAllowed] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<{ requested: number; result: CrewSubmitResult } | null>(null);

  const [projects, setProjects] = React.useState<Project[]>([]);
  const [contractors, setContractors] = React.useState<Contractor[]>([]);
  const [roster, setRoster] = React.useState<RosterMember[]>([]);
  const [activities, setActivities] = React.useState<CheckinActivityOption[]>([]);

  const [projectId, setProjectId] = React.useState('');
  const [contractorId, setContractorId] = React.useState('');
  const [ppe, setPpe] = React.useState<boolean | null>(null);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [hazard, setHazard] = React.useState('');
  const [rows, setRows] = React.useState<CrewRowValue[]>([newCrewRow(1)]);
  const gps = React.useRef<{ lat: number; lon: number } | null>(null);

  React.useEffect(() => {
    fetch('/api/my/hs/checkin-crew', { credentials: 'include' })
      .then(async (r) => {
        if (r.status === 403) {
          setNotAllowed(true);
          return null;
        }
        // Any other failure (expired session, server error) must NOT fall
        // through to an empty, silently unusable form.
        if (!r.ok) throw new Error(`bootstrap failed: ${r.status}`);
        return r.json();
      })
      .then((j) => {
        if (j == null) return; // 403 path
        const d = j?.data;
        if (!d) throw new Error('bootstrap returned no data');
        setProjects(d.projects ?? []);
        setContractors(d.contractors ?? []);
        setRoster(d.team_members ?? []);
        setActivities(d.activities ?? []);
      })
      .catch(() => setError('Could not load the form. Check your signal and try again.'))
      .finally(() => setLoading(false));
  }, []);

  // Silent GPS: best-effort, never blocks the submission and never nags.
  React.useEffect(() => {
    navigator.geolocation?.getCurrentPosition(
      (pos) => {
        gps.current = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      },
      () => {
        /* no position — submit without one */
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }, []);

  // A member registered to a DIFFERENT contractor would be refused by the
  // server, so it is not offered. NULL contractor_id stays selectable (today:
  // every live row) — the server records these as contractor_link_unverified.
  const rosterForContractor = contractorId
    ? roster.filter((m) => !m.contractor_id || m.contractor_id === contractorId)
    : [];

  function changeContractor(id: string) {
    setContractorId(id);
    // Roster links belong to the previous contractor's filter: kept, they leave
    // rows locked to a worker the picker no longer offers and the server 400s
    // the submit as cross-contractor. Names stay; the lead relinks under the
    // new roster.
    setRows((prev) => prev.map((r) => (r.teamMemberId ? { ...r, teamMemberId: null } : r)));
  }

  async function submit() {
    setError(null);
    if (!projectId) return setError('Choose which project the crew is on today.');
    if (!contractorId) return setError('Choose the contractor this crew works for.');
    if (ppe === null) return setError('Answer whether the crew has its PPE.');
    if (rows.some((r) => !r.name.trim())) {
      return setError('Every crew member needs a name — remove empty rows.');
    }

    setSaving(true);
    try {
      const res = await fetch('/api/my/hs/checkin-crew', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          project_id: projectId,
          contractor_id: contractorId,
          ppe_complete: ppe,
          declared_activities: selected,
          hazard_reported: hazard.trim() || undefined,
          lat: gps.current?.lat,
          lon: gps.current?.lon,
          crew: rows.map((r) => ({
            worker_name: r.name.trim(),
            team_member_id: r.teamMemberId ?? undefined,
            fit_for_duty: r.fit,
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok || json?.success === false) {
        setError(json?.error?.message || 'Could not save the crew check-in.');
        setSaving(false);
        return;
      }
      setDone({ requested: rows.length, result: json.data });
    } catch {
      setError('Network error. The crew check-in was not saved — try again.');
      setSaving(false);
    }
  }

  function recordAnother() {
    // Keep project + contractor; every declaration must be made afresh.
    setRows([newCrewRow(1)]);
    setPpe(null);
    setSelected([]);
    setHazard('');
    setDone(null);
    setSaving(false);
  }

  if (loading) {
    return (
      <MyPortalShell title="Crew H&S check-in" showFooterNav={false}>
        <div className="pt-20 text-center text-sm text-neutral-400">Loading…</div>
      </MyPortalShell>
    );
  }

  if (notAllowed) {
    return (
      <MyPortalShell title="Crew H&S check-in" showFooterNav={false}>
        <div className={`${cardCls} text-center`}>
          <p className="text-neutral-200">
            Only a supervisor or admin can record a crew check-in.
          </p>
          <button
            onClick={() => router.push('/my')}
            className="mt-5 w-full px-4 py-2.5 bg-neutral-800 text-neutral-100 rounded-lg"
          >
            Back to hub
          </button>
        </div>
      </MyPortalShell>
    );
  }

  if (done) {
    return (
      <MyPortalShell title="Crew H&S check-in" showFooterNav={false}>
        <CrewOutcome
          requested={done.requested}
          result={done.result}
          onRecordAnother={recordAnother}
          onDone={() => router.push('/my')}
        />
      </MyPortalShell>
    );
  }

  return (
    <MyPortalShell title="Crew H&S check-in" showFooterNav={false}>
      <div className="space-y-4 pb-8">
        <div className="flex items-center gap-2 text-neutral-300">
          <Users className="w-5 h-5 text-emerald-400" />
          <p className="text-sm">
            You are signing for your crew — each answer is recorded in your name.
          </p>
        </div>

        {error && (
          <div role="alert" className="rounded-lg bg-red-950/50 border border-red-800 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className={cardCls}>
          <label className={labelCls} htmlFor="project">Which project is the crew on today?</label>
          <select id="project" className={inputCls} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Choose a project…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.project_name}</option>
            ))}
          </select>
        </div>

        <div className={cardCls}>
          <label className={labelCls} htmlFor="contractor">Which contractor do they work for?</label>
          <select id="contractor" className={inputCls} value={contractorId} onChange={(e) => changeContractor(e.target.value)}>
            <option value="">Choose a contractor…</option>
            {contractors.map((c) => (
              <option key={c.id} value={c.id}>{c.company_name}</option>
            ))}
          </select>
        </div>

        <div className={cardCls}>
          <span className={labelCls}>Does the whole crew have the PPE it needs today?</span>
          <YesNo value={ppe} onChange={setPpe} noLabel="No, something is missing" yesLabel="Yes, all of it" />
        </div>

        <div className={cardCls}>
          <span className={labelCls}>Will the crew do any of these today?</span>
          <p className="text-xs text-neutral-400 mb-3">Leave them all unticked if none apply.</p>
          <ActivityPicker options={activities} selected={selected} onChange={setSelected} />
        </div>

        <div>
          <span className={labelCls}>Who is on the crew today?</span>
          <CrewRows rows={rows} roster={rosterForContractor} onChange={setRows} />
        </div>

        <div className={cardCls}>
          <label className={labelCls} htmlFor="hazard">Seen anything unsafe? (optional)</label>
          <textarea
            id="hazard"
            className={inputCls}
            rows={3}
            placeholder="e.g. open trench with no barrier near the gate"
            value={hazard}
            onChange={(e) => setHazard(e.target.value)}
          />
          <p className="mt-2 text-xs text-neutral-400">
            This goes straight to the risk register. Reporting a hazard never counts against anyone.
          </p>
        </div>

        <button
          onClick={submit}
          disabled={saving}
          className="w-full px-4 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-medium rounded-lg"
        >
          {saving ? 'Saving…' : `Submit crew check-in (${rows.length})`}
        </button>
      </div>
    </MyPortalShell>
  );
};

HsCheckinCrewPage.getLayout = (page: React.ReactElement) => page;

export const getServerSideProps = async () => ({ props: {} });

export default HsCheckinCrewPage;
