/**
 * Contractor Health & Safety Tab Component
 *
 * Displays H&S compliance, documents, and gate status for a contractor.
 * Used in contractor detail pages.
 */

import React, { useState, useCallback } from 'react';
import useSWR from 'swr';
import {
  Shield,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  FileText,
  Upload,
  ChevronRight,
  Calendar,
  GraduationCap,
  AlertOctagon,
  Info,
  Loader2,
} from 'lucide-react';
import { DOCUMENT_TYPES, REQUIRED_DOCUMENTS } from '../types/compliance.types';
import { formatDisplayDate } from '@/utils/dateFormat';

interface ContractorHSTabProps {
  contractorId: string | number;
  contractorName?: string;
  onUploadDocument?: () => void;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function ContractorHSTab({
  contractorId,
  contractorName,
  onUploadDocument,
}: ContractorHSTabProps) {
  const [activeSection, setActiveSection] = useState<'overview' | 'documents' | 'incidents'>('overview');

  // Fetch compliance data
  const { data: complianceData, error, mutate } = useSWR(
    `/api/health-safety/contractor/${contractorId}/compliance`,
    fetcher
  );

  // Fetch gate check
  const { data: gateData } = useSWR(
    `/api/health-safety/contractor/${contractorId}/gate-check`,
    fetcher
  );

  const isLoading = !complianceData && !error;
  const compliance = complianceData?.data;
  const gate = gateData?.data?.gate;
  const breakdown = gateData?.data?.breakdown;

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-32 bg-secondary rounded-lg" />
        <div className="h-48 bg-secondary rounded-lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-center">
        <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-red-500" />
        <p className="text-red-600">Failed to load H&S data</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Gate Status Banner */}
      <GateStatusBanner gate={gate} breakdown={breakdown} />

      {/* Score Overview */}
      <div className="bg-card rounded-lg border border-border p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Shield className="w-5 h-5 text-green-500" />
            Compliance Overview
          </h3>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <ScoreCard
            label="Overall Score"
            value={compliance?.score?.overallScore ?? 'N/A'}
            ragStatus={compliance?.score?.ragStatus}
            large
          />

          <ScoreCard
            label="Documents"
            value={compliance?.documents?.percentage ?? 0}
            subtitle={`${compliance?.documents?.valid_count || 0}/${compliance?.documents?.required_count || 0}`}
          />

          <ScoreCard
            label="Incidents"
            value={compliance?.incidents?.total_12_months ?? 0}
            subtitle="Last 12 months"
            isCount
          />

          <ScoreCard
            label="Training"
            value={compliance?.training?.percentage ?? 0}
            subtitle={`${compliance?.training?.valid_count || 0}/${compliance?.training?.required_count || 0}`}
          />

          <ScoreCard
            label="Audits"
            value={compliance?.audits?.average_score ?? 'N/A'}
            subtitle={`${compliance?.audits?.total_12_months || 0} audits`}
          />
        </div>
      </div>

      {/* Section Tabs */}
      <div className="flex gap-2 border-b border-border">
        <TabButton
          active={activeSection === 'overview'}
          onClick={() => setActiveSection('overview')}
          icon={Info}
          label="Overview"
        />
        <TabButton
          active={activeSection === 'documents'}
          onClick={() => setActiveSection('documents')}
          icon={FileText}
          label="Documents"
          badge={compliance?.documents?.required_count - (compliance?.documents?.valid_count || 0)}
        />
        <TabButton
          active={activeSection === 'incidents'}
          onClick={() => setActiveSection('incidents')}
          icon={AlertTriangle}
          label="Incidents"
          badge={compliance?.incidents?.open}
        />
      </div>

      {/* Section Content */}
      {activeSection === 'overview' && (
        <OverviewSection compliance={compliance} breakdown={breakdown} />
      )}

      {activeSection === 'documents' && (
        <DocumentsSection
          contractorId={contractorId}
          documents={compliance?.documents}
          onUpload={onUploadDocument}
          mutate={mutate}
        />
      )}

