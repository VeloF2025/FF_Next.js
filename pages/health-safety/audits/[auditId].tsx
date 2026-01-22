/**
 * H&S Audit Detail Page
 *
 * Shows audit wizard for conducting audits or displays completed audit results.
 */

import React, { useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import {
  Shield,
  ArrowLeft,
  CheckCircle,
  AlertTriangle,
  FileText,
  Printer,
  Download,
  Clock,
} from 'lucide-react';
import { AppLayout } from '@/components/layout';
import { AuditWizard } from '@/modules/health-safety/components';
import type { RAGStatus } from '@/modules/health-safety/types/audit.types';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function AuditDetailPage() {
  const router = useRouter();
  const { auditId } = router.query;
  const [showResults, setShowResults] = useState(false);

  const { data, error, mutate } = useSWR(
    auditId ? `/api/health-safety/audits/${auditId}` : null,
    fetcher
  );

  const audit = data?.data?.audit;
  const responses = data?.data?.responses || [];
  const summary = data?.data?.summary;
  const byCategory = data?.data?.by_category || {};

  const isCompleted = audit?.status === 'completed' || audit?.status === 'requires_action';

  const handleComplete = (score: number, ragStatus: RAGStatus) => {
    mutate();
    setShowResults(true);
  };

  const handleCancel = () => {
    router.back();
  };

  if (error) {
    return (
      <div className="p-8 text-center">
        <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-red-500" />
        <p className="text-red-600">Failed to load audit</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-8 text-center">
        <div className="animate-spin w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full mx-auto" />
        <p className="text-gray-500 mt-4">Loading audit...</p>
      </div>
    );
  }

  // Show results if completed or user just completed
  if (isCompleted || showResults) {
    return (
      <>
        <Head>
          <title>Audit Results | FibreFlow</title>
        </Head>

        <div className="p-6 max-w-4xl mx-auto">
          {/* Header */}
          <div className="flex items-center gap-4 mb-6">
            <button
              onClick={() => router.back()}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
            >
              <ArrowLeft className="w-5 h-5 text-gray-500" />
            </button>
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                Audit Results
              </h1>
              <p className="text-gray-500 dark:text-gray-400">
                {audit?.project_name} • {new Date(audit?.audit_date).toLocaleDateString()}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => window.print()}
                className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg"
              >
                <Printer className="w-4 h-4" />
                Print
              </button>
              <button className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg">
                <Download className="w-4 h-4" />
                Export PDF
              </button>
            </div>
          </div>

          {/* Score Card */}
          <ScoreResultCard
            score={audit?.overall_score}
            ragStatus={audit?.rag_status}
            status={audit?.status}
            summary={summary}
          />

          {/* Category Breakdown */}
          <div className="mt-6 space-y-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Category Breakdown
            </h2>

            {Object.entries(byCategory).map(([category, data]: [string, any]) => (
              <CategoryResultCard key={category} category={category} data={data} />
            ))}
          </div>

          {/* Actions */}
          {audit?.status === 'requires_action' && (
            <div className="mt-6 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-6 h-6 text-amber-500" />
                <div>
                  <h3 className="font-medium text-amber-800 dark:text-amber-200">
                    Corrective Actions Required
                  </h3>
                  <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                    {summary?.corrective_actions_needed || 0} items require corrective action.
                  </p>
                  <a
                    href={`/health-safety/audits/${auditId}/actions`}
                    className="inline-flex items-center gap-2 mt-3 text-sm font-medium text-amber-600 hover:text-amber-700"
                  >
                    Manage Corrective Actions
                  </a>
                </div>
              </div>
            </div>
          )}
        </div>
      </>
    );
  }

  // Show audit wizard
  return (
    <>
      <Head>
        <title>Conduct Audit | FibreFlow</title>
      </Head>

      <div className="h-screen flex flex-col">
        <AuditWizard
          auditId={auditId as string}
          onComplete={handleComplete}
          onCancel={handleCancel}
        />
      </div>
    </>
  );
}

// Sub-components

