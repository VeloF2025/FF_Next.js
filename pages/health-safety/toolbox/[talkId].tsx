/**
 * H&S Toolbox Talk detail + attendance register
 * /health-safety/toolbox/[talkId]
 */

import type { NextPage } from 'next';
import React, { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import useSWR, { mutate } from 'swr';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { healthSafetyConfig } from '@/modules/navigation';
import { ChevronLeft, UserPlus, CheckCircle2, Clock, Trash2 } from 'lucide-react';
import { HSAttachmentUpload } from '@/modules/health-safety/components/attachments/HSAttachmentUpload';

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then((r) => r.json());
const inputCls =
  'px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary-500)]';

interface Attendee {
  id: string; worker_name: string; signature_name: string | null; signed_at: string | null;
}

function TalkContent({ talkId }: { talkId: string }) {
  const key = `/api/health-safety/toolbox/${talkId}`;
  const { data, error, isLoading } = useSWR(key, fetcher);
  const talk = data?.data?.talk;
  const attendance: Attendee[] = Array.isArray(data?.data?.attendance) ? data.data.attendance : [];

  const [name, setName] = useState('');
  const [sig, setSig] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function addAttendee(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`${key}/attendance`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worker_name: name.trim(), signature_name: sig.trim() || undefined }),
      });
      if (res.ok) { setName(''); setSig(''); mutate(key); }
      else setMsg('Failed to add attendee');
    } catch { setMsg('Network error'); } finally { setBusy(false); }
  }

  async function removeAttendee(id: string) {
    await fetch(`${key}/attendance?attendanceId=${id}`, { method: 'DELETE' });
    mutate(key);
  }

  if (isLoading) return <div className="h-40 bg-[var(--ff-bg-tertiary)] rounded-lg animate-pulse" />;
  if (error || !talk) return <div className="p-8 text-center bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg">Talk not found</div>;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/health-safety/toolbox" className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors">
          <ChevronLeft className="w-5 h-5 text-[var(--ff-text-secondary)]" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">{talk.topic}</h1>
          <p className="text-sm text-[var(--ff-text-secondary)]">
            {talk.project_name ? `${talk.project_name} · ` : ''}{talk.talk_date?.slice(0, 10)}
            {talk.presenter_name ? ` · ${talk.presenter_name}` : ''}
          </p>
        </div>
      </div>

      {talk.notes && (
        <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4 text-sm text-[var(--ff-text-secondary)]">{talk.notes}</div>
      )}

      <div>
        <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-3">Attendance register ({attendance.length})</h2>
        {msg && <div className="mb-3 p-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded text-sm">{msg}</div>}

        <form onSubmit={addAttendee} className="flex flex-wrap gap-2 mb-4">
          <input className={`${inputCls} flex-1 min-w-[160px]`} placeholder="Attendee name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className={`${inputCls} flex-1 min-w-[160px]`} placeholder="Type name to sign (optional)" value={sig} onChange={(e) => setSig(e.target.value)} />
          <button type="submit" disabled={busy} className="flex items-center gap-2 px-4 py-2 bg-[var(--ff-primary-500)] hover:bg-[var(--ff-primary-600)] disabled:opacity-60 text-white rounded-lg">
            <UserPlus className="w-4 h-4" /> Add
          </button>
        </form>

        {attendance.length === 0 ? (
          <p className="text-sm text-[var(--ff-text-tertiary)]">No attendees recorded yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--ff-border-light)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Worker</th>
                  <th className="text-left px-4 py-2 font-medium">Signature</th>
                  <th className="text-left px-4 py-2 font-medium">Signed</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {attendance.map((a) => (
                  <tr key={a.id} className="border-t border-[var(--ff-border-light)]">
                    <td className="px-4 py-2 text-[var(--ff-text-primary)]">{a.worker_name}</td>
                    <td className="px-4 py-2">
                      {a.signature_name ? (
                        <span className="flex items-center gap-1 text-green-600 dark:text-green-400"><CheckCircle2 className="w-4 h-4" />{a.signature_name}</span>
                      ) : (
                        <span className="flex items-center gap-1 text-[var(--ff-text-tertiary)]"><Clock className="w-4 h-4" />Unsigned</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-[var(--ff-text-secondary)]">{a.signed_at ? a.signed_at.slice(0, 10) : '—'}</td>
                    <td className="px-4 py-2 text-right">
                      <button onClick={() => removeAttendee(a.id)} className="text-red-500 hover:text-red-600 p-1"><Trash2 className="w-4 h-4" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <HSAttachmentUpload surface="talk" parentId={talkId} label="Photos and attendance register" />
    </div>
  );
}

const TalkPage: NextPage = () => {
  const router = useRouter();
  const { talkId } = router.query;
  return (
    <AppLayout>
      <Head><title>Toolbox Talk | FibreFlow</title></Head>
      <ModulePage config={healthSafetyConfig}>
        {typeof talkId === 'string' ? <TalkContent talkId={talkId} /> : null}
      </ModulePage>
    </AppLayout>
  );
};

export const getServerSideProps = async () => ({ props: {} });

export default TalkPage;
