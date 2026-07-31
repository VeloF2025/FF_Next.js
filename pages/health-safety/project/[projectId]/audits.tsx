/**
 * Project H&S Audits List Page
 * /health-safety/project/[projectId]/audits - All audits for a project
 */

import type { NextPage, GetServerSideProps } from 'next';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { healthSafetyConfig } from '@/modules/navigation';
import { AlertTriangle, ChevronLeft, ClipboardList, User, Calendar } from 'lucide-react';
import { AUDIT_STATUS_CONFIG } from '@/modules/health-safety/types/audit.types';
import type { AuditType, AuditStatus, RAGStatus } from '@/modules/health-safety/types/audit.types';

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then((r) => r.json());

interface AuditRow {
  id: string;
  audit_type: AuditType;
  audit_date: string;
  status: AuditStatus;
  overall_score: number | null;
  rag_status: RAGStatus | null;
  auditor_name: string | null;
  project_name: string | null;
  response_summary?: { total: number; passed: number; failed: number; na: number };
}

const ragColors: Record<string, string> = {
  green: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  red: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

function ProjectAuditsContent() {
  const router = useRouter();
  const { projectId } = router.query;
  const pid = typeof projectId === 'string' ? projectId : undefined;

  const { data, error, isLoading } = useSWR(
    pid ? `/api/health-safety/project/${pid}/audits?limit=50` : null,
    fetcher
  );

  const audits = (data?.data?.audits || []) as AuditRow[];
  const total = data?.data?.total ?? audits.length;
  const projectName = audits[0]?.project_name;

  if (isLoading || !pid) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-20 bg-[var(--ff-bg-tertiary)] rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (error || data?.success === false) {
    return (
      <div className="space-y-4">
        <BackLink projectId={pid} />
        <div className="p-8 text-center bg-red-50 dark:bg-red-900/20 rounded-lg">
          <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-red-500" />
          <p className="text-red-600 dark:text-red-400 font-medium">Failed to load audits</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackLink projectId={pid} iconOnly />
        <div>
          <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">
            {projectName ? `${projectName} — H&S Audits` : 'H&S Audits'}
          </h1>
          <p className="text-sm text-[var(--ff-text-secondary)]">
            {total} audit{total !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {audits.length === 0 ? (
        <div className="text-center py-12 bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
          <ClipboardList className="w-12 h-12 mx-auto mb-4 text-[var(--ff-text-tertiary)]" />
          <p className="text-[var(--ff-text-secondary)]">No audits yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {audits.map((audit) => (
            <AuditListRow key={audit.id} audit={audit} />
          ))}
        </div>
      )}
    </div>
  );
}

function BackLink({ projectId, iconOnly }: { projectId?: string; iconOnly?: boolean }) {
  const href = projectId ? `/projects/${projectId}?tab=health-safety` : '/projects';
  if (iconOnly) {
    return (
      <Link href={href} className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors">
        <ChevronLeft className="w-5 h-5 text-[var(--ff-text-secondary)]" />
      </Link>
    );
  }
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] transition-colors"
    >
      <ChevronLeft className="w-4 h-4" />
      Back to Project
    </Link>
  );
}

function AuditListRow({ audit }: { audit: AuditRow }) {
  const statusConfig = AUDIT_STATUS_CONFIG[audit.status] || AUDIT_STATUS_CONFIG.in_progress;
  const summary = audit.response_summary;

  return (
    <Link
      href={`/health-safety/audits/${audit.id}`}
      className="flex items-center justify-between gap-4 p-4 bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] hover:border-[var(--ff-primary-500)] transition-colors"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3 mb-1">
          <span className="font-medium text-[var(--ff-text-primary)] capitalize">
            {audit.audit_type.replace(/_/g, ' ')} Audit
          </span>
          <span
            className="px-2 py-0.5 text-xs font-medium rounded-full"
            style={{ backgroundColor: statusConfig.color + '20', color: statusConfig.color }}
          >
            {statusConfig.label}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--ff-text-tertiary)]">
          <span className="flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5" />
            {new Date(audit.audit_date).toLocaleDateString()}
          </span>
          {audit.auditor_name && (
            <span className="flex items-center gap-1">
              <User className="w-3.5 h-3.5" />
              {audit.auditor_name}
            </span>
          )}
          {summary && (
            <span>
              {summary.passed} passed · {summary.failed} failed
              {summary.na ? ` · ${summary.na} n/a` : ''}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3">
        {audit.overall_score !== null && (
          <span className="text-lg font-semibold text-[var(--ff-text-primary)]">{audit.overall_score}%</span>
        )}
        <span
          className={`px-2 py-1 text-xs font-medium rounded-full ${
            audit.rag_status ? ragColors[audit.rag_status] : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)]'
          }`}
        >
          {audit.rag_status ? audit.rag_status.toUpperCase() : 'N/A'}
        </span>
      </div>
    </Link>
  );
}

const ProjectAuditsPage: NextPage = () => (
  <AppLayout>
    <Head>
      <title>H&S Audits | FibreFlow</title>
    </Head>
    <ModulePage config={healthSafetyConfig}>
      <ProjectAuditsContent />
    </ModulePage>
  </AppLayout>
);

export const getServerSideProps: GetServerSideProps = async () => ({ props: {} });

export default ProjectAuditsPage;
