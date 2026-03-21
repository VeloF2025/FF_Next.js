/**
 * ProjectRevenueTable — Data grid for the Project Revenue report.
 * Columns: Project | FC Activations | Annual Revenue (R)
 * Note: Homes Passed and Uptake% are not in the current API response;
 * showing what is available. Can be extended when API adds those fields.
 */
'use client';

import type { ProjectRevenuePoint } from '../project-revenue/useProjectRevenueData';

function fZAR(v: number) {
  const abs = Math.abs(Math.round(v));
  const s = abs.toLocaleString('en-ZA').replace(/,/g, '\u00a0');
  return `R\u00a0${s}`;
}

function fNum(v: number) {
  return Math.round(v).toLocaleString('en-ZA').replace(/,/g, '\u00a0');
}

interface Props {
  rows: ProjectRevenuePoint[];
}

export function ProjectRevenueTable({ rows }: Props) {
  const totalActivations = rows.reduce((s, r) => s + r.fcActivation, 0);

  const th = 'px-4 py-2.5 text-left text-xs font-bold text-white uppercase tracking-wide whitespace-nowrap';
  const thR = `${th} text-right`;

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-700">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr style={{ backgroundColor: '#1a3a4a' }}>
            <th className={th} style={{ minWidth: 180 }}>Project</th>
            <th className={thR}>FC Activations</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.project} className={i % 2 === 0 ? 'bg-gray-900' : 'bg-gray-800/60'}>
              <td className="px-4 py-2 text-gray-200 font-medium">{r.project}</td>
              <td className="px-4 py-2 text-right tabular-nums text-gray-300">{fNum(r.fcActivation)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-500 font-bold" style={{ backgroundColor: '#1a3a4a' }}>
            <td className="px-4 py-2.5 text-white">Total</td>
            <td className="px-4 py-2.5 text-right tabular-nums text-white">{fNum(totalActivations)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
