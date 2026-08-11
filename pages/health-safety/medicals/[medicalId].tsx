/**
 * H&S Medical Fitness record detail / edit
 * /health-safety/medicals/[medicalId]
 */

import type { NextPage } from 'next';
import React, { useState, useEffect, useRef } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { healthSafetyConfig } from '@/modules/navigation';
import { ChevronLeft, Save, Trash2 } from 'lucide-react';
import { CompetencyBadge } from '@/modules/health-safety/components/training/CompetencyBadge';
import { MedicalOutcomeBadge } from '@/modules/health-safety/components/medical/MedicalOutcomeBadge';
import { HSAttachmentUpload } from '@/modules/health-safety/components/attachments/HSAttachmentUpload';
import {
  MEDICAL_OUTCOMES,
  type MedicalOutcome,
  type MedicalStatus,
} from '@/modules/health-safety/types/medical.types';

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const inputCls =
  'w-full px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary-500)]';
const labelCls = 'block text-sm font-medium text-[var(--ff-text-secondary)] mb-1';

interface MedicalDetail {
  id: string;
  worker_name: string;
  outcome: MedicalOutcome;
  restrictions: string | null;
  exam_date: string;
  expiry_date: string | null;
  practitioner: string | null;
  practice_number: string | null;
  certificate_number: string | null;
  medical_status: MedicalStatus;
}

function MedicalContent({ medicalId }: { medicalId: string }) {
  const router = useRouter();
  const { data, mutate } = useSWR(`/api/health-safety/medicals/${medicalId}`, fetcher);
  const record: MedicalDetail | undefined = data?.data;

  const [form, setForm] = useState({
    exam_date: '', expiry_date: '', outcome: 'fit' as MedicalOutcome, restrictions: '',
    practitioner: '', practice_number: '', certificate_number: '',
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Seed the edit form once, when the record first arrives. SWR hands back a
  // fresh object on every revalidation — re-seeding would discard live edits.
  const seeded = useRef(false);

  useEffect(() => {
    if (record && !seeded.current) {
      seeded.current = true;
      setForm({
        exam_date: record.exam_date?.slice(0, 10) ?? '',
        expiry_date: record.expiry_date?.slice(0, 10) ?? '',
        outcome: record.outcome,
        restrictions: record.restrictions ?? '',
        practitioner: record.practitioner ?? '',
        practice_number: record.practice_number ?? '',
        certificate_number: record.certificate_number ?? '',
      });
    }
  }, [record]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (form.outcome === 'fit_with_restriction' && !form.restrictions.trim()) {
      setMsg('State the restriction when the outcome is "Fit with Restriction"');
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/health-safety/medicals/${medicalId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exam_date: form.exam_date || undefined,
          expiry_date: form.expiry_date || null,
          outcome: form.outcome,
          restrictions: form.restrictions || null,
          practitioner: form.practitioner || null,
          practice_number: form.practice_number || null,
          certificate_number: form.certificate_number || null,
        }),
      });
      const json = await res.json();
      setMsg(res.ok ? 'Saved' : json?.error?.message || 'Failed to save');
      // Revalidate through SWR, not router.replace(asPath) — a same-route
      // replace re-renders from the SWR cache, so the outcome/status badges
      // would keep showing the pre-save values until a hard reload.
      if (res.ok) await mutate();
    } catch {
      setMsg('Network error saving record');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm('Delete this medical record?')) return;
    try {
      const res = await fetch(`/api/health-safety/medicals/${medicalId}`, { method: 'DELETE' });
      if (res.ok) router.push('/health-safety/medicals');
      else setMsg('Failed to delete');
    } catch {
      setMsg('Network error deleting record');
    }
  }

  if (!record) {
    return <div className="text-[var(--ff-text-secondary)]">Loading record…</div>;
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/health-safety/medicals" className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors">
            <ChevronLeft className="w-5 h-5 text-[var(--ff-text-secondary)]" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">{record.worker_name}</h1>
            <p className="text-sm text-[var(--ff-text-secondary)]">Certificate of Fitness</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <MedicalOutcomeBadge outcome={record.outcome} />
          <CompetencyBadge status={record.medical_status} />
        </div>
      </div>

      {msg && <div className="p-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] rounded text-sm">{msg}</div>}

      <form onSubmit={save} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Examination date</label>
            <input type="date" className={inputCls} value={form.exam_date} onChange={(e) => setForm({ ...form, exam_date: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>Expiry date</label>
            <input type="date" className={inputCls} value={form.expiry_date} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} />
          </div>
        </div>

        <div>
          <label className={labelCls}>Outcome</label>
          <select className={inputCls} value={form.outcome} onChange={(e) => setForm({ ...form, outcome: e.target.value as MedicalOutcome })}>
            {Object.values(MEDICAL_OUTCOMES).map((o) => (
              <option key={o.value} value={o.value}>{o.label}{o.blocks_gate ? ' (blocks the gate)' : ''}</option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelCls}>Restrictions{form.outcome === 'fit_with_restriction' ? ' *' : ''}</label>
          <textarea className={inputCls} rows={2} value={form.restrictions} onChange={(e) => setForm({ ...form, restrictions: e.target.value })} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Practitioner</label>
            <input type="text" className={inputCls} value={form.practitioner} onChange={(e) => setForm({ ...form, practitioner: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>Practice number</label>
            <input type="text" className={inputCls} value={form.practice_number} onChange={(e) => setForm({ ...form, practice_number: e.target.value })} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Certificate number</label>
            <input type="text" className={inputCls} value={form.certificate_number} onChange={(e) => setForm({ ...form, certificate_number: e.target.value })} />
          </div>
        </div>

        <HSAttachmentUpload surface="medical" parentId={medicalId} label="Certificate" />

        <div className="flex justify-between pt-2">
          <button type="button" onClick={remove} className="flex items-center gap-2 px-4 py-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg">
            <Trash2 className="w-4 h-4" /> Delete
          </button>
          <button type="submit" disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-[var(--ff-primary-500)] hover:bg-[var(--ff-primary-600)] disabled:opacity-60 text-white rounded-lg">
            <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}

const MedicalPage: NextPage = () => {
  const router = useRouter();
  const { medicalId } = router.query;
  return (
    <AppLayout>
      <Head>
        <title>Medical Record | FibreFlow</title>
      </Head>
      <ModulePage config={healthSafetyConfig}>
        {typeof medicalId === 'string' ? <MedicalContent medicalId={medicalId} /> : null}
      </ModulePage>
    </AppLayout>
  );
};

export const getServerSideProps = async () => ({ props: {} });

export default MedicalPage;
