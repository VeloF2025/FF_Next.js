/**
 * H&S Toolbox Talks
 * /health-safety/toolbox - Daily DSTI / weekly toolbox talk register
 */

import type { NextPage } from 'next';
import Head from 'next/head';
import Link from 'next/link';
import useSWR from 'swr';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { projectsConfig } from '@/modules/navigation';
import { Megaphone, Plus, ChevronLeft, Users, CheckCircle2, Calendar } from 'lucide-react';
import { TOOLBOX_TALK_TYPES } from '@/modules/health-safety/types/toolbox.types';

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then((r) => r.json());

interface TalkRow {
  id: string;
  topic: string;
  talk_type: string;
  talk_date: string;
  project_name: string | null;
  presenter_name: string | null;
  attendee_count: number;
  signed_count: number;
}

function typeLabel(t: string) {
  return TOOLBOX_TALK_TYPES.find((x) => x.value === t)?.label ?? t;
}

function ToolboxContent() {
  const { data, error, isLoading } = useSWR('/api/health-safety/toolbox', fetcher);
  const talks: TalkRow[] = Array.isArray(data?.data?.talks) ? data.data.talks : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <Link href="/projects/health-safety" className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors">
            <ChevronLeft className="w-5 h-5 text-[var(--ff-text-secondary)]" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Toolbox Talks</h1>
            <p className="text-sm text-[var(--ff-text-secondary)]">{talks.length} recorded</p>
          </div>
        </div>
        <Link href="/health-safety/toolbox/new" className="flex items-center gap-2 px-4 py-2 bg-[var(--ff-primary-500)] hover:bg-[var(--ff-primary-600)] text-white rounded-lg transition-colors">
          <Plus className="w-4 h-4" />
          Log Talk
        </Link>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-[var(--ff-bg-tertiary)] rounded-lg animate-pulse" />)}
        </div>
      ) : error ? (
        <div className="p-8 text-center bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg">Failed to load toolbox talks</div>
      ) : talks.length === 0 ? (
        <div className="text-center py-12 bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
          <Megaphone className="w-12 h-12 mx-auto mb-4 text-[var(--ff-text-tertiary)]" />
          <p className="text-[var(--ff-text-secondary)]">No toolbox talks recorded</p>
          <p className="text-sm text-[var(--ff-text-tertiary)] mt-1">Log a daily DSTI or weekly talk to start the register</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {talks.map((t) => (
            <Link key={t.id} href={`/health-safety/toolbox/${t.id}`} className="block bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4 hover:border-[var(--ff-primary-500)] transition-colors">
              <div className="flex items-start justify-between gap-2 mb-2">
                <h3 className="font-semibold text-[var(--ff-text-primary)] truncate">{t.topic}</h3>
                <span className="px-2 py-0.5 text-xs rounded bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] whitespace-nowrap">{typeLabel(t.talk_type)}</span>
              </div>
              {t.project_name && <p className="text-sm text-[var(--ff-text-secondary)] mb-2">{t.project_name}</p>}
              <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--ff-text-tertiary)]">
                <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />{t.talk_date?.slice(0, 10)}</span>
                <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{t.attendee_count}</span>
                <span className="flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" />{t.signed_count} signed</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

const ToolboxPage: NextPage = () => (
  <AppLayout>
    <Head>
      <title>Toolbox Talks | FibreFlow</title>
    </Head>
    <ModulePage config={projectsConfig}>
      <ToolboxContent />
    </ModulePage>
  </AppLayout>
);

export const getServerSideProps = async () => ({ props: {} });

export default ToolboxPage;
