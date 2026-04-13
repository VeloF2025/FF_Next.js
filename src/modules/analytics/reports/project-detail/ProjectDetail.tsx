/**
 * ProjectDetail — Per-project COS breakdown + financial summary.
 * Table tab: COS categories grid + summary table (with project slicer)
 * Charts tab: original yellow-banner detailed view
 */

'use client';

import { useState } from 'react';
import { ChevronDown, AlertCircle } from 'lucide-react';
import { useProjectDetailData, type MonthlyValues } from './useProjectDetailData';
import { ReportTabLayout } from '../ReportTabLayout';
import { ProjectDetailTable } from '../tables/ProjectDetailTable';

const COS_CATEGORIES = [
  'COS - Ad Hoc', 'COS - Casuals', 'COS - Fuel', 'COS - Overheads',
  'COS - Sales', 'COS - Stock', 'COS - Sub-Contractor', 'COS - Wayleaves',
] as const;

function formatZAR(value: number): string {
  if (value === 0) return '\u2014';
  const abs = Math.abs(Math.round(value));
  const formatted = abs.toLocaleString('en-ZA').replace(/,/g, '\u00a0');
  return `${value < 0 ? '-' : ''}R\u00a0${formatted}`;
}

function formatCount(value: number): string {
  if (value === 0) return '\u2014';
  return Math.round(Math.abs(value)).toLocaleString('en-ZA').replace(/,/g, '\u00a0');
}

function negClass(value: number): string {
  return value < 0 ? 'text-red-400' : '';
}

interface TableHeaderProps { firstCol: string; months: string[]; }
function TableHeader({ firstCol, months }: TableHeaderProps) {
  return (
    <tr className="bg-[#0f1e2e] text-gray-400 text-xs uppercase tracking-wider">
      <th className="sticky left-0 z-10 bg-[#0f1e2e] text-left px-4 py-2 font-medium w-52 min-w-[13rem] border-r border-slate-700">{firstCol}</th>
      <th className="px-3 py-2 text-right font-medium w-32 min-w-[8rem] border-r border-slate-700 whitespace-nowrap">Actual</th>
      {months.map(mon => (
        <th key={mon} className="px-3 py-2 text-right font-medium w-24 min-w-[6rem] whitespace-nowrap">{mon}</th>
      ))}
    </tr>
  );
}

