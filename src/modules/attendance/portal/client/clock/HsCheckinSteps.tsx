/**
 * The H&S daily declaration, asked inline right after a clock-in.
 *
 * The clock-in has already committed by the time this renders: onDone() is
 * called unconditionally once the worker finishes, even when the POST fails.
 * A failed declaration must never look to the worker like a failed clock-in.
 *
 * Wording is shared with pages/my/hs-checkin.tsx via CheckinPrompts — the two
 * entry points must ask the same questions in the same words.
 */

import React from 'react';
import { log } from '@/lib/logger';
import {
  CheckinOutcome,
  CHECKIN_CARD,
  type CheckinActivityOption,
} from '@/modules/health-safety/components/checkin/CheckinPrompts';
import { HsCheckinSiteQuestions, LocationOption, FitForDutyCard } from './HsCheckinSiteQuestions';

interface Project {
  id: string;
  project_name: string;
}

type WorkLocation = 'site' | 'office';

const labelCls = 'block text-sm font-medium text-neutral-200 mb-2';

export function HsCheckinSteps(props: {
  attendanceEntryId: string | null;
  gps: { lat: number; lon: number } | null;
  onDone: () => void;
}) {
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [skip, setSkip] = React.useState(false);
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [activities, setActivities] = React.useState<CheckinActivityOption[]>([]);
  const [location, setLocation] = React.useState<WorkLocation | null>(null);
  const [projectId, setProjectId] = React.useState('');
  const [fit, setFit] = React.useState<boolean | null>(null);
  const [ppe, setPpe] = React.useState<boolean | null>(null);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [hazard, setHazard] = React.useState('');
  const [medicalStatus, setMedicalStatus] = React.useState<string | null>(null);
  const [outcome, setOutcome] = React.useState<{ clearance: string; reasons: string[] } | null>(
    null
  );

  React.useEffect(() => {
    fetch('/api/my/hs/checkin', { credentials: 'include' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`bootstrap failed: ${r.status}`);
        return r.json();
      })
      .then((j) => {
        const d = j?.data;
        if (!d) throw new Error('bootstrap returned no data');
        if (d.completed) {
          props.onDone();
          setSkip(true);
          return;
        }
        setProjects(d.projects ?? []);
        setActivities(d.activities ?? []);
        setProjectId(d.default_project_id ?? '');
        setMedicalStatus(d.medical_status ?? null);
      })
      .catch((err) => {
        // A declaration is not payroll-critical — a broken bootstrap must not
        // block the worker from finishing the clock-in flow.
        log.error('[HsCheckinSteps] bootstrap failed', { err });
        props.onDone();
        setSkip(true);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit() {
    if (fit === null) return;
    if (location === 'site' && (!projectId || ppe === null)) return;

    setSaving(true);
    const isOffice = location === 'office';
    try {
      const res = await fetch('/api/my/hs/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          work_location: location,
          ...(isOffice
            ? {}
            : { project_id: projectId, ppe_complete: ppe, declared_activities: selected }),
          fit_for_duty: fit,
          hazard_reported: isOffice ? undefined : hazard.trim() || undefined,
          attendance_entry_id: props.attendanceEntryId ?? undefined,
          lat: props.gps?.lat,
          lon: props.gps?.lon,
        }),
      });
      const json = await res.json();
      if (!res.ok || json?.success === false) {
        props.onDone();
        return;
      }
      setOutcome({
        clearance: json.data.clearance ?? json.data.checkin?.clearance ?? 'cleared',
        reasons: json.data.blocked_reasons ?? [],
      });
    } catch (err) {
      log.error('[HsCheckinSteps] submit failed', { err });
      props.onDone();
    } finally {
      setSaving(false);
    }
  }

  if (skip || loading) return <></>;

  if (outcome) {
    const blocked = outcome.clearance === 'blocked';
    return (
      <div className="space-y-3">
        <CheckinOutcome clearance={outcome.clearance} reasons={outcome.reasons} onDone={props.onDone} />
        {blocked && (
          <p className={`${CHECKIN_CARD} text-sm text-amber-300`}>
            Your time has been recorded for today&apos;s shift already — that is not affected. Report
            to your supervisor before you start work.
          </p>
        )}
      </div>
    );
  }

  const canSubmit =
    fit !== null && (location === 'office' || (location === 'site' && !!projectId && ppe !== null));

  return (
    <div className="space-y-4">
      <div className={CHECKIN_CARD}>
        <span className={labelCls}>Where are you working today?</span>
        <div className="grid grid-cols-1 gap-2">
          <LocationOption
            label="Office"
            active={location === 'office'}
            onClick={() => setLocation('office')}
          />
          {projects.map((p) => (
            <LocationOption
              key={p.id}
              label={p.project_name}
              active={location === 'site' && projectId === p.id}
              onClick={() => {
                setLocation('site');
                setProjectId(p.id);
              }}
            />
          ))}
        </div>
      </div>

      {location && <FitForDutyCard fit={fit} onChange={setFit} />}

      {location === 'site' && (
        <HsCheckinSiteQuestions
          ppe={ppe}
          onPpeChange={setPpe}
          activities={activities}
          selected={selected}
          onSelectedChange={setSelected}
          hazard={hazard}
          onHazardChange={setHazard}
          medicalStatus={medicalStatus}
        />
      )}

      {location && (
        <button
          type="button"
          onClick={submit}
          disabled={saving || !canSubmit}
          className="w-full px-4 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-medium rounded-lg"
        >
          {saving ? 'Saving…' : 'Submit'}
        </button>
      )}
    </div>
  );
}
