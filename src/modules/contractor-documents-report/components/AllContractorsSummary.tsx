/**
 * All Contractors Summary Component
 *
 * Displays document completion summary for all contractors
 */

'use client';

import React, { useState } from 'react';
import { FileText, Search, Download, AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { log } from '@/lib/logger';
import { useAllContractorsSummary } from '../hooks/useDocumentReport';
import { CompletionProgressBar } from './index';
import { getComplianceLevel } from '../utils/completenessCalculator';

export default function AllContractorsSummary() {
  const { data, loading, error } = useAllContractorsSummary();
  const [searchTerm, setSearchTerm] = useState('');

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-muted-foreground">Loading contractors summary...</p>
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
        <p className="text-muted-foreground">No summary data available</p>
      </div>
    );
  }

  // Filter contractors by search term
  const filteredContractors = data.contractors.filter((contractor) =>
    contractor.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleExportAll = () => {
    // TODO: Implement export all to CSV
    log.debug('AllContractorsSummary', { action: 'exportAllContractors', status: 'notImplemented' });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <FileText size={28} />
            Contractor Documents Status Report
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Overview of document compliance across all contractors
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportAll}
            className="inline-flex items-center gap-2 px-4 py-2 border border-border rounded-lg hover:bg-background"
          >
            <Download size={16} />
            Export All CSV
          </button>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 px-4 py-2 border border-border rounded-lg hover:bg-background"
          >
            Print
          </button>
        </div>
      </div>

      {/* Overall Statistics */}
      <div className="bg-card p-6 rounded-lg border border-border">
        <h2 className="text-lg font-semibold text-foreground mb-4">📊 Overall Statistics</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="text-center p-4 bg-green-50 rounded-lg border border-green-200">
            <div className="text-3xl font-bold text-green-700">{data.overallStats.fullyCompliant}</div>
            <div className="text-sm text-green-800 mt-1 font-medium">Fully Compliant</div>
            <div className="text-xs text-green-600 mt-1">100% Complete</div>
          </div>
          <div className="text-center p-4 bg-yellow-50 rounded-lg border border-yellow-200">
            <div className="text-3xl font-bold text-yellow-700">{data.overallStats.partiallyCompliant}</div>
            <div className="text-sm text-yellow-800 mt-1 font-medium">Partially Compliant</div>
            <div className="text-xs text-yellow-600 mt-1">50-99% Complete</div>
          </div>
          <div className="text-center p-4 bg-red-50 rounded-lg border border-red-200">
            <div className="text-3xl font-bold text-red-700">{data.overallStats.nonCompliant}</div>
            <div className="text-sm text-red-800 mt-1 font-medium">Non-Compliant</div>
            <div className="text-xs text-red-600 mt-1">&lt;50% Complete</div>
          </div>
        </div>
      </div>

      {/* Search Bar */}
      <div className="bg-card p-4 rounded-lg border border-border">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
          <input
            type="text"
            placeholder="Search contractors..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      </div>

      {/* Contractors Table */}
      <div className="bg-card rounded-lg border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-background">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground tracking-wide">
                  Contractor
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground tracking-wide">
                  Completion
                </th>
                <th className="px-6 py-3 text-center text-xs font-medium text-muted-foreground tracking-wide">
                  Missing
                </th>
                <th className="px-6 py-3 text-center text-xs font-medium text-muted-foreground tracking-wide">
                  Expired
                </th>
                <th className="px-6 py-3 text-center text-xs font-medium text-muted-foreground tracking-wide">
                  Pending
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground tracking-wide">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-card divide-y divide-gray-200">
              {filteredContractors.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">
                    {searchTerm ? 'No contractors found matching your search' : 'No contractors available'}
                  </td>
                </tr>
              ) : (
                filteredContractors.map((contractor) => {
                  const compliance = getComplianceLevel(contractor.completionPercentage);
                  const rowClass =
                    compliance === 'non'
                      ? 'bg-red-50'
                      : contractor.hasAlerts
                      ? 'bg-yellow-50'
                      : '';

                  return (
                    <tr key={contractor.id} className={`hover:bg-background ${rowClass}`}>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          {contractor.hasAlerts && (
                            <AlertCircle size={16} className="text-orange-500 flex-shrink-0" />
                          )}
                          <div>
                            <div className="text-sm font-medium text-foreground">
                              {contractor.name}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {contractor.verified} verified, {contractor.totalDocuments} total
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="w-40">
                          <CompletionProgressBar
                            percentage={contractor.completionPercentage}
                            showLabel={false}
                            height="sm"
                          />
                          <div className="text-xs text-muted-foreground mt-1 text-center font-medium">
                            {contractor.completionPercentage}%
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span
                          className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium ${
                            contractor.missing > 0
                              ? 'bg-secondary text-foreground'
                              : 'bg-green-100 text-green-800'
                          }`}
                        >
                          {contractor.missing}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span
                          className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium ${
                            contractor.expired > 0
                              ? 'bg-red-100 text-red-800'
                              : 'bg-green-100 text-green-800'
                          }`}
                        >
                          {contractor.expired}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span
                          className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium ${
                            contractor.pending > 0
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-green-100 text-green-800'
                          }`}
                        >
                          {contractor.pending}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Link
                          href={`/contractors/${contractor.id}/documents-report`}
                          className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 font-medium"
                        >
                          View Report
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footer Info */}
      <div className="text-sm text-muted-foreground text-center">
        Showing {filteredContractors.length} of {data.contractors.length} contractors
      </div>
    </div>
  );
}
