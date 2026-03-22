// 🟢 WORKING: Income Statement / P&L table component
'use client';

import type { IncomeStatementData, IncomeStatementRow } from '../income-statement/useIncomeStatementData';

interface Props {
  data: IncomeStatementData;
}

function fZAR(value: number): { text: string; negative: boolean } {
  if (value === 0) return { text: '—', negative: false };
  const negative = value < 0;
  const abs = Math.abs(Math.round(value));
  const formatted = abs.toLocaleString('en-ZA').replace(/,/g, '\u00a0');
  return { text: `R\u00a0${formatted}`, negative };
}

function Cell({ value, align = 'right' }: { value: number; align?: 'left' | 'right' }) {
  const { text, negative } = fZAR(value);
  return (
    <td
      className={`px-3 py-1.5 text-xs whitespace-nowrap ${align === 'right' ? 'text-right' : 'text-left'} ${negative ? 'text-red-400' : 'text-gray-200'}`}
    >
      {text}
    </td>
  );
}

function RowEl({ row, months }: { row: IncomeStatementRow; months: string[] }) {
  if (row.isHeader) {
    return (
      <tr style={{ backgroundColor: '#1a3a4a' }}>
        <td
          colSpan={4 + months.length}
          className="px-3 py-2 text-xs font-bold text-white uppercase tracking-wider"
        >
          {row.label}
        </td>
      </tr>
    );
  }

  const labelClass = row.isTotal
    ? 'font-bold border-t border-gray-600'
    : row.isBold
    ? 'font-semibold'
    : row.isIndented
    ? 'pl-6 text-gray-400'
    : '';

  return (
    <tr className="border-b border-gray-800 hover:bg-gray-750">
      <td className={`px-3 py-1.5 text-xs text-gray-200 whitespace-nowrap ${labelClass}`} style={{ minWidth: 220 }}>{row.label}</td>
      <Cell value={row.fy26} />
      <Cell value={row.fy27} />
      <Cell value={row.fy28} />
      {months.map((m) => (
        <Cell key={m} value={row.monthly[m] ?? 0} />
      ))}
    </tr>
  );
}

export function IncomeStatementTable({ data }: Props) {
  const { rows, months } = data;

  return (
    <div className="overflow-x-auto rounded border border-gray-700">
      <table className="min-w-full text-xs">
        <thead>
          <tr style={{ backgroundColor: '#1a3a4a' }}>
            <th className="px-3 py-2 text-left text-xs font-bold text-white whitespace-nowrap sticky left-0 bg-inherit z-10" style={{ minWidth: 220 }}>
              Label
            </th>
            <th className="px-3 py-2 text-right text-xs font-bold text-white whitespace-nowrap">FY26</th>
            <th className="px-3 py-2 text-right text-xs font-bold text-white whitespace-nowrap">FY27</th>
            <th className="px-3 py-2 text-right text-xs font-bold text-white whitespace-nowrap">FY28</th>
            {months.map((m) => (
              <th key={m} className="px-3 py-2 text-right text-xs font-bold text-white whitespace-nowrap">
                {m}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <RowEl key={`${row.label}-${i}`} row={row} months={months} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
