/**
 * ProjectFinTable — Summary data grid for Project COS/Rev Forecast.
 * Columns: Project | Revenue | COS Total | Gross Profit | GP% | Cost/Home
 * Uses the "actual" column from each section as the summary value.
 */
'use client';

import type { ProjectFinData } from '../project-fin/useProjectFinData';

function fZAR(v: number) {
  if (v === 0) return '—';
  const abs = Math.abs(Math.round(v));
  const s = abs.toLocaleString('en-ZA').replace(/,/g, '\u00a0');
  return `${v < 0 ? '-' : ''}R\u00a0${s}`;
}

function fPct(v: number) {
  return `${(v * 100).toFixed(1)}%`;
}

interface Props {
  fin: ProjectFinData;
}

export function ProjectFinTable({ fin }: Props) {
  const { projects, cos, revenue, totals } = fin;

  const th = 'px-4 py-2.5 text-xs font-bold text-white uppercase tracking-wide whitespace-nowrap';
  const thR = `${th} text-right`;

  const rows = projects.map(p => {
    const rev = revenue[p]?.actual ?? 0;
    const cosVal = cos[p]?.actual ?? 0;
    const gross = rev - cosVal;
    const gpPct = rev !== 0 ? gross / rev : 0;
    return { project: p, rev, cosVal, gross, gpPct };
  });

  const totalRev = totals.revenue.actual;
  const totalCos = totals.cos.actual;
  const totalGross = totalRev - totalCos;
  const totalGpPct = totalRev !== 0 ? totalGross / totalRev : 0;

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-700">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr style={{ backgroundColor: '#1a3a4a' }}>
            <th className={`${th} text-left`} style={{ minWidth: 180 }}>Project</th>
            <th className={thR}>Revenue (R)</th>
            <th className={thR}>COS Total (R)</th>
            <th className={thR}>Gross Profit (R)</th>
            <th className={thR}>GP %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.project} className={i % 2 === 0 ? 'bg-gray-900' : 'bg-gray-800/60'}>
              <td className="px-4 py-2 font-medium text-gray-200">{r.project}</td>
              <td className="px-4 py-2 text-right tabular-nums text-gray-300">{fZAR(r.rev)}</td>
              <td className="px-4 py-2 text-right tabular-nums text-gray-300">{fZAR(r.cosVal)}</td>
              <td className={`px-4 py-2 text-right tabular-nums font-semibold ${r.gross < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                {fZAR(r.gross)}
              </td>
              <td className={`px-4 py-2 text-right tabular-nums ${r.gpPct < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                {fPct(r.gpPct)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-500 font-bold" style={{ backgroundColor: '#1a3a4a' }}>
            <td className="px-4 py-2.5 text-white">Total</td>
            <td className="px-4 py-2.5 text-right tabular-nums text-white">{fZAR(totalRev)}</td>
            <td className="px-4 py-2.5 text-right tabular-nums text-white">{fZAR(totalCos)}</td>
            <td className={`px-4 py-2.5 text-right tabular-nums ${totalGross < 0 ? 'text-red-300' : 'text-emerald-300'}`}>
              {fZAR(totalGross)}
            </td>
            <td className={`px-4 py-2.5 text-right tabular-nums ${totalGpPct < 0 ? 'text-red-300' : 'text-emerald-300'}`}>
              {fPct(totalGpPct)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
