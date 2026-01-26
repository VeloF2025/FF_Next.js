/**
 * Document Expiry Management Page (PRD-058)
 * Unified view of all expiring documents across the system
 */

import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { UnifiedExpiryWidget } from '@/modules/projects/components/UnifiedExpiryWidget';
import {
  FileWarning,
  Filter,
  RefreshCw,
  Download,
} from 'lucide-react';

type SourceFilter = 'all' | 'pipeline_approval' | 'contractor_document' | 'agreement' | 'project_requirement' | 'staff_document';

const SOURCE_OPTIONS: { value: SourceFilter; label: string }[] = [
  { value: 'all', label: 'All Sources' },
  { value: 'pipeline_approval', label: 'Pipeline Approvals' },
  { value: 'contractor_document', label: 'Contractor Documents' },
  { value: 'agreement', label: 'Agreements (SOW/MBA)' },
  { value: 'project_requirement', label: 'Project Requirements' },
  { value: 'staff_document', label: 'Staff Documents' },
];

export default function DocumentExpiryPage() {
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [refreshKey, setRefreshKey] = useState(0);

  const handleRefresh = () => {
    setRefreshKey(prev => prev + 1);
  };

  const handleExport = async () => {
    try {
      const params = new URLSearchParams({ days: '365' });
      if (sourceFilter !== 'all') params.set('source', sourceFilter);

      const response = await fetch(`/api/projects/expiring-documents?${params}`);
      const data = await response.json();

      if (!data.success || !data.data?.all) {
        throw new Error('Failed to fetch data');
      }

      // Create CSV
      const headers = ['Document Type', 'Name', 'Source', 'Expiry Date', 'Days Until Expiry', 'Urgency', 'Project/Entity'];
      const rows = data.data.all.map((doc: {
        document_type: string;
        document_name: string;
        source: string;
        expiry_date: string;
        days_until_expiry: number;
        urgency: string;
        project_name?: string;
        contractor_name?: string;
        staff_name?: string;
      }) => [
        doc.document_type,
        doc.document_name,
        doc.source,
        doc.expiry_date,
        doc.days_until_expiry,
        doc.urgency,
        doc.project_name || doc.contractor_name || doc.staff_name || '',
      ]);

      const csv = [headers.join(','), ...rows.map((row: string[]) => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))].join('\n');

      const blob = new Blob([csv], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `expiring-documents-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      alert('Failed to export: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
              <FileWarning className="w-6 h-6 text-amber-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">
                Document Expiry Management
              </h1>
              <p className="text-sm text-[var(--ff-text-secondary)]">
                Track and manage all expiring documents across the system
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleRefresh}
              className="p-2 rounded-lg border border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)] transition-colors"
              title="Refresh"
            >
              <RefreshCw className="w-5 h-5 text-[var(--ff-text-secondary)]" />
            </button>
            <button
              onClick={handleExport}
              className="flex items-center gap-2 px-4 py-2 border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors"
            >
              <Download className="w-4 h-4" />
              Export CSV
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="ff-card">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-[var(--ff-text-secondary)]" />
              <span className="text-sm font-medium text-[var(--ff-text-primary)]">Filter by Source:</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {SOURCE_OPTIONS.map(option => (
                <button
                  key={option.value}
                  onClick={() => setSourceFilter(option.value)}
                  className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                    sourceFilter === option.value
                      ? 'bg-[var(--ff-accent)] text-white'
                      : 'bg-[var(--ff-bg-secondary)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-tertiary)]'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Unified Expiry Widget (Full View) */}
        <UnifiedExpiryWidget
          key={`${refreshKey}-${sourceFilter}`}
          compact={false}
        />
      </div>
    </AppLayout>
  );
}
