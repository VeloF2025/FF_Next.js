/**
 * H&S Appointment Letters
 * /health-safety/appointments
 */

import type { NextPage } from 'next';
import Head from 'next/head';
import Link from 'next/link';
import useSWR from 'swr';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { healthSafetyConfig } from '@/modules/navigation';
import { FileSignature, Plus, ChevronLeft, CheckCircle2, Clock } from 'lucide-react';
import { letterTypeDef } from '@/modules/health-safety/types/appointment.types';

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then((r) => r.json());

interface LetterRow {
  id: string; letter_type: string; reference_number: string; appointee_name: string;
  project_name: string | null; status: string; has_signature: boolean; appointment_date: string | null;
}

function AppointmentsContent() {
  const { data, error, isLoading } = useSWR('/api/health-safety/appointments', fetcher);
  const letters: LetterRow[] = Array.isArray(data?.data?.letters) ? data.data.letters : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <Link href="/health-safety" className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors">
            <ChevronLeft className="w-5 h-5 text-[var(--ff-text-secondary)]" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Appointment Letters</h1>
            <p className="text-sm text-[var(--ff-text-secondary)]">{letters.length} letter{letters.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
        <Link href="/health-safety/appointments/new" className="flex items-center gap-2 px-4 py-2 bg-[var(--ff-primary-500)] hover:bg-[var(--ff-primary-600)] text-white rounded-lg transition-colors">
          <Plus className="w-4 h-4" /> New Letter
        </Link>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-14 bg-[var(--ff-bg-tertiary)] rounded-lg animate-pulse" />)}</div>
      ) : error ? (
        <div className="p-8 text-center bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg">Failed to load appointment letters</div>
      ) : letters.length === 0 ? (
        <div className="text-center py-12 bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
          <FileSignature className="w-12 h-12 mx-auto mb-4 text-[var(--ff-text-tertiary)]" />
          <p className="text-[var(--ff-text-secondary)]">No appointment letters</p>
          <p className="text-sm text-[var(--ff-text-tertiary)] mt-1">Draft an s16(2), s8(1), construction-supervisor or Annexure 3 letter</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--ff-border-light)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Reference</th>
                <th className="text-left px-4 py-2 font-medium">Type</th>
                <th className="text-left px-4 py-2 font-medium">Appointee</th>
                <th className="text-left px-4 py-2 font-medium">Project</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {letters.map((l) => (
                <tr key={l.id} className="border-t border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)]/40">
                  <td className="px-4 py-2">
                    <Link href={`/health-safety/appointments/${l.id}`} className="text-[var(--ff-primary-500)] hover:underline font-medium font-mono">{l.reference_number}</Link>
                  </td>
                  <td className="px-4 py-2 text-[var(--ff-text-primary)]">{letterTypeDef(l.letter_type)?.label ?? l.letter_type}</td>
                  <td className="px-4 py-2 text-[var(--ff-text-primary)]">{l.appointee_name}</td>
                  <td className="px-4 py-2 text-[var(--ff-text-secondary)]">{l.project_name ?? '—'}</td>
                  <td className="px-4 py-2">
                    {l.status === 'signed'
                      ? <span className="flex items-center gap-1 text-green-600 dark:text-green-400"><CheckCircle2 className="w-4 h-4" />Signed</span>
                      : <span className="flex items-center gap-1 text-[var(--ff-text-tertiary)]"><Clock className="w-4 h-4" />Draft</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const AppointmentsPage: NextPage = () => (
  <AppLayout>
    <Head><title>Appointment Letters | FibreFlow</title></Head>
    <ModulePage config={healthSafetyConfig}><AppointmentsContent /></ModulePage>
  </AppLayout>
);

export const getServerSideProps = async () => ({ props: {} });

export default AppointmentsPage;
