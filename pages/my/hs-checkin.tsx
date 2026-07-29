/**
 * /my/hs-checkin — the daily H&S declaration.
 *
 * Wording matters more than the code here: this is a legal declaration made by
 * someone standing on a site, often in a hurry. Every question is phrased so
 * that the SAFE answer is the honest one, and so that answering truthfully is
 * never the slower path.
 *
 * Fitness is asked as a plain yes/no rather than a checklist of symptoms —
 * a list invites people to tick past it, and the question we actually need
 * answered is the simple one.
 */

import type { NextPage } from 'next';
import React from 'react';
import { useRouter } from 'next/router';
import { MyPortalShell } from '@/modules/attendance/portal/client/MyPortalShell';
import { ShieldCheck } from 'lucide-react';
import {
  YesNo,
  CheckinOutcome,
  CheckinAlreadyDone,
  CHECKIN_CARD as cardCls,
} from '@/modules/health-safety/components/checkin/CheckinPrompts';

interface ActivityOption {
  value: string;
  label: string;
  requires_medical: boolean;
}
interface Project {
  id: string;
  project_name: string;
}

const labelCls = 'block text-sm font-medium text-neutral-200 mb-2';
const inputCls =
  'w-full px-3 py-2.5 bg-neutral-950 border border-neutral-700 rounded-lg text-neutral-100 focus:outline-none focus:ring-2 focus:ring-emerald-500';

const HsCheckinPage: NextPage & { getLayout?: (p: React.ReactElement) => React.ReactElement } = () => {
  const router = useRouter();
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<{ clearance: string; reasons: string[] } | null>(null);

  const [projects, setProjects] = React.useState<Project[]>([]);
  const [activities, setActivities] = React.useState<ActivityOption[]>([]);
  const [medicalStatus, setMedicalStatus] = React.useState<string | null>(null);
  const [alreadyDone, setAlreadyDone] = React.useState(false);

  const [projectId, setProjectId] = React.useState('');
  const [fit, setFit] = React.useState<boolean | null>(null);
  const [ppe, setPpe] = React.useState<boolean | null>(null);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [hazard, setHazard] = React.useState('');

  React.useEffect(() => {
    fetch('/api/my/hs/checkin', { credentials: 'include' })
      .then(async (r) => {
        // A failed bootstrap must surface an error instead of falling through
        // to an empty, silently unusable form.
        if (!r.ok) throw new Error(`bootstrap failed: ${r.status}`);
        return r.json();
      })
      .then((j) => {
        const d = j?.data;
        if (!d) throw new Error('bootstrap returned no data');
        setProjects(d.projects ?? []);
        setActivities(d.activities ?? []);
        setMedicalStatus(d.medical_status ?? null);
        setProjectId(d.default_project_id ?? '');
        if (d.completed) setAlreadyDone(true);
      })
      .catch(() => setError('Could not load the check-in. Check your signal and try again.'))
      .finally(() => setLoading(false));
  }, []);

  const medicalGated = selected.some(
    (s) => activities.find((a) => a.value === s)?.requires_medical
  );

  async function submit() {
    setError(null);
    if (!projectId) return setError('Choose which project you are on today.');
    if (fit === null) return setError('Answer whether you are fit for duty.');
    if (ppe === null) return setError('Answer whether you have your PPE.');

    setSaving(true);
    try {
      const res = await fetch('/api/my/hs/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          project_id: projectId,
          fit_for_duty: fit,
          ppe_complete: ppe,
          declared_activities: selected,
          hazard_reported: hazard.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || json?.success === false) {
        setError(json?.error?.message || 'Could not save your check-in.');
        setSaving(false);
        return;
      }
      setDone({
        clearance: json.data.clearance ?? json.data.checkin?.clearance ?? 'cleared',
        reasons: json.data.blocked_reasons ?? [],
      });
    } catch {
      setError('Network error. Your check-in was not saved — try again.');
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <MyPortalShell title="H&S check-in" showFooterNav={false}>
        <div className="pt-20 text-center text-sm text-neutral-400">Loading…</div>
      </MyPortalShell>
    );
  }

  if (done) {
    return (
      <MyPortalShell title="H&S check-in" showFooterNav={false}>
        <CheckinOutcome
          clearance={done.clearance}
          reasons={done.reasons}
          onDone={() => router.push('/my')}
        />
      </MyPortalShell>
    );
  }

  if (alreadyDone) {
    return (
      <MyPortalShell title="H&S check-in" showFooterNav={false}>
        <CheckinAlreadyDone onDone={() => router.push('/my')} />
      </MyPortalShell>
    );
  }

  return (
    <MyPortalShell title="H&S check-in" showFooterNav={false}>
      <div className="space-y-4 pb-8">
        <div className="flex items-center gap-2 text-neutral-300">
          <ShieldCheck className="w-5 h-5 text-emerald-400" />
          <p className="text-sm">Takes about 20 seconds. Answer honestly — that is the point.</p>
        </div>

        {error && (
          <div role="alert" className="rounded-lg bg-red-950/50 border border-red-800 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className={cardCls}>
          <label className={labelCls} htmlFor="project">Which project are you on today?</label>
          <select id="project" className={inputCls} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Choose a project…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.project_name}</option>
            ))}
          </select>
        </div>

        <div className={cardCls}>
          <span className={labelCls}>Are you fit and well enough to work safely today?</span>
          <YesNo value={fit} onChange={setFit} noLabel="No, I am not" yesLabel="Yes, I am" />
          {fit === false && (
            <p className="mt-3 text-sm text-amber-300">
              Thank you for saying so. You will not be cleared to start, and someone will contact you.
              You can still clock in — your time today is not affected by this answer.
            </p>
          )}
        </div>

        <div className={cardCls}>
          <span className={labelCls}>Do you have all the PPE you need for today?</span>
          <YesNo value={ppe} onChange={setPpe} noLabel="No, something is missing" yesLabel="Yes, all of it" />
        </div>

        <div className={cardCls}>
          <span className={labelCls}>Will you do any of these today?</span>
          <p className="text-xs text-neutral-400 mb-3">Leave them all unticked if none apply.</p>
          <div className="space-y-2">
            {activities.map((a) => (
              <label key={a.value} className="flex items-center gap-3 text-sm text-neutral-200">
                <input
                  type="checkbox"
                  className="w-4 h-4"
                  checked={selected.includes(a.value)}
                  onChange={(e) =>
                    setSelected((prev) =>
                      e.target.checked ? [...prev, a.value] : prev.filter((v) => v !== a.value)
                    )
                  }
                />
                {a.label}
                {a.requires_medical && (
                  <span className="text-xs text-neutral-500">needs a medical</span>
                )}
              </label>
            ))}
          </div>
          {medicalGated && medicalStatus && medicalStatus !== 'current' && (
            <p className="mt-3 text-sm text-red-300">
              Our records show no current Certificate of Fitness for you. If you select this work you
              will not be cleared to do it — speak to the H&S officer.
            </p>
          )}
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
            This goes straight to the risk register. Reporting a hazard never counts against you.
          </p>
        </div>

        <button
          onClick={submit}
          disabled={saving}
          className="w-full px-4 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-medium rounded-lg"
        >
          {saving ? 'Saving…' : 'Submit check-in'}
        </button>
      </div>
    </MyPortalShell>
  );
};

HsCheckinPage.getLayout = (page: React.ReactElement) => page;

export const getServerSideProps = async () => ({ props: {} });

export default HsCheckinPage;
