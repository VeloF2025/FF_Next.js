/**
 * CashflowTable — PBI-style pivot matrix for Cashflow Overview.
 *
 * Layout matches the Excel design:
 *   ROWS    = Cash In | Cash Out | Cash Movement | Closing Balance
 *   COLUMNS = FY26 | FY27 | FY28 (placeholders) | Mar-25 ... Feb-26 (monthly)
 *
 * Closing Balance = cumulative running sum of Cash Movement.
 */
'use client';

import { PBI, fZAR, fZARCompact, KpiRow } from '../pbi';
import type { CashflowDataPoint } from '../revenue-overview/useRevenueData';

interface Props {
  rows: CashflowDataPoint[];
}

const TH = 'px-3 py-2.5 text-xs font-bold text-white uppercase tracking-wide whitespace-nowrap text-right';
const TH_L = 'px-4 py-2.5 text-xs font-bold text-white uppercase tracking-wide whitespace-nowrap text-left';
const TD = 'px-3 py-2 text-right tabular-nums text-sm whitespace-nowrap';
const TD_L = 'px-4 py-2 text-left text-sm font-medium whitespace-nowrap';

function cellColor(v: number | null) {
  if (v === null || v === 0) return PBI.textMuted;
  return v < 0 ? PBI.negative : PBI.textPrimary;
}

export function CashflowTable({ rows }: Props) {
  // Compute closing balances (cumulative running Net)
  let running = 0;
  const closingBalances = rows.map((r) => {
    running += r.net;
    return running;
  });

  // KPI summary
  const totalIn  = rows.reduce((s, r) => s + r.cashIn, 0);
  const totalOut = rows.reduce((s, r) => s + r.cashOut, 0);
  const totalNet = rows.reduce((s, r) => s + r.net, 0);
  const finalBalance = closingBalances[closingBalances.length - 1] ?? 0;

  // FY placeholder columns — dashes for now
  const fyColumns: { label: string }[] = [
    { label: 'FY 26' },
    { label: 'FY 27' },
    { label: 'FY 28' },
  ];

  // Row definitions
  const dataRows: {
    label: string;
    values: (number | null)[];
    isBalance?: boolean;
    isMovement?: boolean;
  }[] = [
    {
      label: 'Cash In',
      values: rows.map((r) => r.cashIn),
    },
    {
      label: 'Cash Out',
      values: rows.map((r) => -Math.abs(r.cashOut)), // show as negative
    },
    {
      label: 'Cash Movement',
      values: rows.map((r) => r.net),
      isMovement: true,
    },
    {
      label: 'Closing Balance',
      values: closingBalances,
      isBalance: true,
    },
  ];

  return (
    <div className="space-y-4">
      {/* KPI cards */}
      <KpiRow cards={[
        { label: 'Total Cash In',    value: fZARCompact(totalIn),  trend: 'positive' },
        { label: 'Total Cash Out',   value: fZARCompact(Math.abs(totalOut)), trend: 'negative' },
        { label: 'Net Movement',     value: fZARCompact(totalNet), trend: totalNet >= 0 ? 'positive' : 'negative' },
        { label: 'Closing Balance',  value: fZARCompact(finalBalance), trend: finalBalance >= 0 ? 'positive' : 'negative' },
      ]} />

      {/* Pivot table: rows = items, columns = FY placeholders + months */}
      <div className="overflow-x-auto rounded-lg border" style={{ borderColor: PBI.border }}>
        <table className="text-sm border-collapse" style={{ minWidth: '100%' }}>
          <thead>
            <tr style={{ backgroundColor: PBI.header }}>
              {/* Row label header */}
              <th className={TH_L} style={{ minWidth: 160 }}>Cash In / Out</th>

              {/* FY placeholder columns */}
              {fyColumns.map((fy) => (
                <th key={fy.label} className={TH} style={{ minWidth: 90, opacity: 0.6 }}>{fy.label}</th>
              ))}

              {/* Monthly columns */}
              {rows.map((r) => (
                <th key={r.label} className={TH} style={{ minWidth: 110 }}>{r.label}</th>
              ))}
            </tr>
          </thead>

          <tbody>
            {dataRows.map((row, ri) => {
              const isBalance = row.isBalance;
              const isMovement = row.isMovement;

              const rowBg = isBalance
                ? 'rgba(17,141,255,0.08)'        // subtle blue tint for closing balance
                : ri % 2 === 0 ? 'transparent' : PBI.rowAlt;

              const borderStyle = isBalance
                ? `2px solid ${PBI.primary}`     // PBI-blue border around closing balance row
                : undefined;

              return (
                <tr
                  key={row.label}
                  style={{
                    backgroundColor: rowBg,
                    outline: isBalance ? `1px solid ${PBI.primary}` : undefined,
                  }}
                >
                  {/* Row label */}
                  <td
                    className={`${TD_L} ${isBalance ? 'font-bold' : ''}`}
                    style={{
                      color: isBalance ? PBI.primary : PBI.textPrimary,
                      borderLeft: isBalance ? `3px solid ${PBI.primary}` : undefined,
                    }}
                  >
                    {row.label}
                  </td>

                  {/* FY placeholder cells */}
                  {fyColumns.map((fy) => (
                    <td
                      key={fy.label}
                      className={TD}
                      style={{ color: PBI.textMuted, opacity: 0.5 }}
                    >
                      —
                    </td>
                  ))}

                  {/* Monthly values */}
                  {row.values.map((v, ci) => {
                    const color = isBalance
                      ? (v !== null && v < 0 ? PBI.negative : PBI.primary)
                      : (isMovement
                          ? (v !== null && v < 0 ? PBI.negative : PBI.positive)
                          : cellColor(v));

                    return (
                      <td
                        key={ci}
                        className={`${TD} ${isBalance ? 'font-bold' : ''}`}
                        style={{ color }}
                      >
                        {v === null || v === 0 ? '—' : fZAR(v)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>

          {/* Totals footer */}
          <tfoot>
            <tr style={{ backgroundColor: PBI.header }} className="border-t-2">
              <td className={`${TD_L} font-bold text-white`}>Total</td>
              {fyColumns.map((fy) => (
                <td key={fy.label} className={`${TD} text-white opacity-50`}>—</td>
              ))}
              {rows.map((r, ci) => {
                const colNet = r.net;
                return (
                  <td
                    key={ci}
                    className={`${TD} font-bold`}
                    style={{ color: colNet < 0 ? PBI.negative : PBI.positive }}
                  >
                    {fZAR(colNet)}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