interface COSTableProps { project: string; months: string[]; cosActual: Record<string, MonthlyValues>; cosTotal: MonthlyValues; }
function COSTable({ project, months, cosActual, cosTotal }: COSTableProps) {
  return (
    <div className="bg-slate-900 rounded-lg overflow-hidden border border-slate-700">
      <div className="bg-[#0f1e2e] px-4 py-2.5 border-b border-slate-700">
        <span className="font-bold text-white text-sm tracking-wide">{project}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse min-w-max">
          <thead><TableHeader firstCol="Category" months={months} /></thead>
          <tbody>
            {COS_CATEGORIES.map((cat, idx) => {
              const row = cosActual[cat] ?? { total: 0, monthly: {} };
              return (
                <tr key={cat} className={idx % 2 === 0 ? 'bg-slate-900' : 'bg-slate-800/50'}>
                  <td className="sticky left-0 z-10 px-4 py-1.5 text-gray-200 border-r border-slate-700 bg-inherit whitespace-nowrap">{cat}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-gray-300 border-r border-slate-700">{formatZAR(row.total)}</td>
                  {months.map(mon => (
                    <td key={mon} className="px-3 py-1.5 text-right tabular-nums text-gray-400">{formatZAR(row.monthly[mon] ?? 0)}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-600 bg-slate-800 font-semibold">
              <td className="sticky left-0 z-10 bg-slate-800 px-4 py-2 text-gray-100 border-r border-slate-700 whitespace-nowrap">Total Cost Actual</td>
              <td className="px-3 py-2 text-right tabular-nums text-white border-r border-slate-700">{formatZAR(cosTotal.total)}</td>
              {months.map(mon => (
                <td key={mon} className="px-3 py-2 text-right tabular-nums text-white">{formatZAR(cosTotal.monthly[mon] ?? 0)}</td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

interface SummaryRowDef { label: string; values: MonthlyValues; formatter: (v: number) => string; colourCode: boolean; }
function SummaryTable({ months, rows }: { months: string[]; rows: SummaryRowDef[] }) {
  return (
    <div className="bg-slate-900 rounded-lg overflow-hidden border border-slate-700">
      <div className="bg-[#0f1e2e] px-4 py-2.5 border-b border-slate-700">
        <span className="font-bold text-white text-sm tracking-wide">Summary</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse min-w-max">
          <thead><TableHeader firstCol="Metric" months={months} /></thead>
          <tbody>
            {rows.map(({ label, values, formatter, colourCode }, idx) => (
              <tr key={label} className={idx % 2 === 0 ? 'bg-slate-900' : 'bg-slate-800/50'}>
                <td className="sticky left-0 z-10 px-4 py-1.5 text-gray-200 border-r border-slate-700 bg-inherit whitespace-nowrap">{label}</td>
                <td className={`px-3 py-1.5 text-right tabular-nums border-r border-slate-700 ${colourCode ? negClass(values.total) : 'text-gray-300'}`}>{formatter(values.total)}</td>
                {months.map(mon => {
                  const val = values.monthly[mon] ?? 0;
                  return <td key={mon} className={`px-3 py-1.5 text-right tabular-nums ${colourCode ? negClass(val) : 'text-gray-400'}`}>{formatter(val)}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-10 bg-slate-800 rounded w-72" />
      <div className="h-64 bg-slate-900 rounded-lg border border-slate-700" />
      <div className="h-36 bg-slate-900 rounded-lg border border-slate-700" />
    </div>
  );
}

// 🟢 WORKING: Project Detail — data table + detailed monthly view
export default function ProjectDetail() {
  const [project, setProject] = useState('Mohadin');
  const { data, isLoading, error } = useProjectDetailData(project);

  if (isLoading) return <LoadingSkeleton />;

  if (error) {
    return (
      <div className="flex items-center gap-2 text-red-400 p-4">
        <AlertCircle className="w-5 h-5 flex-shrink-0" />
        <span>{error.message}</span>
      </div>
    );
  }

  const detail = data?.data;
  if (!detail) return null;

  const { months, cosActual, cosTotal, summary, availableProjects } = detail;

  const summaryRows: SummaryRowDef[] = [
    { label: 'Activations',      values: summary.activations, formatter: formatCount, colourCode: false },
    { label: 'Revenue',          values: summary.revenue,     formatter: formatZAR,   colourCode: false },
    { label: 'Gross',            values: summary.gross,       formatter: formatZAR,   colourCode: true  },
    { label: 'Net (cumulative)', values: summary.net,         formatter: formatZAR,   colourCode: true  },
  ];

  const ProjectSlicer = (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-sm text-gray-400 font-medium">Project</span>
      <div className="relative">
        <select
          value={project}
          onChange={e => setProject(e.target.value)}
          className="appearance-none bg-gray-800 border border-gray-600 text-white text-sm rounded px-3 py-1.5 pr-8 focus:outline-none focus:ring-2 focus:ring-teal-500"
        >
          {availableProjects.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
      </div>
    </div>
  );

  return (
    <ReportTabLayout
      tableContent={
        <div>
          {ProjectSlicer}
          <ProjectDetailTable />
        </div>
      }
      chartsContent={
        <div className="space-y-3">
          <div className="bg-yellow-400 rounded-lg px-4 py-3 flex items-center justify-between">
            <span className="font-bold text-slate-900 text-xl tracking-wide">{project}</span>
            <div className="relative flex items-center gap-2">
              <label className="text-slate-700 text-sm font-medium">Project</label>
              <select
                value={project}
                onChange={e => setProject(e.target.value)}
                className="appearance-none bg-white border border-yellow-600 text-slate-900 text-sm rounded px-3 py-1.5 pr-8 font-medium focus:outline-none focus:ring-2 focus:ring-yellow-700"
              >
                {availableProjects.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
            </div>
          </div>
          <COSTable project={project} months={months} cosActual={cosActual} cosTotal={cosTotal} />
          <SummaryTable months={months} rows={summaryRows} />
          <div className="px-3 py-1.5 bg-slate-800 rounded border border-slate-700 text-xs text-gray-500">
            Source: Data tab (COS actuals) + FT_Invoice tab (revenue) &middot; {months.length} months
          </div>
        </div>
      }
    />
  );
}
