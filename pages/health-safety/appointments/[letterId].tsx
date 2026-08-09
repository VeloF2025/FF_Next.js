/**
 * H&S Appointment Letter detail — draw signature / view / delete
 * /health-safety/appointments/[letterId]
 */

import type { NextPage } from 'next';
import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import useSWR, { mutate } from 'swr';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { healthSafetyConfig } from '@/modules/navigation';
import { ChevronLeft, Trash2, CheckCircle2 } from 'lucide-react';
import { SignaturePad } from '@/modules/health-safety/components/appointments/SignaturePad';
import { letterTypeDef } from '@/modules/health-safety/types/appointment.types';

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then((r) => r.json());

function Detail({ id }: { id: string }) {
  const router = useRouter();
  const key = `/api/health-safety/appointments/${id}`;
  const { data, error, isLoading } = useSWR(key, fetcher);
  const letter = data?.data?.letter;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function sign(dataUrl: string) {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(key, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ signature_image: dataUrl, signature_name: letter?.appointee_name }) });
      const json = await res.json();
      if (!res.ok || json?.success === false) setMsg(json?.error?.message || json?.error || 'Failed to sign');
      else mutate(key);
    } catch { setMsg('Network error'); } finally { setBusy(false); }
  }

  async function remove() {
    if (!confirm('Delete this appointment letter?')) return;
    const res = await fetch(key, { method: 'DELETE' });
    if (res.ok) router.push('/health-safety/appointments');
  }

  if (isLoading) return <div className="h-40 bg-[var(--ff-bg-tertiary)] rounded-lg animate-pulse" />;
  if (error || !letter) return <div className="p-8 text-center bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg">Letter not found</div>;

  const def = letterTypeDef(letter.letter_type);

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/health-safety/appointments" className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors">
            <ChevronLeft className="w-5 h-5 text-[var(--ff-text-secondary)]" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-[var(--ff-text-primary)] font-mono">{letter.reference_number}</h1>
            <p className="text-sm text-[var(--ff-text-secondary)]">{def?.label} · {def?.statute}</p>
          </div>
        </div>
        {letter.status === 'signed' && <span className="flex items-center gap-1 text-green-600 dark:text-green-400 text-sm"><CheckCircle2 className="w-4 h-4" />Signed</span>}
      </div>

      {msg && <div className="p-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded text-sm">{msg}</div>}

      <dl className="grid grid-cols-2 gap-4 text-sm bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
        <div><dt className="text-[var(--ff-text-tertiary)]">Appointee</dt><dd className="text-[var(--ff-text-primary)]">{letter.appointee_name}{letter.appointee_designation ? ` — ${letter.appointee_designation}` : ''}</dd></div>
        <div><dt className="text-[var(--ff-text-tertiary)]">Appointed by</dt><dd className="text-[var(--ff-text-primary)]">{letter.appointer_name ?? '—'}</dd></div>
        <div><dt className="text-[var(--ff-text-tertiary)]">Project</dt><dd className="text-[var(--ff-text-primary)]">{letter.project_name ?? '—'}</dd></div>
        <div><dt className="text-[var(--ff-text-tertiary)]">Appointment date</dt><dd className="text-[var(--ff-text-primary)]">{letter.appointment_date ? letter.appointment_date.slice(0, 10) : '—'}</dd></div>
        <div className="col-span-2"><dt className="text-[var(--ff-text-tertiary)]">Scope</dt><dd className="text-[var(--ff-text-primary)] leading-relaxed">{letter.scope ?? '—'}</dd></div>
      </dl>

      <div>
        <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-3">Signature</h2>
        {letter.status === 'signed' && letter.signature_image ? (
          <div className="space-y-1">
            {/* Raw <img>, not next/image: signature_image is a PNG data URL (see the
                validSignatureImage guard in pages/api/health-safety/appointments/[letterId].ts),
                which the image optimiser cannot process. */}
            <img src={letter.signature_image} alt="signature" className="border border-[var(--ff-border-light)] rounded-lg bg-white max-h-[140px]" />
            <p className="text-xs text-[var(--ff-text-tertiary)]">Signed by {letter.signature_name} on {letter.signed_at?.slice(0, 10)} (IP {letter.signed_ip})</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-[var(--ff-text-secondary)] mb-2">Draw the appointee&apos;s signature to sign this letter. Once signed it is locked.</p>
            <SignaturePad onCapture={sign} busy={busy} />
          </>
        )}
      </div>

      <div className="flex justify-end pt-2">
        <button onClick={remove} className="flex items-center gap-2 px-4 py-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg">
          <Trash2 className="w-4 h-4" /> Delete
        </button>
      </div>
    </div>
  );
}

const LetterDetailPage: NextPage = () => {
  const router = useRouter();
  const { letterId } = router.query;
  return (
    <AppLayout>
      <Head><title>Appointment Letter | FibreFlow</title></Head>
      <ModulePage config={healthSafetyConfig}>{typeof letterId === 'string' ? <Detail id={letterId} /> : null}</ModulePage>
    </AppLayout>
  );
};

export const getServerSideProps = async () => ({ props: {} });

export default LetterDetailPage;
