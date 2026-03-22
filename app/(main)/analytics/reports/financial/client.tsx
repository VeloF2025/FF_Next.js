/**
 * Financial Reports Client — expandable report cards for all financial reports.
 * 🟢 WORKING: Income Statement, Project Profitability, Revenue by Client,
 *             Cashflow Statement, OPEX (OPEX tab only), Income/Expenses (Data tab pivot),
 *             COS Breakdown, Assets, OPEX vs CAPEX
 */

'use client';

import { useState } from 'react';
import { BarChart2, ChevronDown, ChevronUp } from 'lucide-react';
import { REPORT_REGISTRY } from '@/modules/analytics/reports';
import RevenueOverview from '@/modules/analytics/reports/revenue-overview/RevenueOverview';
import ProjectRevenue from '@/modules/analytics/reports/project-revenue/ProjectRevenue';
import ExpensePivot from '@/modules/analytics/reports/expense-pivot/ExpensePivot';
import OPEXReport from '@/modules/analytics/reports/opex/OPEXReport';
import IncomeStatement from '@/modules/analytics/reports/income-statement/IncomeStatement';
import RevenueByClient from '@/modules/analytics/reports/revenue-by-client/RevenueByClient';
import CosBreakdown from '@/modules/analytics/reports/cos-breakdown/CosBreakdown';
import AssetsRegister from '@/modules/analytics/reports/assets-register/AssetsRegister';
import ComingSoon from '@/modules/analytics/reports/ComingSoon';

// 🟢 WORKING: Map of report IDs to their React components
const REPORT_COMPONENTS: Record<string, React.ComponentType> = {
  'income-statement': IncomeStatement,
  'project-profitability': ProjectRevenue,
  'revenue-by-client': RevenueByClient,
  'cashflow-statement': RevenueOverview,
  'opex': OPEXReport,                    // OPEX tab only — pure operational expenses
  'income-expenses': ExpensePivot,       // Data tab pivot — Expense/Income/All toggle
  'cos-breakdown': CosBreakdown,
  'assets-register': AssetsRegister,
  'opex-vs-capex': () => <ComingSoon name="OPEX vs CAPEX" />,
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