      {activeSection === 'incidents' && (
        <IncidentsSection contractorId={contractorId} incidents={compliance?.incidents} />
      )}
    </div>
  );
}

// Sub-components

function GateStatusBanner({
  gate,
  breakdown,
}: {
  gate?: { passed: boolean; blocking_reasons?: string[] };
  breakdown?: any;
}) {
  if (!gate) return null;

  if (gate.passed) {
    return (
      <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4 flex items-center gap-3">
        <CheckCircle className="w-6 h-6 text-green-500 flex-shrink-0" />
        <div>
          <p className="font-medium text-green-800 dark:text-green-200">
            Approved for Project Assignment
          </p>
          <p className="text-sm text-green-600 dark:text-green-300">
            This contractor meets all H&S requirements
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
      <div className="flex items-start gap-3">
        <AlertOctagon className="w-6 h-6 text-red-500 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="font-medium text-red-800 dark:text-red-200">
            Cannot Assign to Projects
          </p>
          <p className="text-sm text-red-600 dark:text-red-300 mb-2">
            This contractor does not meet H&S requirements:
          </p>
          <ul className="list-disc list-inside text-sm text-red-600 dark:text-red-300 space-y-1">
            {gate.blocking_reasons?.map((reason, i) => (
              <li key={i}>{reason}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function ScoreCard({
  label,
  value,
  subtitle,
  ragStatus,
  large,
  isCount,
}: {
  label: string;
  value: number | string;
  subtitle?: string;
  ragStatus?: 'green' | 'amber' | 'red';
  large?: boolean;
  isCount?: boolean;
}) {
  const ragColors = {
    green: 'text-green-500 bg-green-50 dark:bg-green-900/20',
    amber: 'text-amber-500 bg-amber-50 dark:bg-amber-900/20',
    red: 'text-red-500 bg-red-50 dark:bg-red-900/20',
  };

  const displayValue = typeof value === 'number' && !isCount ? `${value}%` : value;

  return (
    <div
      className={`p-4 rounded-lg ${ragStatus ? ragColors[ragStatus] : 'bg-secondary/50'} ${large ? 'md:col-span-1' : ''}`}
    >
      <p className="text-sm text-muted-foreground">{label}</p>
      <p
        className={`font-bold ${large ? 'text-3xl' : 'text-2xl'} ${ragStatus ? '' : 'text-foreground'}`}
      >
        {displayValue}
      </p>
      {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  label: string;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-3 font-medium text-sm border-b-2 transition-colors ${
        active
          ? 'border-orange-500 text-orange-600 dark:text-orange-400'
          : 'border-transparent text-muted-foreground hover:text-muted-foreground dark:hover:text-gray-200'
      }`}
    >
      <Icon className="w-4 h-4" />
      {label}
      {badge && badge > 0 && (
        <span className="px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 rounded-full">
          {badge}
        </span>
      )}
    </button>
  );
}

function OverviewSection({
  compliance,
  breakdown,
}: {
  compliance?: any;
  breakdown?: any;
}) {
  return (
    <div className="grid md:grid-cols-2 gap-6">
      {/* Score Breakdown */}
      <div className="bg-card rounded-lg border border-border p-4">
        <h4 className="font-medium text-foreground mb-4">Score Breakdown</h4>
        <div className="space-y-3">
          <ScoreBar label="Documents" value={compliance?.score?.documentScore} weight={25} />
          <ScoreBar label="Incidents" value={compliance?.score?.incidentScore} weight={30} />
          <ScoreBar label="Training" value={compliance?.score?.trainingScore} weight={15} />
          <ScoreBar label="Corrective Actions" value={compliance?.score?.correctiveActionScore} weight={15} />
          <ScoreBar label="Audit Average" value={compliance?.score?.auditScore} weight={15} />
        </div>
      </div>

      {/* Training Status */}
      <div className="bg-card rounded-lg border border-border p-4">
        <h4 className="font-medium text-foreground mb-4 flex items-center gap-2">
          <GraduationCap className="w-5 h-5" />
          Training Status
        </h4>
        <div className="space-y-2">
          {Object.entries(compliance?.training?.status || {}).map(([key, valid]) => (
            <div key={key} className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
              <span className="text-sm text-muted-foreground capitalize">
                {key.replace(/_/g, ' ')}
              </span>
              {valid ? (
                <CheckCircle className="w-5 h-5 text-green-500" />
              ) : (
                <XCircle className="w-5 h-5 text-red-500" />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Corrective Actions */}
      <div className="bg-card rounded-lg border border-border p-4">
        <h4 className="font-medium text-foreground mb-4">Corrective Actions</h4>
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center">
            <p className="text-2xl font-bold text-orange-500">{compliance?.corrective_actions?.open || 0}</p>
            <p className="text-xs text-muted-foreground">Open</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-red-500">{compliance?.corrective_actions?.overdue || 0}</p>
            <p className="text-xs text-muted-foreground">Overdue</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-green-500">{compliance?.corrective_actions?.closed || 0}</p>
            <p className="text-xs text-muted-foreground">Closed</p>
          </div>
        </div>
      </div>

      {/* Gate Check Details */}
      {breakdown && (
        <div className="bg-card rounded-lg border border-border p-4">
          <h4 className="font-medium text-foreground mb-4">Gate Requirements</h4>
          <div className="space-y-3">
            <GateCheckItem
              label="Documents"
              passed={breakdown.documents?.passed}
              message={breakdown.documents?.message}
            />
            <GateCheckItem
              label="Incidents"
              passed={breakdown.incidents?.passed}
              message={breakdown.incidents?.message}
            />
            <GateCheckItem
              label="Compliance Score"
              passed={breakdown.compliance_score?.passed}
              message={breakdown.compliance_score?.message}
            />
            <GateCheckItem
              label="Training"
              passed={breakdown.training?.passed}
              message={breakdown.training?.message}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ScoreBar({
  label,
  value,
  weight,
}: {
  label: string;
  value?: number;
  weight: number;
}) {
  const score = value ?? 0;
  const color = score >= 80 ? 'bg-green-500' : score >= 50 ? 'bg-amber-500' : 'bg-red-500';

  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-muted-foreground">
          {Math.round(score)}% <span className="text-xs">({weight}% weight)</span>
        </span>
      </div>
      <div className="h-2 bg-secondary rounded-full overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

function GateCheckItem({
  label,
  passed,
  message,
}: {
  label: string;
  passed?: boolean;
  message?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      {passed ? (
        <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
      ) : (
        <XCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
      )}
      <div>
        <p className="font-medium text-foreground">{label}</p>
        {message && <p className="text-sm text-muted-foreground">{message}</p>}
      </div>
    </div>
  );
}

function DocumentsSection({
  contractorId,
  documents,
  onUpload,
  mutate,
}: {
  contractorId: string | number;
  documents?: any;
  onUpload?: () => void;
  mutate: () => void;
}) {
  // Fetch full document list
  const { data: docsData } = useSWR(
    `/api/health-safety/contractor/${contractorId}/documents`,
    fetcher
  );

  const compliance = docsData?.data?.compliance || {};

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {documents?.valid_count || 0} of {documents?.required_count || 0} required documents valid
        </p>
        <button
          onClick={onUpload || (() => {})}
          className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition-colors"
        >
          <Upload className="w-4 h-4" />
          Upload Document
        </button>
      </div>

      <div className="bg-card rounded-lg border border-border divide-y divide-gray-200 dark:divide-gray-700">
        {REQUIRED_DOCUMENTS.map((docType) => {
          const doc = compliance[docType];
          const typeInfo = DOCUMENT_TYPES[docType as keyof typeof DOCUMENT_TYPES];

          return (
            <div key={docType} className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className={`p-2 rounded-lg ${
                    doc?.status === 'valid'
                      ? 'bg-green-100 dark:bg-green-900/30'
                      : doc?.status === 'invalid'
                        ? 'bg-red-100 dark:bg-red-900/30'
                        : 'bg-secondary'
                  }`}
                >
                  <FileText
                    className={`w-5 h-5 ${
                      doc?.status === 'valid'
                        ? 'text-green-600'
                        : doc?.status === 'invalid'
                          ? 'text-red-600'
                          : 'text-gray-400'
                    }`}
                  />
                </div>
                <div>
                  <p className="font-medium text-foreground">
                    {typeInfo?.label || docType}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {doc?.document?.expiry_date
                      ? `Expires: ${formatDisplayDate(doc.document.expiry_date)}`
                      : 'No expiry'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {doc?.status === 'valid' && (
                  <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded">
                    Valid
                  </span>
                )}
                {doc?.status === 'invalid' && (
                  <span className="px-2 py-1 text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 rounded">
                    Invalid/Expired
                  </span>
                )}
                {doc?.status === 'missing' && (
                  <span className="px-2 py-1 text-xs font-medium bg-secondary text-gray-700 dark:bg-gray-700 dark:text-gray-400 rounded">
                    Missing
                  </span>
                )}
                <ChevronRight className="w-5 h-5 text-gray-400" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function IncidentsSection({
  contractorId,
  incidents,
}: {
  contractorId: string | number;
  incidents?: any;
}) {
  // Fetch incidents
  const { data: incidentsData } = useSWR(
    `/api/health-safety/incidents?contractor_id=${contractorId}&limit=10`,
    fetcher
  );

  const incidentList = incidentsData?.data?.incidents || [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-card rounded-lg border border-border p-4 text-center">
          <p className="text-3xl font-bold text-foreground">
            {incidents?.total_12_months || 0}
          </p>
          <p className="text-sm text-muted-foreground">Total (12 months)</p>
        </div>
        <div className="bg-card rounded-lg border border-border p-4 text-center">
          <p className="text-3xl font-bold text-red-500">{incidents?.critical_12_months || 0}</p>
          <p className="text-sm text-muted-foreground">Critical</p>
        </div>
        <div className="bg-card rounded-lg border border-border p-4 text-center">
          <p className="text-3xl font-bold text-orange-500">{incidents?.open || 0}</p>
          <p className="text-sm text-muted-foreground">Open</p>
        </div>
      </div>

      {incidentList.length > 0 ? (
        <div className="bg-card rounded-lg border border-border divide-y divide-gray-200 dark:divide-gray-700">
          {incidentList.map((incident: any) => (
            <a
              key={incident.id}
              href={`/maintenance/tickets/${incident.id}`}
              className="p-4 flex items-center justify-between hover:bg-accent/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div
                  className={`p-2 rounded-lg ${
                    incident.severity === 'critical'
                      ? 'bg-red-100 dark:bg-red-900/30'
                      : incident.severity === 'major'
                        ? 'bg-orange-100 dark:bg-orange-900/30'
                        : 'bg-secondary'
                  }`}
                >
                  <AlertTriangle
                    className={`w-5 h-5 ${
                      incident.severity === 'critical'
                        ? 'text-red-600'
                        : incident.severity === 'major'
                          ? 'text-orange-600'
                          : 'text-muted-foreground'
                    }`}
                  />
                </div>
                <div>
                  <p className="font-medium text-foreground">{incident.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {formatDisplayDate(incident.incident_date)} •{' '}
                    {incident.incident_type?.replace(/_/g, ' ')}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`px-2 py-1 text-xs font-medium rounded capitalize ${
                    incident.status === 'closed'
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                  }`}
                >
                  {incident.status}
                </span>
                <ChevronRight className="w-5 h-5 text-gray-400" />
              </div>
            </a>
          ))}
        </div>
      ) : (
        <div className="bg-card rounded-lg border border-border p-8 text-center">
          <CheckCircle className="w-12 h-12 mx-auto mb-2 text-green-500" />
          <p className="text-muted-foreground">No incidents recorded</p>
        </div>
      )}
    </div>
  );
}

export default ContractorHSTab;