function ScoreResultCard({
  score,
  ragStatus,
  status,
  summary,
}: {
  score?: number;
  ragStatus?: string;
  status?: string;
  summary?: any;
}) {
  const ragColors = {
    green: 'from-green-500 to-green-600',
    amber: 'from-amber-500 to-amber-600',
    red: 'from-red-500 to-red-600',
  };

  const ragLabels = {
    green: 'Compliant',
    amber: 'Needs Improvement',
    red: 'Non-Compliant',
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      {/* Score banner */}
      <div
        className={`bg-gradient-to-r ${ragColors[ragStatus as keyof typeof ragColors] || 'from-gray-500 to-gray-600'} p-6 text-white`}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm uppercase tracking-wider opacity-80">Overall Score</p>
            <p className="text-5xl font-bold mt-2">{score ?? 'N/A'}%</p>
            <p className="text-lg mt-1 opacity-90">
              {ragLabels[ragStatus as keyof typeof ragLabels] || 'Unknown'}
            </p>
          </div>
          <Shield className="w-20 h-20 opacity-30" />
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-5 divide-x divide-gray-200 dark:divide-gray-700">
        <SummaryStat label="Total Items" value={summary?.total || 0} />
        <SummaryStat label="Passed" value={summary?.passed || 0} color="green" />
        <SummaryStat label="Failed" value={summary?.failed || 0} color="red" />
        <SummaryStat label="N/A" value={summary?.na || 0} />
        <SummaryStat label="Critical Failures" value={summary?.critical_failures || 0} color="red" />
      </div>
    </div>
  );
}

function SummaryStat({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color?: 'green' | 'red';
}) {
  const colorClasses = {
    green: 'text-green-600',
    red: 'text-red-600',
  };

  return (
    <div className="p-4 text-center">
      <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`text-2xl font-bold ${color ? colorClasses[color] : 'text-gray-900 dark:text-white'}`}>
        {value}
      </p>
    </div>
  );
}

function CategoryResultCard({ category, data }: { category: string; data: any }) {
  const [expanded, setExpanded] = useState(false);

  const passRate = data.total > 0 ? Math.round((data.passed / data.total) * 100) : 0;
  const hasFailures = data.failed > 0;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 flex items-center justify-between text-left hover:bg-gray-50 dark:hover:bg-gray-700/50"
      >
        <div className="flex items-center gap-3">
          {hasFailures ? (
            <AlertTriangle className="w-5 h-5 text-red-500" />
          ) : (
            <CheckCircle className="w-5 h-5 text-green-500" />
          )}
          <div>
            <p className="font-medium text-gray-900 dark:text-white capitalize">
              {category.replace(/_/g, ' ')}
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {data.passed}/{data.total} passed ({passRate}%)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {hasFailures && (
            <span className="px-2 py-1 text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 rounded">
              {data.failed} Failed
            </span>
          )}
          <div className="w-24 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className={`h-full ${hasFailures ? 'bg-amber-500' : 'bg-green-500'}`}
              style={{ width: `${passRate}%` }}
            />
          </div>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700">
          {data.items.map((item: any) => (
            <div key={item.id} className="p-4 flex items-start gap-3">
              {item.response === 'pass' ? (
                <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
              ) : item.response === 'fail' ? (
                <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
              ) : (
                <Clock className="w-5 h-5 text-gray-400 flex-shrink-0" />
              )}
              <div className="flex-1">
                <p className="text-gray-900 dark:text-white">{item.item_text}</p>
                {item.notes && (
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{item.notes}</p>
                )}
                {item.corrective_action_required && (
                  <span className="inline-flex items-center gap-1 mt-2 px-2 py-1 text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 rounded">
                    <AlertTriangle className="w-3 h-3" />
                    Corrective action required
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Use layout only for results view, wizard is fullscreen
AuditDetailPage.getLayout = (page: React.ReactElement) => {
  // Check if we should use layout (completed audit) or not (wizard mode)
  // This is a simplified approach - in production you might want a more robust solution
  return <AppLayout>{page}</AppLayout>;
};
