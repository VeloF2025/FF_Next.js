/**
 * Contractor H&S Grid Component
 * Displays H&S compliance status for all contractors assigned to a project
 */

import { useRouter } from 'next/router';
import useSWR from 'swr';
import {
  Shield,
  AlertTriangle,
  CheckCircle,
  XCircle,
  ChevronRight,
  Building,
  AlertCircle,
  Users,
  RefreshCw,
} from 'lucide-react';
import { log } from '@/lib/logger';

interface ContractorHSStatus {
  contractor_id: string;
  company_name: string;
  contact_person: string | null;
  role: string;
  assignment_status: string;
  overall_score: number;
  rag_status: 'red' | 'amber' | 'green';
  document_score: number;
  incident_score: number;
  training_score: number;
  audit_score: number;
  is_gate_approved: boolean;
  gate_blockers: string[];
  gate_warnings: string[];
  last_audit_date: string | null;
  next_audit_due: string | null;
  open_incidents: number;
  calculated_at: string | null;
}

interface ContractorsHSResponse {
  contractors: ContractorHSStatus[];
  summary: {
    total: number;
    gate_approved: number;
    gate_blocked: number;
    rag: { red: number; amber: number; green: number };
    average_score: number;
    total_open_incidents: number;
  };
}

interface ContractorHSGridProps {
  projectId: string;
  compact?: boolean;
}

const fetcher = (url: string) => fetch(url).then(r => r.json());

