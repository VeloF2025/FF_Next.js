/**
 * BOQSpendKPICards — KPI summary cards + date filters + export for BOQ Spend Summary.
 */

import { Calendar, Download } from 'lucide-react';

interface Totals {
  boqValue: number;
  totalOrdered: number;
  confirmedSpend: number;
  remainingBudget: number;
}

function fmtZAR(n: number) {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    maximumFractionDigits: 0,
  }).format(n);
}

interface Props {
  totals: Totals;
  projectCount: number;
  overallOrdPct: number;
  overallConfPct: number;
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
  onExport: () => void;
}

export function BOQSpendKPICards({
  totals, projectCount, overallOrdPct, overallConfPct,
  dateFrom, dateTo, onDateFromChange, onDateToChange, onExport,
}: Props) {
  return (
    <>
      {/* Date Filters & Export */}
      <div className="flex items-center gap-3 flex-wrap">
        <fieldset className="flex items-center gap-2 border-0 p-0">
          <legend className="sr-only">Filter by date range</legend>
          <Calendar className="h-4 w-4 text-[var(--ff-text-tertiary)]" aria-hidden="true" />
          <label htmlFor="dateFrom" className="sr-only">Start date</label>
          <input
            id="dateFrom"
            type="date"
            value={dateFrom}
            onChange={(e) => onDateFromChange(e.target.value)}
            className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded px-2 py-1.5 text-xs text-[var(--ff-text-primary)]"
            placeholder="From"
          />
          <span className="text-xs text-[var(--ff-text-tertiary)]" aria-hidden="true">to</span>
          <label htmlFor="dateTo" className="sr-only">End date</label>
          <input
            id="dateTo"
            type="date"
            value={dateTo}
            onChange={(e) => onDateToChange(e.target.value)}
            className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded px-2 py-1.5 text-xs text-[var(--ff-text-primary)]"
            placeholder="To"
          />
          {(dateFrom || dateTo) && (
            <button
              onClick={() => { onDateFromChange(''); onDateToChange(''); }}
              className="text-xs text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)] underline"
              aria-label="Clear date filters"
            >
              Clear
            </button>
          )}
        </fieldset>
        <div className="ml-auto">
          <button
            onClick={onExport}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded hover:bg-[var(--ff-bg-hover)] text-[var(--ff-text-secondary)] transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
          <p className="text-xs text-[var(--ff-text-tertiary)] uppercase tracking-wide mb-1">Total BOQ Budget</p>
          <p className="text-xl font-bold text-[var(--ff-text-primary)]">{fmtZAR(totals.boqValue)}</p>
          <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">{projectCount} projects</p>
        </div>
        <div className="bg-[var(--ff-bg-secondary)] border border-purple-500/30 rounded-lg p-4">
          <p className="text-xs text-[var(--ff-text-tertiary)] uppercase tracking-wide mb-1">Total Ordered</p>
          <p className="text-xl font-bold text-purple-400">{fmtZAR(totals.totalOrdered)}</p>
          <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">{overallOrdPct}% of budget</p>
        </div>
        <div className="bg-[var(--ff-bg-secondary)] border border-green-500/30 rounded-lg p-4">
          <p className="text-xs text-[var(--ff-text-tertiary)] uppercase tracking-wide mb-1">Confirmed Spend</p>
          <p className="text-xl font-bold text-green-400">{fmtZAR(totals.confirmedSpend)}</p>
          <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">{overallConfPct}% of budget</p>
        </div>
        <div className="bg-[var(--ff-bg-secondary)] border border-amber-500/30 rounded-lg p-4">
          <p className="text-xs text-[var(--ff-text-tertiary)] uppercase tracking-wide mb-1">Remaining Budget</p>
          <p className="text-xl font-bold text-amber-400">{fmtZAR(totals.remainingBudget)}</p>
          <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
            {totals.boqValue > 0 ? Math.round((totals.remainingBudget / totals.boqValue) * 100) : 0}% unallocated
          </p>
        </div>
      </div>
    </>
  );
}
