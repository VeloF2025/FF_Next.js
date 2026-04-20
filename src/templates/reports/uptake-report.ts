/**
 * Uptake Report — maps uptake domain data onto the universal ReportData shape.
 *
 * Consumed by /api/reports/uptake/pdf (puppeteer render) and /reports/uptake
 * (in-app iframe preview).
 */
import type { ReportData, ReportBarRow, ReportTableRow, ReportAccent } from './report-template';

export interface UptakePonRow {
  pon: string;            // display label e.g. "PON-L-001"
  drops: number;
  active: number;
}

export interface UptakeReportInput {
  projectName: string;
  periodLabel: string;        // "01 Apr – 20 Apr 2026"
  reportId: string;
  generatedBy: string;
  generatedAt: string;        // ISO
  companyName: string;
  logoUrl?: string;
  targetPct: number;          // e.g. 65
  pons: UptakePonRow[];
}

const DEFAULT_CONFIDENTIALITY =
  'CONFIDENTIAL. This report contains proprietary information of VelocityFibre and may not be distributed without prior written consent.';

function statusFor(uptakePct: number, target: number): { variant: 'good' | 'warning' | 'bad'; text: string } {
  if (uptakePct >= target) return { variant: 'good', text: 'On Track' };
  if (uptakePct >= target * 0.8) return { variant: 'warning', text: 'At Risk' };
  return { variant: 'bad', text: 'Critical' };
}

function accentFor(uptakePct: number, target: number): ReportAccent {
  if (uptakePct >= target) return 'emerald';
  if (uptakePct >= target * 0.8) return 'amber';
  return 'rose';
}

export function buildUptakeReport(input: UptakeReportInput): ReportData {
  const totalDrops = input.pons.reduce((s, p) => s + p.drops, 0);
  const totalActive = input.pons.reduce((s, p) => s + p.active, 0);
  const uptakePct = totalDrops > 0 ? (totalActive / totalDrops) * 100 : 0;
  const remaining = totalDrops - totalActive;
  const gap = uptakePct - input.targetPct;

  const chartRows: ReportBarRow[] = [...input.pons]
    .map((p) => {
      const pct = p.drops > 0 ? (p.active / p.drops) * 100 : 0;
      return {
        label: p.pon,
        value: pct,
        max: 100,
        display: `${pct.toFixed(1)}%`,
        accent: accentFor(pct, input.targetPct),
      };
    })
    .sort((a, b) => b.value - a.value);

  const tableRows: ReportTableRow[] = [...input.pons]
    .map((p) => {
      const pct = p.drops > 0 ? (p.active / p.drops) * 100 : 0;
      const status = statusFor(pct, input.targetPct);
      return {
        pon: p.pon,
        drops: p.drops.toLocaleString('en-ZA'),
        active: p.active.toLocaleString('en-ZA'),
        uptake: `${pct.toFixed(1)}%`,
        status: { kind: 'pill' as const, variant: status.variant, text: status.text },
      };
    })
    .sort((a, b) => parseFloat(String(b.uptake)) - parseFloat(String(a.uptake)));

  return {
    title: 'Project Uptake Report',
    subtitle: `${input.projectName} · ${input.periodLabel}`,
    reportId: input.reportId,
    dateRange: input.periodLabel,
    generatedBy: input.generatedBy,
    generatedAt: input.generatedAt,
    companyName: input.companyName,
    logoUrl: input.logoUrl,

    kpis: [
      {
        label: 'Total Drops',
        value: totalDrops.toLocaleString('en-ZA'),
        sublabel: `${input.pons.length} PON${input.pons.length === 1 ? '' : 's'}`,
        accent: 'slate',
      },
      {
        label: 'Activated',
        value: totalActive.toLocaleString('en-ZA'),
        sublabel: `Remaining: ${remaining.toLocaleString('en-ZA')}`,
        accent: 'emerald',
      },
      {
        label: 'Uptake %',
        value: `${uptakePct.toFixed(1)}%`,
        sublabel: `${gap >= 0 ? '+' : ''}${gap.toFixed(1)} pts vs target`,
        accent: uptakePct >= input.targetPct ? 'emerald' : uptakePct >= input.targetPct * 0.8 ? 'amber' : 'rose',
      },
      {
        label: 'Target',
        value: `${input.targetPct.toFixed(0)}%`,
        sublabel: 'Project goal',
        accent: 'blue',
      },
    ],

    chart: {
      title: 'Uptake per PON',
      target: { value: input.targetPct, label: `${input.targetPct}% Target` },
      rows: chartRows,
      unit: 'percent',
    },

    table: {
      title: 'PON Status Overview',
      columns: [
        { key: 'pon', label: 'PON', align: 'left', width: '30%' },
        { key: 'drops', label: 'Drops', align: 'right', width: '15%' },
        { key: 'active', label: 'Active', align: 'right', width: '15%' },
        { key: 'uptake', label: 'Uptake %', align: 'right', width: '15%' },
        { key: 'status', label: 'Status', align: 'left', width: '25%' },
      ],
      rows: tableRows,
    },

    footer: {
      signatureLabel: 'Project Manager Approval',
      confidentiality: DEFAULT_CONFIDENTIALITY,
    },
  };
}