function getRagColor(rag: 'red' | 'amber' | 'green') {
  switch (rag) {
    case 'green':
      return {
        bg: 'bg-green-100 dark:bg-green-900/30',
        text: 'text-green-700 dark:text-green-300',
        border: 'border-green-200 dark:border-green-800',
      };
    case 'amber':
      return {
        bg: 'bg-amber-100 dark:bg-amber-900/30',
        text: 'text-amber-700 dark:text-amber-300',
        border: 'border-amber-200 dark:border-amber-800',
      };
    case 'red':
      return {
        bg: 'bg-red-100 dark:bg-red-900/30',
        text: 'text-red-700 dark:text-red-300',
        border: 'border-red-200 dark:border-red-800',
      };
  }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'N/A';
  return new Date(dateStr).toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function ContractorHSGrid({ projectId, compact = false }: ContractorHSGridProps) {
  const router = useRouter();

  const { data, error, isLoading, mutate } = useSWR<{ data: ContractorsHSResponse }>(
    `/api/projects/${projectId}/contractors-hs`,
    fetcher
  );

  const contractors = data?.data?.contractors || [];
  const summary = data?.data?.summary;

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-20 bg-gray-200 dark:bg-gray-700 rounded-lg" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-32 bg-gray-200 dark:bg-gray-700 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    log.error('Failed to load contractor H&S data', { error, projectId }, 'ContractorHSGrid');
    return (
      <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
        <div className="flex items-center gap-2 text-red-700 dark:text-red-300">
          <AlertTriangle className="w-5 h-5" />
          <span>Failed to load contractor H&S data</span>
          <button
            onClick={() => mutate()}
            className="ml-auto text-sm underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (contractors.length === 0) {
    return (
      <div className="p-6 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 text-center">
        <Users className="w-12 h-12 mx-auto mb-3 text-gray-400" />
        <h4 className="font-medium text-gray-900 dark:text-white mb-1">No Contractors Assigned</h4>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Assign contractors to this project to track their H&S compliance.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary Bar */}
      {!compact && summary && (
        <div className="flex flex-wrap items-center gap-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 dark:text-gray-400">Contractors:</span>
            <span className="font-semibold text-gray-900 dark:text-white">{summary.total}</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-green-500" />
            <span className="text-sm text-gray-700 dark:text-gray-300">{summary.gate_approved} Gate Approved</span>
          </div>
          {summary.gate_blocked > 0 && (
            <div className="flex items-center gap-2">
              <XCircle className="w-4 h-4 text-red-500" />
              <span className="text-sm text-red-700 dark:text-red-300">{summary.gate_blocked} Blocked</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 dark:text-gray-400">Avg Score:</span>
            <span className={`font-semibold ${
              summary.average_score >= 80 ? 'text-green-600 dark:text-green-400' :
              summary.average_score >= 50 ? 'text-amber-600 dark:text-amber-400' :
              'text-red-600 dark:text-red-400'
            }`}>
              {summary.average_score}%
            </span>
          </div>
          {summary.total_open_incidents > 0 && (
            <div className="flex items-center gap-2 ml-auto">
              <AlertCircle className="w-4 h-4 text-orange-500" />
              <span className="text-sm text-orange-700 dark:text-orange-300">
                {summary.total_open_incidents} Open Incident{summary.total_open_incidents > 1 ? 's' : ''}
              </span>
            </div>
          )}
          <button
            onClick={() => mutate()}
            className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Contractor Cards */}
      <div className={`grid gap-4 ${compact ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'}`}>
        {contractors.map(contractor => {
          const ragColor = getRagColor(contractor.rag_status);

          return (
            <div
              key={contractor.contractor_id}
              className={`bg-white dark:bg-gray-800 rounded-lg border overflow-hidden hover:shadow-md transition-shadow cursor-pointer ${ragColor.border}`}
              onClick={() => router.push(`/contractors/${contractor.contractor_id}/health-safety`)}
            >
              {/* Header with RAG */}
              <div className={`px-4 py-2 ${ragColor.bg} flex items-center justify-between`}>
                <span className={`text-sm font-medium ${ragColor.text}`}>
                  {contractor.rag_status.toUpperCase()} - {contractor.overall_score}%
                </span>
                {contractor.is_gate_approved ? (
                  <CheckCircle className="w-5 h-5 text-green-500" />
                ) : (
                  <XCircle className="w-5 h-5 text-red-500" />
                )}
              </div>

              {/* Body */}
              <div className="p-4">
                {/* Company Name */}
                <div className="flex items-center gap-2 mb-2">
                  <Building className="w-4 h-4 text-gray-400" />
                  <h4 className="font-medium text-gray-900 dark:text-white truncate">
                    {contractor.company_name}
                  </h4>
                </div>

                {/* Role */}
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                  {contractor.role}
                </p>

                {/* Gate Status */}
                <div className="mb-3">
                  {contractor.is_gate_approved ? (
                    <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
                      <CheckCircle className="w-3 h-3" />
                      Gate Approved
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">
                      <XCircle className="w-3 h-3" />
                      Gate Blocked
                    </span>
                  )}
                </div>

                {/* Blockers */}
                {contractor.gate_blockers.length > 0 && (
                  <div className="mb-3 p-2 bg-red-50 dark:bg-red-900/20 rounded border border-red-200 dark:border-red-800">
                    <p className="text-xs font-medium text-red-700 dark:text-red-300 mb-1">Blockers:</p>
                    <ul className="text-xs text-red-600 dark:text-red-400 space-y-0.5">
                      {contractor.gate_blockers.slice(0, 2).map((blocker, i) => (
                        <li key={i} className="truncate">• {blocker}</li>
                      ))}
                      {contractor.gate_blockers.length > 2 && (
                        <li className="text-red-500">+{contractor.gate_blockers.length - 2} more</li>
                      )}
                    </ul>
                  </div>
                )}

                {/* Score Breakdown (compact) */}
                {!compact && (
                  <div className="grid grid-cols-4 gap-2 text-center mb-3">
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Docs</p>
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">{contractor.document_score}%</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Safety</p>
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">{contractor.incident_score}%</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Training</p>
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">{contractor.training_score}%</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Audit</p>
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">{contractor.audit_score}%</p>
                    </div>
                  </div>
                )}

                {/* Open Incidents Badge */}
                {contractor.open_incidents > 0 && (
                  <div className="flex items-center gap-2 text-orange-600 dark:text-orange-400 text-sm mb-3">
                    <AlertCircle className="w-4 h-4" />
                    <span>{contractor.open_incidents} open incident{contractor.open_incidents > 1 ? 's' : ''}</span>
                  </div>
                )}

                {/* View Details */}
                <div className="flex items-center justify-end text-sm text-blue-600 dark:text-blue-400">
                  <span className="flex items-center gap-1">
                    View Details <ChevronRight className="w-4 h-4" />
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default ContractorHSGrid;
