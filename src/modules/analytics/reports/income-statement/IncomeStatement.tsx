/**
 * IncomeStatement — P&L report from Fin Summary worksheet.
 * Table tab: structured P&L rows (Revenue, COS, Gross Profit, OPEX, Net)
 * Charts tab: placeholder
 */

// 🟢 WORKING: Income Statement report component
'use client';

import { Loader2, AlertCircle } from 'lucide-react';
import { ReportTabLayout } from '../ReportTabLayout';
import { useIncomeStatementData } from './useIncomeStatementData';
import { IncomeStatementTable } from '../tables/IncomeStatementTable';

export default function IncomeStatement() {
  const { data, isLoading, error } = useIncomeStatementData();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        Loading income statement&hellip;
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-red-400 p-4">
        <AlertCircle className="w-5 h-5 flex-shrink-0" />
        <span>{error.message}</span>
      </div>
    );
  }

  const reportData = data?.data;

  if (!reportData) return null;

  return (
    <ReportTabLayout
      tableContent={<IncomeStatementTable data={reportData} />}
      chartsContent={
        <div className="flex items-center justify-center h-40 text-gray-500 text-sm">
          Charts coming soon
        </div>
      }
    />
  );
}
