/**
 * Universal Report Template — reusable across any FibreFlow report.
 *
 * Feed `ReportData` from any domain (snags, uptake, km driven, GPS audit,
 * procurement etc.) and get back a self-contained, print-safe HTML string
 * ready for puppeteer → PDF or direct iframe rendering.
 *
 * Design: FibreFlow dark slate + emerald accents, A4 portrait, single page
 * by default. Second+ table pages wrap naturally.
 */
import { formatDisplayDateLong } from '@/utils/dateFormat';

// ── Public schema ────────────────────────────────────────────────────────────

export type ReportAccent = 'emerald' | 'blue' | 'amber' | 'rose' | 'slate';

export interface ReportKPI {
  label: string;
  value: string;
  sublabel?: string;
  accent?: ReportAccent;
}

export interface ReportBarRow {
  label: string;
  value: number;
  max: number;
  display: string;
  accent?: ReportAccent;
}

export interface ReportPill {
  kind: 'pill';
  variant: 'good' | 'warning' | 'bad' | 'neutral';
  text: string;
}

export type ReportCell = string | number | ReportPill;

export interface ReportTableColumn {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  width?: string;
}

export interface ReportTableRow {
  [key: string]: ReportCell;
}

export interface ReportData {
  title: string;
  subtitle?: string;
  reportId: string;
  dateRange: string;
  generatedBy: string;
  generatedAt: string;

  companyName: string;
  logoUrl?: string;

  kpis: ReportKPI[];

  chart?: {
    title: string;
    target?: { value: number; label: string };
    rows: ReportBarRow[];
    unit: 'percent' | 'number';
  };

  table?: {
    title: string;
    columns: ReportTableColumn[];
    rows: ReportTableRow[];
  };

  footer: {
    signatureLabel?: string;
    signatureName?: string;
    confidentiality?: string;
  };
}

// ── Rendering ────────────────────────────────────────────────────────────────

const ACCENT_HEX: Record<ReportAccent, string> = {
  emerald: '#10B981',
  blue: '#3B82F6',
  amber: '#F59E0B',
  rose: '#F43F5E',
  slate: '#94A3B8',
};

const PILL_STYLE: Record<ReportPill['variant'], { bg: string; fg: string; dot: string }> = {
  good: { bg: 'rgba(16,185,129,0.15)', fg: '#10B981', dot: '#10B981' },
  warning: { bg: 'rgba(245,158,11,0.15)', fg: '#F59E0B', dot: '#F59E0B' },
  bad: { bg: 'rgba(244,63,94,0.15)', fg: '#F43F5E', dot: '#F43F5E' },
  neutral: { bg: 'rgba(148,163,184,0.15)', fg: '#94A3B8', dot: '#94A3B8' },
};

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderCell(cell: ReportCell): string {
  if (cell && typeof cell === 'object' && 'kind' in cell && cell.kind === 'pill') {
    const style = PILL_STYLE[cell.variant];
    return `<span class="pill" style="background:${style.bg};color:${style.fg};">
      <span class="pill-dot" style="background:${style.dot};"></span>${esc(cell.text)}
    </span>`;
  }
  return esc(cell);
}

function renderKpis(kpis: ReportKPI[]): string {
  if (!kpis.length) return '';
  const cards = kpis
    .map((k) => {
      const accent = ACCENT_HEX[k.accent ?? 'emerald'];
      return `
        <div class="kpi">
          <div class="kpi-label">${esc(k.label)}</div>
          <div class="kpi-value" style="color:${accent};">${esc(k.value)}</div>
          ${k.sublabel ? `<div class="kpi-sub">${esc(k.sublabel)}</div>` : ''}
        </div>`;
    })
    .join('');
  return `<section class="kpi-strip" style="grid-template-columns:repeat(${kpis.length},1fr);">${cards}</section>`;
}

function renderChart(chart: NonNullable<ReportData['chart']>): string {
  const maxScale = Math.max(...chart.rows.map((r) => r.max), 1);
  const targetPct = chart.target ? Math.min(100, (chart.target.value / maxScale) * 100) : null;

  const bars = chart.rows
    .map((row) => {
      const pct = Math.min(100, Math.max(0, (row.value / row.max) * 100));
      const color = ACCENT_HEX[row.accent ?? 'emerald'];
      return `
        <div class="bar-row">
          <div class="bar-label">${esc(row.label)}</div>
          <div class="bar-track">
            <div class="bar-fill" style="width:${pct.toFixed(1)}%;background:${color};"></div>
            ${targetPct !== null ? `<div class="bar-target" style="left:${targetPct.toFixed(1)}%;"></div>` : ''}
          </div>
          <div class="bar-value">${esc(row.display)}</div>
        </div>`;
    })
    .join('');

  const legend = chart.target
    ? `<div class="chart-legend"><span class="target-mark"></span>${esc(chart.target.label)}</div>`
    : '';

  return `
    <section class="chart-card">
      <div class="card-head">
        <h3>${esc(chart.title)}</h3>
        ${legend}
      </div>
      <div class="bars">${bars}</div>
    </section>`;
}

