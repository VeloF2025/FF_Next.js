/**
 * Build Milestone Overview Report
 * RFO (Civil Work Complete) + ATP per project
 * Table + Clustered Bar Chart
 * 🟢 WORKING
 */

'use client';

import { useMemo, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
  LabelList,
} from 'recharts';
import { ReportTabLayout } from '../components/ReportTabLayout';
import { useBuildMilestonesData } from './useBuildMilestonesData';
import type { BuildMilestoneRow } from '@/app/api/analytics/reports/build-milestones/route';

const ProgressBar = ({ percent }: { percent: number }) => {
  let bgColor = '#22c55e'; // green
  if (percent < 50) bgColor = '#ef4444'; // red
  else if (percent < 80) bgColor = '#eab308'; // yellow

  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-shrink-0 w-16">
        <div className="relative h-4 bg-gray-700 rounded overflow-hidden">
          <div style={{ width: `${percent}%`, backgroundColor: bgColor }} className="h-full transition-all" />
        </div>
      </div>
      <span className="font-semibold" style={{ color: bgColor }}>
        {percent.toFixed(1)}%
      </span>
    </div>
  );
};

const MilestonesTable = ({ rows, totals }: { rows: BuildMilestoneRow[]; totals: any }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-sm">
      <thead className="bg-gray-900 text-white sticky top-0">
        <tr>
          <th className="px-3 py-2 text-left font-semibold">Project</th>
          <th className="px-3 py-2 text-right font-semibold">RFO Complete</th>
          <th className="px-3 py-2 text-right font-semibold">RFO Total</th>
          <th className="px-3 py-2 text-center font-semibold">RFO %</th>
          <th className="px-3 py-2 text-right font-semibold">ATP Passed</th>
          <th className="px-3 py-2 text-right font-semibold">ATP Total</th>
          <th className="px-3 py-2 text-center font-semibold">ATP %</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => (
          <tr key={row.projectId} className={idx % 2 === 0 ? 'bg-gray-800' : 'bg-gray-750'}>
            <td className="px-3 py-2 text-white font-medium">{row.projectName}</td>
            <td className="px-3 py-2 text-right text-gray-300">{row.rfoComplete.toLocaleString()}</td>
            <td className="px-3 py-2 text-right text-gray-300">{row.rfoTotal.toLocaleString()}</td>
            <td className="px-3 py-2">
              <ProgressBar percent={row.rfoPct} />
            </td>
            <td className="px-3 py-2 text-right text-gray-300">{row.atpPassed.toLocaleString()}</td>
            <td className="px-3 py-2 text-right text-gray-300">{row.atpTotal.toLocaleString()}</td>
            <td className="px-3 py-2">
              <ProgressBar percent={row.atpPct} />
            </td>
          </tr>
        ))}
        <tr className="bg-gray-900 text-white font-semibold border-t border-gray-700">
          <td className="px-3 py-2">Total</td>
          <td className="px-3 py-2 text-right">{totals.rfoComplete.toLocaleString()}</td>
          <td className="px-3 py-2 text-right">{totals.rfoTotal.toLocaleString()}</td>
          <td className="px-3 py-2">
            <ProgressBar percent={totals.rfoPct} />
          </td>
          <td className="px-3 py-2 text-right">{totals.atpPassed.toLocaleString()}</td>
          <td className="px-3 py-2 text-right">{totals.atpTotal.toLocaleString()}</td>
          <td className="px-3 py-2">
            <ProgressBar percent={totals.atpPct} />
          </td>
        </tr>
      </tbody>
    </table>
  </div>
);

interface ChartEntry {
  projectName: string;
  RFO: number;
  ATP: number;
}

const MilestonesChart = ({ rows }: { rows: BuildMilestoneRow[] }) => {
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());

  const chartData: ChartEntry[] = useMemo(() => {
    return rows.map((row) => ({
      projectName: row.projectName.length > 12 ? row.projectName.substring(0, 12) : row.projectName,
      RFO: hiddenSeries.has('RFO') ? 0 : row.rfoComplete,
      ATP: hiddenSeries.has('ATP') ? 0 : row.atpPassed,
    }));
  }, [rows, hiddenSeries]);

  return (
    <div className="space-y-4">
      <ResponsiveContainer width="100%" height={320}>
        <BarChart data={chartData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis dataKey="projectName" tick={{ fill: '#d1d5db', fontSize: 12 }} />
          <YAxis tick={{ fill: '#d1d5db', fontSize: 12 }} />
          <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', color: '#fff' }} />
          <Legend
            onClick={(e) => {
              const series = e.dataKey as string;
              setHiddenSeries((prev) => {
                const next = new Set(prev);
                if (next.has(series)) next.delete(series);
                else next.add(series);
                return next;
              });
            }}
            wrapperStyle={{ cursor: 'pointer' }}
          />
          <Bar dataKey="RFO" fill="#3b82f6" isAnimationActive={false} barCategoryGap="20%">
            <LabelList dataKey="RFO" position="top" fill="#3b82f6" fontSize={12} />
          </Bar>
          <Bar dataKey="ATP" fill="#22c55e" isAnimationActive={false} barCategoryGap="20%">
            <LabelList dataKey="ATP" position="top" fill="#22c55e" fontSize={12} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default function BuildMilestonesReport() {
  const { data, isLoading, error } = useBuildMilestonesData();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <span className="text-gray-400">Loading...</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center h-48">
        <span className="text-red-400">Error loading report</span>
      </div>
    );
  }

  return (
    <ReportTabLayout
      tableContent={<MilestonesTable rows={data.rows} totals={data.totals} />}
      chartsContent={<MilestonesChart rows={data.rows} />}
    />
  );
}
