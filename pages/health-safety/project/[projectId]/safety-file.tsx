/**
 * Project Digital Safety File
 * /health-safety/project/[projectId]/safety-file - Appointment letters + one-click PDF export
 */

import type { NextPage } from 'next';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { healthSafetyConfig } from '@/modules/navigation';
import { ChevronLeft, Download, FileSignature, CheckCircle2, Clock } from 'lucide-react';
import { letterTypeDef, type AppointmentLetter } from '@/modules/health-safety/types/appointment.types';

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then((r) => r.json());

function SafetyFileContent() {
  const router = useRouter();
  const { projectId } = router.query;
  const pid = typeof projectId === 'string' ? projectId : undefined;
  const { data, error, isLoading } = useSWR(pid ? `/api/health-safety/project/${pid}/safety-file?format=json` : null, fetcher);
  const letters: AppointmentLetter[] = Array.isArray(data?.data?.letters) ? data.data.letters : [];
  const summary = data?.data?.summary ?? { training: 0, toolbox: 0, ppe: 0, permits: 0, audits: 0 };

  const tiles = [
    { n: summary.training, l: 'Training' }, { n: summary.toolbox, l: 'Toolbox' },
    { n: summary.ppe, l: 'PPE' }, { n: summary.permits, l: 'Permits' }, { n: summary.audits, l: 'Audits' },
    { n: letters.length, l: 'Appointments' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <Link href="/health-safety" className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors">
            <ChevronLeft className="w-5 h-5 text-[var(--ff-text-secondary)]" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Digital Safety File</h1>
            <p className="text-sm text-[var(--ff-text-secondary)]">Appointment letters &amp; compliance summary</p>
          </div>
        </div>
        {pid && (
          <a href={`/api/health-safety/project/${pid}/safety-file`} className="flex items-center gap-2 px-4 py-2 bg-[var(--ff-primary-500)] hover:bg-[var(--ff-primary-600)] text-white rounded-lg transition-colors">
            <Download className="w-4 h-4" /> Export PDF
          </a>
        )}
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        {tiles.map((t) => (
          <div key={t.l} className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-3 text-center">
            <div className="text-xl font-bold text-[var(--ff-primary-500)]">{t.n}</div>
            <div className="text-xs text-[var(--ff-text-tertiary)] uppercase">{t.l}</div>
          </div>
        ))}
      </div>

      <div>
        <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-3">Appointment letters</h2>
        {isLoading ? (
          <div className="h-24 bg-[var(--ff-bg-tertiary)] rounded-lg animate-pulse" />
        ) : error ? (
          <div className="p-8 text-center bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg">Failed to load</div>
        ) : letters.length === 0 ? (
          <div className="text-center py-10 bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
            <FileSignature className="w-10 h-10 mx-auto mb-3 text-[var(--ff-text-tertiary)]" />
            <p className="text-[var(--ff-text-secondary)]">No appointment letters for this project yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {letters.map((l) => (
              <Link key={l.id} href={`/health-safety/appointments/${l.id}`} className="flex items-center justify-between bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-3 hover:border-[var(--ff-primary-500)] transition-colors">
                <div>
                  <div className="font-medium text-[var(--ff-text-primary)]">{letterTypeDef(l.letter_type)?.label ?? l.letter_type}</div>
                  <div className="text-xs text-[var(--ff-text-tertiary)] font-mono">{l.reference_number} · {l.appointee_name}</div>
                </div>
                {l.status === 'signed'
                  ? <span className="flex items-center gap-1 text-green-600 dark:text-green-400 text-sm"><CheckCircle2 className="w-4 h-4" />Signed</span>
                  : <span className="flex items-center gap-1 text-[var(--ff-text-tertiary)] text-sm"><Clock className="w-4 h-4" />Draft</span>}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const SafetyFilePage: NextPage = () => (
  <AppLayout>
    <Head><title>Digital Safety File | FibreFlow</title></Head>
    <ModulePage config={healthSafetyConfig}><SafetyFileContent /></ModulePage>
  </AppLayout>
);

export const getServerSideProps = async () => ({ props: {} });

export default SafetyFilePage;