function renderTable(table: NonNullable<ReportData['table']>): string {
  const cols = table.columns;
  const header = cols
    .map((c) => {
      const align = c.align ?? 'left';
      const width = c.width ? `style="width:${c.width};"` : '';
      return `<th class="al-${align}" ${width}>${esc(c.label)}</th>`;
    })
    .join('');

  const body = table.rows
    .map((row) => {
      const tds = cols
        .map((c) => {
          const align = c.align ?? 'left';
          return `<td class="al-${align}">${renderCell(row[c.key] ?? '')}</td>`;
        })
        .join('');
      return `<tr>${tds}</tr>`;
    })
    .join('');

  return `
    <section class="table-card">
      <div class="card-head"><h3>${esc(table.title)}</h3></div>
      <table class="report-table">
        <thead><tr>${header}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </section>`;
}

export function generateReportHtml(data: ReportData): string {
  const generatedAtLabel = formatDisplayDateLong(data.generatedAt, data.generatedAt);
  const logo = data.logoUrl
    ? `<img src="${esc(data.logoUrl)}" alt="${esc(data.companyName)}" class="logo-img"/>`
    : `<div class="logo-mark">${esc(data.companyName.slice(0, 2).toUpperCase())}</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${esc(data.title)} — ${esc(data.reportId)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg: #0F172A;
      --surface: #1E293B;
      --surface-2: #273449;
      --border: #334155;
      --text: #E2E8F0;
      --text-dim: #94A3B8;
      --text-faint: #64748B;
      --emerald: #10B981;
      --accent-band: #0B1220;
    }
    @page { size: A4; margin: 0; }
    html, body { background: var(--bg); }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 10pt; color: var(--text); line-height: 1.45;
      padding: 14mm 14mm 12mm 14mm;
    }

    /* ── Header band ───────────────────────────────────────────────── */
    .header {
      display: grid; grid-template-columns: auto 1fr auto;
      align-items: center; gap: 16px;
      background: var(--accent-band);
      padding: 12px 18px;
      border-radius: 10px;
      border: 1px solid var(--border);
      border-left: 4px solid var(--emerald);
      margin-bottom: 18px;
    }
    .logo-mark {
      width: 40px; height: 40px; border-radius: 8px;
      background: var(--emerald); color: #062C22;
      font-weight: 800; font-size: 14pt;
      display: flex; align-items: center; justify-content: center;
      letter-spacing: -0.5px;
    }
    .logo-img { height: 40px; width: auto; }
    .header .brand {
      display: flex; flex-direction: column; gap: 2px;
    }
    .brand-name { font-weight: 700; font-size: 12pt; letter-spacing: -0.2px; }
    .brand-product { color: var(--text-dim); font-size: 8.5pt; text-transform: uppercase; letter-spacing: 1.2px; }
    .header-meta { text-align: right; font-size: 8.5pt; color: var(--text-dim); line-height: 1.6; }
    .header-meta strong { color: var(--text); font-weight: 600; }

    /* ── Title block ───────────────────────────────────────────────── */
    .title-block { margin-bottom: 14px; }
    .title-block h1 {
      font-size: 22pt; font-weight: 700; letter-spacing: -0.6px; color: var(--text);
    }
    .title-block .subtitle { color: var(--text-dim); font-size: 10.5pt; margin-top: 2px; }

    /* ── KPI strip ─────────────────────────────────────────────────── */
    .kpi-strip {
      display: grid; gap: 10px; margin-bottom: 14px;
    }
    .kpi {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 12px 14px;
    }
    .kpi-label {
      font-size: 7.5pt; text-transform: uppercase; letter-spacing: 1px;
      color: var(--text-dim); font-weight: 600; margin-bottom: 4px;
    }
    .kpi-value { font-size: 20pt; font-weight: 700; letter-spacing: -0.8px; }
    .kpi-sub { font-size: 8.5pt; color: var(--text-faint); margin-top: 3px; }

    /* ── Card shell (chart + table) ────────────────────────────────── */
    .chart-card, .table-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 14px 16px;
      margin-bottom: 12px;
    }
    .card-head {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 12px;
    }
    .card-head h3 {
      font-size: 10.5pt; font-weight: 700; color: var(--text);
      letter-spacing: -0.2px;
    }
    .chart-legend {
      font-size: 8pt; color: var(--text-dim);
      display: flex; align-items: center; gap: 6px;
    }
    .target-mark {
      display: inline-block; width: 14px; height: 0;
      border-top: 1.5px dashed var(--text-dim);
    }

    /* ── Bar chart ─────────────────────────────────────────────────── */
    .bars { display: grid; gap: 6px; }
    .bar-row {
      display: grid; grid-template-columns: 90px 1fr 60px;
      align-items: center; gap: 10px;
      font-size: 9pt;
    }
    .bar-label { color: var(--text-dim); font-weight: 500; }
    .bar-track {
      position: relative;
      height: 16px;
      background: var(--surface-2);
      border-radius: 4px;
      overflow: visible;
    }
    .bar-fill {
      height: 100%;
      border-radius: 4px;
      background: var(--emerald);
    }
    .bar-target {
      position: absolute; top: -3px; bottom: -3px;
      width: 0;
      border-left: 1.5px dashed #CBD5E1;
    }
    .bar-value { text-align: right; font-weight: 600; color: var(--text); }

    /* ── Table ─────────────────────────────────────────────────────── */
    .report-table {
      width: 100%; border-collapse: collapse; font-size: 9pt;
    }
    .report-table thead th {
      text-align: left; font-size: 7.5pt; font-weight: 600;
      text-transform: uppercase; letter-spacing: 1px;
      color: var(--text-dim);
      padding: 8px 10px;
      border-bottom: 1px solid var(--border);
    }
    .report-table tbody td {
      padding: 7px 10px;
      border-bottom: 1px solid rgba(51,65,85,0.4);
      color: var(--text);
    }
    .report-table tbody tr:nth-child(even) td { background: rgba(30,41,59,0.4); }
    .al-left { text-align: left; }
    .al-right { text-align: right; }
    .al-center { text-align: center; }

    .pill {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 2px 10px; border-radius: 999px;
      font-size: 8pt; font-weight: 600;
      letter-spacing: 0.2px;
    }
    .pill-dot { width: 6px; height: 6px; border-radius: 50%; }

    /* ── Footer ────────────────────────────────────────────────────── */
    .footer {
      margin-top: 18px;
      padding-top: 10px;
      border-top: 1px solid var(--border);
      display: grid; grid-template-columns: 1.2fr 1fr 1fr;
      gap: 16px;
      font-size: 7.5pt; color: var(--text-faint);
      line-height: 1.6;
    }
    .sig-line {
      border-bottom: 1px solid var(--border);
      padding-bottom: 2px;
      margin-bottom: 4px;
      min-height: 16px;
      color: var(--text);
      font-weight: 600;
    }
    .sig-label { text-transform: uppercase; letter-spacing: 1px; font-size: 7pt; }
    .confidential { font-style: italic; }
    .page-num { text-align: right; font-weight: 600; }

    /* Puppeteer-friendly print nudges */
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <header class="header">
    ${logo}
    <div class="brand">
      <div class="brand-name">${esc(data.companyName)}</div>
      <div class="brand-product">FibreFlow · Report</div>
    </div>
    <div class="header-meta">
      <div><strong>${esc(data.dateRange)}</strong></div>
      <div>Generated ${esc(generatedAtLabel)}</div>
      <div>ID: <strong>${esc(data.reportId)}</strong></div>
    </div>
  </header>

  <section class="title-block">
    <h1>${esc(data.title)}</h1>
    ${data.subtitle ? `<div class="subtitle">${esc(data.subtitle)}</div>` : ''}
  </section>

  ${renderKpis(data.kpis)}
  ${data.chart ? renderChart(data.chart) : ''}
  ${data.table ? renderTable(data.table) : ''}

  <footer class="footer">
    <div>
      <div class="sig-label">${esc(data.footer.signatureLabel ?? 'Approved by')}</div>
      <div class="sig-line">${esc(data.footer.signatureName ?? '')}</div>
      <div>Date: ________________</div>
    </div>
    <div class="confidential">${esc(data.footer.confidentiality ?? '')}</div>
    <div class="page-num">
      Generated by ${esc(data.generatedBy)}<br/>
      ${esc(data.companyName)} · FibreFlow
    </div>
  </footer>
</body>
</html>`;
}
