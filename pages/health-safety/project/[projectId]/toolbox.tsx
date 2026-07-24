/**
 * Project Toolbox Talk register
 * /health-safety/project/[projectId]/toolbox - Safety-file register for one project
 */

import type { NextPage } from 'next';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { projectsConfig } from '@/modules/navigation';
import { ChevronLeft, Megaphone, Users, CheckCircle2, Calendar } from 'lucide-react';
import { TOOLBOX_TALK_TYPES } from '@/modules/health-safety/types/toolbox.types';

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then((r) => r.json());

interface TalkRow {
  id: string; topic: string; talk_type: string; talk_date: string;
  presenter_name: string | null; attendee_count: number; signed_count: number;
}

function typeLabel(t: string) {
  return TOOLBOX_TALK_TYPES.find((x) => x.value === t)?.label ?? t;
}

function RegisterContent() {
  const router = useRouter();
  const { projectId } = router.query;
  const pid = typeof projectId === 'string' ? projectId : undefined;
  const { data, error, isLoading } = useSWR(
    pid ? `/api/health-safety/toolbox?project_id=${pid}` : null,
    fetcher
  );
  const talks: TalkRow[] = Array.isArray(data?.data?.talks) ? data.data.talks : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/projects/health-safety" className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors">
          <ChevronLeft className="w-5 h-5 text-[var(--ff-text-secondary)]" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Toolbox Talk Register</h1>
          <p className="text-sm text-[var(--ff-text-secondary)]">{talks.length} talk{talks.length !== 1 ? 's' : ''} for this project</p>
        </div>
      </div>

      {isLoading ? (
        <div className="h-32 bg-[var(--ff-bg-tertiary)] rounded-lg animate-pulse" />
      ) : error ? (
        <div className="p-8 text-center bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg">Failed to load register</div>
      ) : talks.length === 0 ? (
        <div className="text-center py-12 bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
          <Megaphone className="w-12 h-12 mx-auto mb-4 text-[var(--ff-text-tertiary)]" />
          <p className="text-[var(--ff-text-secondary)]">No toolbox talks recorded for this project</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--ff-border-light)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Date</th>
                <th className="text-left px-4 py-2 font-medium">Topic</th>
                <th className="text-left px-4 py-2 font-medium">Type</th>
                <th className="text-left px-4 py-2 font-medium">Presenter</th>
                <th className="text-left px-4 py-2 font-medium">Attended</th>
                <th className="text-left px-4 py-2 font-medium">Signed</th>
              </tr>
            </thead>
            <tbody>
              {talks.map((t) => (
                <tr key={t.id} className="border-t border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)]/40">
                  <td className="px-4 py-2 text-[var(--ff-text-secondary)]"><span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />{t.talk_date?.slice(0, 10)}</span></td>
                  <td className="px-4 py-2">
                    <Link href={`/health-safety/toolbox/${t.id}`} className="text-[var(--ff-primary-500)] hover:underline font-medium">{t.topic}</Link>
                  </td>
                  <td className="px-4 py-2 text-[var(--ff-text-secondary)]">{typeLabel(t.talk_type)}</td>
                  <td className="px-4 py-2 text-[var(--ff-text-secondary)]">{t.presenter_name ?? '—'}</td>
                  <td className="px-4 py-2 text-[var(--ff-text-secondary)]"><span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{t.attendee_count}</span></td>
                  <td className="px-4 py-2 text-[var(--ff-text-secondary)]"><span className="flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" />{t.signed_count}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const RegisterPage: NextPage = () => (
  <AppLayout>
    <Head><title>Toolbox Register | FibreFlow</title></Head>
    <ModulePage config={projectsConfig}><RegisterContent /></ModulePage>
  </AppLayout>
);

export const getServerSideProps = async () => ({ props: {} });

export default RegisterPage;
