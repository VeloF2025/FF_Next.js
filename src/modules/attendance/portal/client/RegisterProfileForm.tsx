/**
 * Step-1 form for /my/register — collects name, phone, site, worker type,
 * optional ID number and optional selfie, then calls registerFieldWorker.
 */

import React from 'react';

import {
  ApiError,
  getRegisterSites,
  registerFieldWorker,
  type RegisterSite,
} from '@/modules/attendance/portal/client/api';
import { SelfieCaptureField } from '@/modules/attendance/portal/client/SelfieCaptureField';

export interface ProfileFormValues {
  firstName: string;
  lastName: string;
  phone: string;
}

interface Props {
  /** Called on successful registration. `phone` passed so verify step can use it. */
  onSuccess: (phone: string) => void;
}

// ── inner helper ────────────────────────────────────────────────────────────

interface SiteFieldProps {
  sites: RegisterSite[];
  sitesError: boolean;
  projectId: string;
  onChange: (id: string) => void;
  inputClass: string;
}

function SiteSelectField({ sites, sitesError, projectId, onChange, inputClass }: SiteFieldProps) {
  if (sitesError) {
    return <p className="mt-1 text-sm text-red-400">Could not load sites — please refresh.</p>;
  }
  return (
    <select
      value={projectId}
      onChange={(e) => onChange(e.target.value)}
      className={`${inputClass} cursor-pointer`}
      required
    >
      {sites.length === 0 && <option value="" disabled>Loading sites…</option>}
      {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
  );
}

// ── main component ───────────────────────────────────────────────────────────

export function RegisterProfileForm({ onSuccess }: Props) {
  const [sites, setSites] = React.useState<RegisterSite[]>([]);
  const [sitesError, setSitesError] = React.useState(false);
  const [firstName, setFirstName] = React.useState('');
  const [lastName, setLastName] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [projectId, setProjectId] = React.useState('');
  const [role, setRole] = React.useState<'technician' | 'casual'>('technician');
  const [idNumber, setIdNumber] = React.useState('');
  const [selfieBase64, setSelfieBase64] = React.useState<string | null>(null);
  const [selfiePreview, setSelfiePreview] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Load sites on mount; silent on failure — just leave select empty
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await getRegisterSites();
        if (cancelled) return;
        setSites(result.sites);
        const first = result.sites[0];
        if (first) setProjectId(first.id);
      } catch {
        if (!cancelled) setSitesError(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    const trimmedFirst = firstName.trim();
    const trimmedLast = lastName.trim();
    const trimmedPhone = phone.trim();
    if (!trimmedFirst || !trimmedLast) { setError('Enter your first and last name.'); return; }
    if (!trimmedPhone) { setError('Enter your phone number.'); return; }
    if (!projectId) { setError('Select a site.'); return; }
    setSubmitting(true);
    try {
      await registerFieldWorker({ firstName: trimmedFirst, lastName: trimmedLast, phone: trimmedPhone,
        projectId, role, idNumber: idNumber.trim() || undefined, selfieBase64: selfieBase64 ?? undefined });
      onSuccess(trimmedPhone);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NETWORK_ERROR') {
        setError('Could not reach the server. Check your connection.');
      } else if (err instanceof ApiError && err.status === 400) {
        setError(err.message);
      } else {
        setError('Could not start registration. Please try again in a moment.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    'mt-1 w-full px-4 py-3 rounded-xl border border-neutral-700 bg-neutral-900 text-neutral-100 placeholder:text-neutral-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 outline-none text-base';
  const labelClass = 'block text-sm font-medium text-neutral-300 mb-1';

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={labelClass}>First name</span>
          <input type="text" autoComplete="given-name" value={firstName}
            onChange={(e) => setFirstName(e.target.value)} placeholder="Sipho"
            className={inputClass} required />
        </label>
        <label className="block">
          <span className={labelClass}>Last name</span>
          <input type="text" autoComplete="family-name" value={lastName}
            onChange={(e) => setLastName(e.target.value)} placeholder="Dlamini"
            className={inputClass} required />
        </label>
      </div>
      <label className="block">
        <span className={labelClass}>Phone number (WhatsApp)</span>
        <input type="tel" inputMode="tel" autoComplete="tel" value={phone}
          onChange={(e) => setPhone(e.target.value)} placeholder="082 123 4567"
          className={inputClass} required />
      </label>
      <label className="block">
        <span className={labelClass}>Site</span>
        <SiteSelectField sites={sites} sitesError={sitesError} projectId={projectId}
          onChange={setProjectId} inputClass={inputClass} />
      </label>
      <label className="block">
        <span className={labelClass}>Worker type</span>
        <select value={role} onChange={(e) => setRole(e.target.value as 'technician' | 'casual')}
          className={`${inputClass} cursor-pointer`}>
          <option value="technician">Technician</option>
          <option value="casual">Casual</option>
        </select>
      </label>
      <label className="block">
        <span className={labelClass}>ID number (optional)</span>
        <input type="text" inputMode="numeric" autoComplete="off" value={idNumber}
          onChange={(e) => setIdNumber(e.target.value)} placeholder="8001015009087"
          className={inputClass} />
      </label>
      <SelfieCaptureField selfiePreview={selfiePreview}
        onCapture={(b64, preview) => { setSelfieBase64(b64); setSelfiePreview(preview); }}
        onError={(msg) => setError(msg)} labelClass={labelClass} />
      {error && (
        <div role="alert" className="rounded-lg bg-red-950/50 border border-red-800 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}
      <button type="submit" disabled={submitting || sitesError}
        className="w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-base shadow-lg shadow-blue-600/20">
        {submitting ? 'Registering…' : 'Continue'}
      </button>
    </form>
  );
}
