/**
 * H&S Record Medical Fitness
 * /health-safety/medicals/new - Capture a worker Certificate of Fitness
 */

import type { NextPage } from 'next';
import React, { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { healthSafetyConfig } from '@/modules/navigation';
import { ChevronLeft, Save } from 'lucide-react';
import {
  MEDICAL_OUTCOMES,
  MEDICAL_VALIDITY_MONTHS,
  type MedicalOutcome,
} from '@/modules/health-safety/types/medical.types';
import { HSAttachmentPicker } from '@/modules/health-safety/components/attachments/HSAttachmentPicker';
import {
  MAX_ATTACHMENT_MB,
  uploadAttachment,
} from '@/modules/health-safety/components/attachments/attachmentClient';

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const inputCls =
  'w-full px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary-500)]';
const labelCls = 'block text-sm font-medium text-[var(--ff-text-secondary)] mb-1';

function RecordMedicalContent() {
  const router = useRouter();
  // Reuses the training form's picker endpoint — same three reference lists.
  const { data: pickers } = useSWR('/api/health-safety/training/pickers', fetcher);
  const contractors = pickers?.data?.contractors ?? [];
  const staff = pickers?.data?.staff ?? [];
  const teamMembers = pickers?.data?.team_members ?? [];

  const [workerKind, setWorkerKind] = useState<'team_member' | 'staff'>('team_member');
  const [outcome, setOutcome] = useState<MedicalOutcome>('fit');
  const [form, setForm] = useState({
    worker_id: '', contractor_id: '', exam_date: '', expiry_date: '', restrictions: '',
    practitioner: '', practice_number: '', certificate_number: '',
  });
  // Held rather than uploaded on selection: the attachment needs the medical
  // record's id for its foreign key, and that id does not exist until the POST
  // below succeeds.
  const [certificate, setCertificate] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!form.worker_id || !form.exam_date) {
      setErr('Worker and examination date are required');
      return;
    }
    // Mirrors the server rule: without a contractor, a contractor worker's
    // certificate never reaches any compliance gate.
    if (workerKind === 'team_member' && !form.contractor_id) {
      setErr('Select the contractor — it is what drives the compliance gate');
      return;
    }
    // Mirrors the DB CHECK (hs_worker_medicals_restrictions_stated) so the user
    // sees the problem in the form rather than as a server error.
    if (outcome === 'fit_with_restriction' && !form.restrictions.trim()) {
      setErr('State the restriction when the outcome is "Fit with Restriction"');
      return;
    }
    setSaving(true);
    const payload: Record<string, unknown> = {
      exam_date: form.exam_date,
      expiry_date: form.expiry_date || undefined,
      outcome,
      restrictions: form.restrictions || undefined,
      contractor_id: form.contractor_id || undefined,
      practitioner: form.practitioner || undefined,
      practice_number: form.practice_number || undefined,
      certificate_number: form.certificate_number || undefined,
    };
    if (workerKind === 'staff') payload.staff_id = form.worker_id;
    else payload.team_member_id = form.worker_id;

    try {
      const res = await fetch('/api/health-safety/medicals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || json?.success === false) {
        setErr(json?.error?.message || json?.error || 'Failed to save medical record');
        setSaving(false);
        return;
      }

      // The record is saved at this point. If the certificate upload fails the
      // record must not be rolled back — the medical outcome is the compliance
      // fact and is worth keeping — so the failure is reported against the
      // saved record and the user is left on the form to retry rather than
      // being redirected away from an error they cannot then act on.
      const medicalId = (json?.data ?? json)?.id as string | undefined;
      if (certificate && medicalId) {
        try {
          await uploadAttachment('medical', medicalId, certificate);
        } catch (uploadError) {
          setErr(
            `The medical record was saved, but the certificate did not upload: ${
              uploadError instanceof Error ? uploadError.message : 'unknown error'
            }. Attach it from the record.`
          );
          setSaving(false);
          return;
        }
      }

      router.push('/health-safety/medicals');
    } catch {
      setErr('Network error saving medical record');
      setSaving(false);
    }
  }

  const workers = workerKind === 'staff' ? staff : teamMembers;

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/health-safety/medicals" className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors">
          <ChevronLeft className="w-5 h-5 text-[var(--ff-text-secondary)]" />
        </Link>
        <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Record Medical Fitness</h1>
      </div>

      {err && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-sm">{err}</div>
      )}

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className={labelCls}>Worker type</label>
          <div className="flex gap-2">
            {(['team_member', 'staff'] as const).map((k) => (
              <button
                type="button"
                key={k}
                onClick={() => { setWorkerKind(k); set('worker_id', ''); }}
                className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
                  workerKind === k
                    ? 'bg-[var(--ff-primary-500)] text-white border-[var(--ff-primary-500)]'
                    : 'bg-[var(--ff-bg-secondary)] text-[var(--ff-text-secondary)] border-[var(--ff-border-light)]'
                }`}
              >
                {k === 'team_member' ? 'Contractor worker' : 'Internal staff'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className={labelCls}>Worker *</label>
          <select className={inputCls} value={form.worker_id} onChange={(e) => set('worker_id', e.target.value)}>
            <option value="">Select worker…</option>
            {workers.map((w: { id: string; name: string }) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>

        {workerKind === 'team_member' && (
          <div>
            <label className={labelCls}>Contractor * (drives the compliance gate)</label>
            <select className={inputCls} value={form.contractor_id} onChange={(e) => set('contractor_id', e.target.value)}>
              <option value="">Select contractor…</option>
              {contractors.map((c: { id: string; company_name: string }) => (
                <option key={c.id} value={c.id}>{c.company_name}</option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className={labelCls}>Outcome *</label>
          <select className={inputCls} value={outcome} onChange={(e) => setOutcome(e.target.value as MedicalOutcome)}>
            {Object.values(MEDICAL_OUTCOMES).map((o) => (
              <option key={o.value} value={o.value}>{o.label}{o.blocks_gate ? ' (blocks the gate)' : ''}</option>
            ))}
          </select>
        </div>

        {outcome === 'fit_with_restriction' && (
          <div>
            <label className={labelCls}>Restrictions *</label>
            <textarea className={inputCls} rows={2} placeholder="e.g. no work at heights above 3 m" value={form.restrictions} onChange={(e) => set('restrictions', e.target.value)} />
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Examination date *</label>
            <input type="date" className={inputCls} value={form.exam_date} onChange={(e) => set('exam_date', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Expiry (defaults to {MEDICAL_VALIDITY_MONTHS} months)</label>
            <input type="date" className={inputCls} value={form.expiry_date} onChange={(e) => set('expiry_date', e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Practitioner</label>
            <input type="text" className={inputCls} value={form.practitioner} onChange={(e) => set('practitioner', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Practice number</label>
            <input type="text" className={inputCls} value={form.practice_number} onChange={(e) => set('practice_number', e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Certificate number</label>
            <input type="text" className={inputCls} value={form.certificate_number} onChange={(e) => set('certificate_number', e.target.value)} />
          </div>
          <HSAttachmentPicker
            label="Certificate"
            file={certificate}
            onFileChange={setCertificate}
            disabled={saving}
            hint={`Uploaded after the record is saved. PDF, JPG, PNG, DOC or DOCX, up to ${MAX_ATTACHMENT_MB} MB.`}
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Link href="/health-safety/medicals" className="px-4 py-2 text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-tertiary)] rounded-lg">Cancel</Link>
          <button type="submit" disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-[var(--ff-primary-500)] hover:bg-[var(--ff-primary-600)] disabled:opacity-60 text-white rounded-lg transition-colors">
            <Save className="w-4 h-4" />
            {saving ? 'Saving…' : 'Save record'}
          </button>
        </div>
      </form>
    </div>
  );
}

const RecordMedicalPage: NextPage = () => (
  <AppLayout>
    <Head>
      <title>Record Medical Fitness | FibreFlow</title>
    </Head>
    <ModulePage config={healthSafetyConfig}>
      <RecordMedicalContent />
    </ModulePage>
  </AppLayout>
);

export const getServerSideProps = async () => ({ props: {} });

export default RecordMedicalPage;
