/**
 * ProjectDetailTable — COS sub-category breakdown per project.
 * Columns: Project | COS AdHoc | COS Casuals | COS Fuel | COS Overheads |
 *          COS Stock | COS SubContractor | COS Wayleaves | COS Total
 *
 * Since project-detail API is per-project (slicer), this component
 * shows all COS categories for the selected project in a vertical layout.
 */
'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { ProjectDetailData } from '../project-detail/useProjectDetailData';
import { useProjectDetailData } from '../project-detail/useProjectDetailData';

const COS_CATEGORIES = [
  'COS - Ad Hoc',
  'COS - Casuals',
  'COS - Fuel',
  'COS - Overheads',
  'COS - Sales',
  'COS - Stock',
  'COS - Sub-Contractor',
  'COS - Wayleaves',
] as const;

function fZAR(v: number) {
  if (v === 0) return '—';
  const abs = Math.abs(Math.round(v));
  const s = abs.toLocaleString('en-ZA').replace(/,/g, '\u00a0');
  return `${v < 0 ? '-' : ''}R\u00a0${s}`;
}

function fNum(v: number) {
  if (v === 0) return '—';
  return Math.round(Math.abs(v)).toLocaleString('en-ZA').replace(/,/g, '\u00a0');
}

function DataTable({ detail }: { detail: ProjectDetailData }) {
  const th = 'px-4 py-2.5 text-xs font-bold text-white uppercase tracking-wide whitespace-nowrap';
  const thR = `${th} text-right`;

  return (
    <div className="space-y-4">
      {/* COS Breakdown */}
      <div className="overflow-x-auto rounded-lg border border-gray-700">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr style={{ backgroundColor: '#1a3a4a' }}>
              <th className={`${th} text-left`} style={{ minWidth: 200 }}>COS Category</th>
              <th className={thR}>Actual Total (R)</th>
            </tr>
          </thead>
          <tbody>
            {COS_CATEGORIES.map((cat, i) => {
              const row = detail.cosActual[cat];
              const val = row?.total ?? 0;
              return (
                <tr key={cat} className={i % 2 === 0 ? 'bg-gray-900' : 'bg-gray-800/60'}>
                  <td className="px-4 py-2 font-medium text-gray-200">{cat}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-300">{fZAR(val)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-500 font-bold" style={{ backgroundColor: '#1a3a4a' }}>
              <td className="px-4 py-2.5 text-white">COS Total</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-white">{fZAR(detail.cosTotal.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Summary */}
      <div className="overflow-x-auto rounded-lg border border-gray-700">
        <div style={{ backgroundColor: '#1a3a4a' }} className="px-4 py-2">
          <span className="text-xs font-bold text-white uppercase tracking-wide">Summary</span>
        </div>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-800">
              <th className={`${th} text-left text-gray-300`} style={{ minWidth: 180 }}>Metric</th>
              <th className={`${thR} text-gray-300`}>Total</th>
            </tr>
          </thead>
          <tbody>
            {[
              { label: 'Activations', val: detail.summary.activations.total, fmt: 'num' },
              { label: 'Revenue', val: detail.summary.revenue.total, fmt: 'zar' },
              { label: 'Gross', val: detail.summary.gross.total, fmt: 'zar' },
              { label: 'Net (cumulative)', val: detail.summary.net.total, fmt: 'zar' },
            ].map(({ label, val, fmt }, i) => (
              <tr key={label} className={i % 2 === 0 ? 'bg-gray-900' : 'bg-gray-800/60'}>
                <td className="px-4 py-2 font-medium text-gray-200">{label}</td>
                <td className={`px-4 py-2 text-right tabular-nums ${val < 0 && fmt === 'zar' ? 'text-red-400' : 'text-gray-300'}`}>
                  {fmt === 'zar' ? fZAR(val) : fNum(val)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface Props {
  initialProject?: string;
}

export function ProjectDetailTable({ initialProject = 'Mohadin' }: Props) {
  const [project, setProject] = useState(initialProject);
  const { data, isLoading, error } = useProjectDetailData(project);

  const detail = data?.data;

  return (
    <div className="space-y-3">
      {/* Project slicer */}
      {detail && (
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-400 font-medium">Project</span>
          <div className="relative">
            <select
              value={project}
              onChange={e => setProject(e.target.value)}
              className="appearance-none bg-gray-800 border border-gray-600 text-white text-sm rounded px-3 py-1.5 pr-8 focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              {detail.availableProjects.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          </div>
          <span className="text-xs text-gray-500">{detail.months.length} months of data</span>
        </div>
      )}

      {isLoading && (
        <div className="h-32 flex items-center justify-center text-gray-500 text-sm">
          Loading…
        </div>
      )}
      {error && (
        <div className="text-red-400 text-sm px-2">{error.message}</div>
      )}
      {detail && <DataTable detail={detail} />}
    </div>
  );
}
