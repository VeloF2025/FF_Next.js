/**
 * H&S Audit Detail Page
 * /health-safety/audits/[auditId] - View audit details
 */

import type { NextPage } from 'next';
import type { GetServerSideProps } from 'next';
import React from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { projectsConfig } from '@/modules/navigation';
import {
  ChevronLeft,
  Calendar,
  User,
  MapPin,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function AuditDetailContent() {
  const router = useRouter();
  const { auditId } = router.query;

  const { data, error, isLoading } = useSWR(
    auditId ? `/api/health-safety/audits/${auditId}` : null,
    fetcher
  );
  const audit = data?.data;

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-3xl">
        <div className="h-8 w-48 bg-[var(--ff-bg-tertiary)] rounded animate-pulse" />
        <div className="h-64 bg-[var(--ff-bg-tertiary)] rounded-lg animate-pulse" />
      </div>
    );
  }

  if (error || !audit) {
    return (
      <div className="space-y-6 max-w-3xl">
        <div className="flex items-center gap-4">
          <Link
            href="/projects/health-safety"
            className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-[var(--ff-text-secondary)]" />
          </Link>
          <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Audit Details</h1>
        </div>
        <div className="p-8 text-center bg-red-50 dark:bg-red-900/20 rounded-lg">
          <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-red-500" />
          <p className="text-red-600 dark:text-red-400 font-medium">
            {error ? 'Failed to load audit' : 'Audit not found'}
          </p>
          <p className="text-sm text-red-500 dark:text-red-300 mt-1">
            {error ? 'Please try refreshing the page' : `No audit found with ID: ${auditId}`}
          </p>
        </div>
      </div>
    );
  }

  const statusColors: Record<string, string> = {
    completed: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    scheduled: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    overdue: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  };

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          href="/projects/health-safety"
          className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors"
        >
          <ChevronLeft className="w-5 h-5 text-[var(--ff-text-secondary)]" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">
            {audit.title || 'Audit Details'}
          </h1>
          <p className="text-sm text-[var(--ff-text-secondary)]">
            Audit #{auditId}
          </p>
        </div>
        {audit.status && (
          <span
            className={`px-3 py-1 text-sm font-medium rounded-full ${statusColors[audit.status] || statusColors.scheduled}`}
          >
            {audit.status.replace(/_/g, ' ').toUpperCase()}
          </span>
        )}
      </div>

      {/* Details Card */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6 space-y-4">
        {audit.description && (
          <div>
            <h3 className="text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Description</h3>
            <p className="text-[var(--ff-text-primary)]">{audit.description}</p>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {audit.scheduled_date && (
            <div className="flex items-center gap-2 text-sm">
              <Calendar className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
              <span className="text-[var(--ff-text-secondary)]">Scheduled:</span>
              <span className="text-[var(--ff-text-primary)]">
                {new Date(audit.scheduled_date).toLocaleDateString()}
              </span>
            </div>
          )}
          {audit.completed_date && (
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <span className="text-[var(--ff-text-secondary)]">Completed:</span>
              <span className="text-[var(--ff-text-primary)]">
                {new Date(audit.completed_date).toLocaleDateString()}
              </span>
            </div>
          )}
          {audit.auditor && (
            <div className="flex items-center gap-2 text-sm">
              <User className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
              <span className="text-[var(--ff-text-secondary)]">Auditor:</span>
              <span className="text-[var(--ff-text-primary)]">{audit.auditor}</span>
            </div>
          )}
          {audit.location && (
            <div className="flex items-center gap-2 text-sm">
              <MapPin className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
              <span className="text-[var(--ff-text-secondary)]">Location:</span>
              <span className="text-[var(--ff-text-primary)]">{audit.location}</span>
            </div>
          )}
        </div>

        {audit.score != null && (
          <div className="pt-4 border-t border-[var(--ff-border-light)]">
            <h3 className="text-sm font-medium text-[var(--ff-text-secondary)] mb-2">Score</h3>
            <div className="flex items-center gap-3">
              <div className="text-3xl font-bold text-[var(--ff-text-primary)]">
                {audit.score}%
              </div>
              <div className="flex-1 h-3 bg-[var(--ff-bg-tertiary)] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    audit.score >= 80
                      ? 'bg-green-500'
                      : audit.score >= 60
                        ? 'bg-yellow-500'
                        : 'bg-red-500'
                  }`}
                  style={{ width: `${Math.min(100, audit.score)}%` }}
                />
              </div>
            </div>
          </div>
        )}

        {audit.findings && (
          <div className="pt-4 border-t border-[var(--ff-border-light)]">
            <h3 className="text-sm font-medium text-[var(--ff-text-secondary)] mb-2">Findings</h3>
            <p className="text-[var(--ff-text-primary)] whitespace-pre-wrap">{audit.findings}</p>
          </div>
        )}
      </div>
    </div>
  );
}

const AuditDetailPage: NextPage = () => {
  return (
    <AppLayout>
      <Head>
        <title>Audit Detail | H&S | FibreFlow</title>
      </Head>
      <ModulePage config={projectsConfig}>
        <AuditDetailContent />
      </ModulePage>
    </AppLayout>
  );
};

export const getServerSideProps: GetServerSideProps = async () => {
  return { props: {} };
};

export default AuditDetailPage;
