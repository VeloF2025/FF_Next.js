/**
 * CosBreakdown — COS Expenses from Data tab (col D == COS)
 * Tiered: Category → Category T2, pivoted by month
 * Filter dropdowns: Business Unit (T1) + Project (T2)
 * 🟢 WORKING
 */
'use client';

import { useState } from 'react';
import { Loader2, AlertCircle, ChevronRight, ChevronDown } from 'lucide-react';
import { ReportTabLayout } from '../ReportTabLayout';
import { useCosBreakdownData } from './useCosBreakdownData';
import type { CosBreakdownCategory } from './useCosBreakdownData';

const HEADER_BG = '#1a3a4a';

function fZAR(v: number): string {
  if (!v) return '—';
  const abs = Math.abs(Math.round(v));
  if (abs >= 1_000_000) return `R ${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `R ${Math.round(v / 1_000)}K`;
  return `R ${abs.toLocaleString()}`;
}

const FilterBar = ({
  businessUnits, projects,
  selectedBU, selectedProj,
  onBU, onProj,
}: {
  businessUnits: string[]; projects: string[];
  selectedBU: string; selectedProj: string;
  onBU: (v: string) => void; onProj: (v: string) => void;
}) => (
  <div className="flex flex-wrap gap-3 mb-4">
    <div className="flex items-center gap-2">
      <label className="text-xs text-gray-400 whitespace-nowrap">Business Unit</label>
      <select
        value={selectedBU}
        onChange={e => { onBU(e.target.value); onProj(''); }}
        className="bg-gray-700 text-gray-200 text-sm rounded px-2 py-1 border border-gray-600 focus:outline-none"
      >
        <option value="">All</option>
        {businessUnits.map(bu => <option key={bu} value={bu}>{bu}</option>)}
      </select>
    </div>
    <div className="flex items-center gap-2">
      <label className="text-xs text-gray-400 whitespace-nowrap">Project</label>
      <select
        value={selectedProj}
        onChange={e => onProj(e.target.value)}
        className="bg-gray-700 text-gray-200 text-sm rounded px-2 py-1 border border-gray-600 focus:outline-none"
      >
        <option value="">All</option>
        {projects.map(p => <option key={p} value={p}>{p}</option>)}
      </select>
    </div>
    {(selectedBU || selectedProj) && (
      <button onClick={() => { onBU(''); onProj(''); }}
        className="text-xs text-blue-400 hover:text-blue-300 px-2 py-1 rounded border border-gray-600">
        Clear filters
      </button>
    )}
  </div>
);

const PivotTable = ({
  categories, months, totals,
}: {
  categories: CosBreakdownCategory[];
  months: string[];
  totals: { fy26: number; fy27: number; monthly: Record<string, number> };
}) => {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (cat: string) => setExpanded(p => { const n = new Set(p); n.has(cat) ? n.delete(cat) : n.add(cat); return n; });

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" style={{ minWidth: months.length * 88 + 380 }}>
        <thead>
          <tr style={{ backgroundColor: HEADER_BG }} className="text-white">
            <th className="px-3 py-2 text-left font-semibold sticky left-0" style={{ minWidth: 220, backgroundColor: HEADER_BG }}>Category</th>
            <th className="px-3 py-2 text-right font-semibold border-l border-gray-600" style={{ minWidth: 100 }}>FY26</th>
            <th className="px-3 py-2 text-right font-semibold" style={{ minWidth: 100 }}>FY27</th>
            {months.map(m => (
              <th key={m} className="px-2 py-2 text-right font-semibold text-xs border-l border-gray-700" style={{ minWidth: 88 }}>{m}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {categories.map((cat, ci) => {
            const isExp = expanded.has(cat.category);
            return (
              <>
                {/* Category row */}
                <tr key={cat.category} className={ci % 2 === 0 ? 'bg-gray-800' : 'bg-gray-750'}>
                  <td className="px-3 py-2 sticky left-0 bg-inherit">
                    {cat.rows.length > 1 ? (
                      <button onClick={() => toggle(cat.category)} className="flex items-center gap-1 text-white font-semibold hover:text-blue-400">
                        {isExp ? <ChevronDown className="w-4 h-4 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 flex-shrink-0" />}
                        {cat.category}
                      </button>
                    ) : (
                      <span className="text-white font-semibold pl-5">{cat.category}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-white font-semibold border-l border-gray-600">{fZAR(cat.fy26)}</td>
                  <td className="px-3 py-2 text-right text-white font-semibold">{fZAR(cat.fy27)}</td>
                  {months.map(m => (
                    <td key={m} className="px-2 py-2 text-right text-gray-300 text-xs border-l border-gray-700">{fZAR(cat.monthly[m] ?? 0)}</td>
                  ))}
                </tr>
                {/* Category T2 sub-rows */}
                {isExp && cat.rows.map(sub => (
                  <tr key={`${cat.category}|${sub.categoryT2}`} className="bg-gray-900">
                    <td className="px-3 py-1.5 pl-9 text-gray-400 text-xs sticky left-0 bg-gray-900">{sub.categoryT2}</td>
                    <td className="px-3 py-1.5 text-right text-gray-400 text-xs border-l border-gray-600">{fZAR(sub.fy26)}</td>
                    <td className="px-3 py-1.5 text-right text-gray-400 text-xs">{fZAR(sub.fy27)}</td>
                    {months.map(m => (
                      <td key={m} className="px-2 py-1.5 text-right text-gray-500 text-xs border-l border-gray-700">{fZAR(sub.monthly[m] ?? 0)}</td>
                    ))}
                  </tr>
                ))}
              </>
            );
          })}
          {/* Totals */}
          <tr className="bg-gray-900 text-white font-semibold border-t-2 border-gray-600">
            <td className="px-3 py-2 sticky left-0 bg-gray-900">Total</td>
            <td className="px-3 py-2 text-right border-l border-gray-600">{fZAR(totals.fy26)}</td>
            <td className="px-3 py-2 text-right">{fZAR(totals.fy27)}</td>
            {months.map(m => (
              <td key={m} className="px-2 py-2 text-right text-xs border-l border-gray-700">{fZAR(totals.monthly[m] ?? 0)}</td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
};

export default function CosBreakdown() {
  const [selectedBU, setSelectedBU] = useState('');
  const [selectedProj, setSelectedProj] = useState('');

  // Load unfiltered first for dropdown options
  const { data: allData } = useCosBreakdownData('', '');
  const { data, isLoading, error } = useCosBreakdownData(selectedBU, selectedProj);

  if (isLoading) return (
    <div className="flex items-center justify-center h-64 text-gray-400">
      <Loader2 className="w-6 h-6 animate-spin mr-2" />Loading COS breakdown…
    </div>
  );

  if (error) return (
    <div className="flex items-center gap-2 text-red-400 p-4">
      <AlertCircle className="w-5 h-5 flex-shrink-0" /><span>{error.message}</span>
    </div>
  );

  if (!data) return null;

  const tableContent = (
    <div>
      <FilterBar
        businessUnits={allData?.businessUnits ?? []}
        projects={allData?.projects ?? []}
        selectedBU={selectedBU}
        selectedProj={selectedProj}
        onBU={setSelectedBU}
        onProj={setSelectedProj}
      />
      <PivotTable categories={data.categories} months={data.months} totals={data.totals} />
    </div>
  );

  return (
    <ReportTabLayout
      tableContent={tableContent}
      chartsContent={<div className="text-gray-400 text-sm p-4">Charts coming soon</div>}
    />
  );
}
