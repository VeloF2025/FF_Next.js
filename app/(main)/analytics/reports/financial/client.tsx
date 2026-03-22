/**
 * Financial Reports Client — expandable report cards for all financial reports.
 * 🟢 WORKING: Cashflow Overview, Cost Centre Revenue, Expense Pivot,
 *             Project COS/Rev Forecast, Project Detail
 */

'use client';

import { useState } from 'react';
import { BarChart2, ChevronDown, ChevronUp } from 'lucide-react';
import { REPORT_REGISTRY } from '@/modules/analytics/reports';
import RevenueOverview from '@/modules/analytics/reports/revenue-overview/RevenueOverview';
import ProjectRevenue from '@/modules/analytics/reports/project-revenue/ProjectRevenue';
import ExpensePivot from '@/modules/analytics/reports/expense-pivot/ExpensePivot';
import ProjectFin from '@/modules/analytics/reports/project-fin/ProjectFin';
import ProjectDetail from '@/modules/analytics/reports/project-detail/ProjectDetail';

// 🟢 WORKING: Map of report IDs to their React components
const REPORT_COMPONENTS: Record<string, React.ComponentType> = {
  'revenue-overview': RevenueOverview,
  'project-revenue': ProjectRevenue,
  'expense-pivot': ExpensePivot,
  'project-fin': ProjectFin,
  'project-detail': ProjectDetail,
};

export default function FinancialReportsClient() {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <>
      {REPORT_REGISTRY.length === 0 ? (
        <div className="rounded-lg border border-gray-700 bg-gray-800 p-12 text-center text-gray-400">
          <BarChart2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-lg font-medium">No reports registered yet</p>
          <p className="text-sm mt-1">Add reports to REPORT_REGISTRY to see them here.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {REPORT_REGISTRY.map((report) => {
            const isExpanded = expandedId === report.id;
            const ReportComponent = REPORT_COMPONENTS[report.id];
            return (
              <div
                key={report.id}
                className="rounded-lg border border-gray-700 bg-gray-800 overflow-hidden"
              >
                {/* Card Header */}
                <div className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <BarChart2 className="w-5 h-5 text-blue-400 flex-shrink-0" />
                    <div>
                      <h2 className="text-white font-semibold">{report.name}</h2>
                      <p className="text-sm text-gray-400">{report.description}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : report.id)}
                    className="flex items-center gap-2 px-3 py-1.5 rounded text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors"
                  >
                    {isExpanded ? (
                      <>
                        <ChevronUp className="w-4 h-4" />
                        Close
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-4 h-4" />
                        View Report
                      </>
                    )}
                  </button>
                </div>
                {/* Expanded Report */}
                {isExpanded && ReportComponent && (
                  <div className="border-t border-gray-700 p-4">
                    <ReportComponent />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
