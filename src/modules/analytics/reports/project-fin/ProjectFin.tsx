/**
 * ProjectFin — Project COS/Revenue/Net forecast.
 * Table tab: summary grid (Project | Revenue | COS | Gross Profit | GP%)
 * Charts tab: original 3-section detailed tables (COS / Revenue / Net by month)
 */

'use client';

import { AlertCircle } from 'lucide-react';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { useProjectFinData, type SectionData, type SectionTotals } from './useProjectFinData';
import { ReportTabLayout } from '../ReportTabLayout';
import { ProjectFinTable } from '../tables/ProjectFinTable';

function formatZAR(value: number): string {
  if (value === 0) return '\u2014';
  const abs = Math.abs(Math.round(value));
  const formatted = abs.toLocaleString('en-ZA').replace(/,/g, '\u00a0');
  return `${value < 0 ? '-' : ''}R\u00a0${formatted}`;
}

function netColour(value: number): string {
  if (value === 0) return 'text-gray-500';
  return value < 0 ? 'text-red-400' : 'text-emerald-400';
}

interface SectionTableProps {
  title: string; projects: string[]; months: string[];
  data: SectionData; totals: SectionTotals;
  colourCodeValues?: boolean; headerBg: string;
}

function SectionTable({ title, projects, months, data, totals, colourCodeValues = false, headerBg }: SectionTableProps) {
  return (
    <div>
      <div className={`${headerBg} px-4 py-2`}>
        <span className="text-white font-semibold text-sm tracking-wide">{title}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse min-w-max">
          <thead>
            <tr className="bg-slate-800 text-gray-300 text-xs uppercase tracking-wider">
              <th className="sticky left-0 z-10 bg-slate-800 text-left px-4 py-2 font-medium w-48 min-w-[12rem] border-r border-slate-700">Project</th>
              <th className="px-3 py-2 text-right font-medium w-32 border-r border-slate-700">Actual</th>
              {months.map(mon => (
                <th key={mon} className="px-3 py-2 text-right font-medium w-28">{mon}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {projects.map((project, rowIdx) => {
              const row = data[project];
              if (!row) return null;
              return (
                <tr key={project} className={rowIdx % 2 === 0 ? 'bg-slate-900' : 'bg-slate-800/60'}>
                  <td className="sticky left-0 z-10 px-4 py-1.5 font-medium text-gray-200 border-r border-slate-700 bg-inherit">{project}</td>
                  <td className={`px-3 py-1.5 text-right tabular-nums border-r border-slate-700 ${colourCodeValues ? netColour(row.actual) : 'text-gray-300'}`}>{formatZAR(row.actual)}</td>
                  {months.map(mon => {
                    const val = row[mon] ?? 0;
                    return <td key={mon} className={`px-3 py-1.5 text-right tabular-nums ${colourCodeValues ? netColour(val) : 'text-gray-400'}`}>{formatZAR(val)}</td>;
                  })}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-600 bg-slate-800 font-semibold">
              <td className="sticky left-0 z-10 bg-slate-800 px-4 py-2 text-gray-100 border-r border-slate-700">Total</td>
              <td className={`px-3 py-2 text-right tabular-nums border-r border-slate-700 ${colourCodeValues ? netColour(totals.actual) : 'text-white'}`}>{formatZAR(totals.actual)}</td>
              {months.map(mon => {
                const val = totals[mon] ?? 0;
                return <td key={mon} className={`px-3 py-2 text-right tabular-nums ${colourCodeValues ? netColour(val) : 'text-white'}`}>{formatZAR(val)}</td>;
              })}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// 🟢 WORKING: Project COS/Rev Forecast — summary table + detailed monthly view
export default function ProjectFin() {
  const { data, isLoading, error } = useProjectFinData();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        <InlineSpinner size="md" className="mr-2" />
        Loading Project Fin data&hellip;
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

  const fin = data?.data;
  if (!fin) return null;

  const { months, projects, cos, revenue, net, totals } = fin;

  return (
    <ReportTabLayout
      tableContent={<ProjectFinTable fin={fin} />}
      chartsContent={
        <div className="bg-slate-900 rounded-lg overflow-hidden border border-slate-700 text-sm">
          <div className="bg-yellow-400 px-4 py-2">
            <span className="font-bold text-slate-900 text-sm tracking-wide">Project COS/Rev &mdash; Forecast</span>
          </div>
          <div className="space-y-0 divide-y divide-slate-700">
            <SectionTable title="Project COS" projects={projects} months={months} data={cos} totals={totals.cos} headerBg="bg-slate-800" />
            <SectionTable title="Project Revenue" projects={projects} months={months} data={revenue} totals={totals.revenue} headerBg="bg-slate-800" />
            <SectionTable title="Project Net" projects={projects} months={months} data={net} totals={totals.net} colourCodeValues headerBg="bg-emerald-900" />
          </div>
          <div className="px-4 py-2 bg-slate-800 border-t border-slate-700 text-xs text-gray-500 flex items-center justify-between">
            <span>Source: Shareholder Model &mdash; Project_Fin worksheet (live)</span>
            <span>{projects.length} projects &middot; {months.length} months</span>
          </div>
        </div>
      }
    />
  );
}
