/**
 * Single Contractor Document Report
 *
 * Complete document status report for a single contractor
 */

'use client';

import React, { useState } from 'react';
import { FileText, Download, Printer, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { log } from '@/lib/logger';
import { Button } from '@/components/ui/button';
import { notificationService } from '@/services/core/NotificationService';
import { useContractorDocumentReport } from '../hooks/useDocumentReport';
import {
  DocumentStatusTable,
  CompletionProgressBar,
  ExpiryAlert,
  DocumentStatusBadge,
} from './index';
import type { DocumentInfo } from '../types/documentReport.types';

interface SingleContractorReportProps {
  contractorId: string;
  showBackButton?: boolean;
}

export default function SingleContractorReport({
  contractorId,
  showBackButton = false,
}: SingleContractorReportProps) {
  const { data, loading, error } = useContractorDocumentReport(contractorId);
  const [viewingDocument, setViewingDocument] = useState<DocumentInfo | null>(null);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-muted-foreground">Loading document report...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <p className="text-red-800">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-background border border-border rounded-lg p-4">
        <p className="text-muted-foreground">No report data available</p>
      </div>
    );
  }

  const handleViewDocument = (doc: DocumentInfo) => {
    if (doc.fileUrl) {
      window.open(doc.fileUrl, '_blank');
    }
  };

  const handleUploadDocument = (docType: string) => {
    // Navigate to upload page or open upload modal
    log.debug('SingleContractorReport', { action: 'uploadDocument', docType, status: 'notImplemented' });
    // TODO: Implement upload flow
  };

  const handleExportCSV = async () => {
    try {
      const response = await fetch(
        `/api/contractors-documents-export?contractorId=${contractorId}&format=csv`
      );

      if (!response.ok) throw new Error('Export failed');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${data?.contractor.name.replace(/\s+/g, '_')}_Documents_Report.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      notificationService.success('CSV exported successfully');
    } catch (error) {
      log.error('SingleContractorReport', { action: 'exportCSV', error, contractorId });
      notificationService.error('Failed to export CSV');
    }
  };

  const handleExportPDF = () => {
    // TODO: Implement PDF export
    notificationService.info('PDF export coming soon');
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          {showBackButton && (
            <Link
              href="/contractors/documents-report"
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-blue-600 mb-2"
            >
              <ArrowLeft size={16} />
              Back to All Contractors
            </Link>
          )}
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <FileText size={28} />
            {data.contractor.name} - Document Status Report
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Last updated: {new Date(data.lastUpdated).toLocaleString('en-ZA')}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={handleExportCSV}>
            <Download size={16} />
            <span className="hidden sm:inline">CSV</span>
          </Button>
          <Button variant="secondary" onClick={handleExportPDF}>
            <Download size={16} />
            <span className="hidden sm:inline">PDF</span>
          </Button>
          <Button variant="secondary" onClick={handlePrint}>
            <Printer size={16} />
            <span className="hidden sm:inline">Print</span>
          </Button>
        </div>
      </div>

      {/* Alerts Section */}
      {data.alerts.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-foreground mb-3">⚠️ Alerts</h2>
          <ExpiryAlert alerts={data.alerts} />
        </div>
      )}

      {/* Summary Card */}
      <div className="bg-card p-6 rounded-lg border border-border">
        <h2 className="text-lg font-semibold text-foreground mb-4">Document Completion Summary</h2>

        {/* Progress Bar */}
        <div className="mb-6">
          <CompletionProgressBar
            percentage={data.summary.completionPercentage}
            showLabel={true}
            height="lg"
          />
        </div>

        {/* Status Counts */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-green-600">{data.summary.verified}</div>
            <div className="text-xs text-muted-foreground mt-1">Verified</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-yellow-600">{data.summary.pending}</div>
            <div className="text-xs text-muted-foreground mt-1">Pending</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-muted-foreground">{data.summary.missing}</div>
            <div className="text-xs text-muted-foreground mt-1">Missing</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-red-600">{data.summary.expired}</div>
            <div className="text-xs text-muted-foreground mt-1">Expired</div>
          </div>
        </div>

        {/* Additional Stats */}
        <div className="mt-4 pt-4 border-t border-border">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              Total Documents: <strong>{data.summary.totalDocuments}</strong>
            </span>
            {data.summary.expiring > 0 && (
              <span className="text-orange-600">
                ⚠️ {data.summary.expiring} expiring soon
              </span>
            )}
            {data.summary.rejected > 0 && (
              <span className="text-purple-600">
                🔄 {data.summary.rejected} rejected
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Documents Table */}
      <div className="bg-card p-6 rounded-lg border border-border">
        <DocumentStatusTable
          companyDocuments={data.companyDocuments}
          teamDocuments={data.teamDocuments}
          onViewDocument={handleViewDocument}
          onUploadDocument={handleUploadDocument}
        />
      </div>
    </div>
  );
}
