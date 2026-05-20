/**
 * Scoped Snag Report — HTML Renderer
 *
 * Converts SnagReportScopeRow[] → self-contained HTML via the universal
 * report template. No puppeteer, no storage, no HTTP — pure renderer.
 * All dates are ISO YYYY-MM-DD; severity renders as ReportPill.
 */

import { generateReportHtml } from '@/templates/reports/report-template';
import type {
  ReportData,
  ReportTableRow,
  ReportPill,
  ReportAccent,
} from '@/templates/reports/report-template';
import { log } from '@/lib/logger';

// ── Public types ──────────────────────────────────────────────────────────────

export interface SnagReportMeta {
  reportNumber: string;   // e.g. SCOPE-LAWL-20260520-001
  projectName: string;
  scope: 'pole' | 'pon' | 'zone';
  zones: number[];
  pons: number[];
  poles: string[];
  fromDate: string;       // ISO YYYY-MM-DD
  toDate: string;         // ISO YYYY-MM-DD
  severities: string[];
  categories: string[];
  generatedAt: string;    // ISO datetime
  generatedBy: string;    // human display name
}

export interface SnagReportScopeRow {
  id: string;
  snag_number: number;
  category: string;
  severity: 'minor' | 'major' | 'critical';
  status: string;
  description: string;
  zone_no: number | null;
  pon_no: number | null;
  pole_number: string | null;
  pole_qa_photo_id: string | null; // FK to pole_qa_photos
  slot_key: string | null;         // e.g. "civil_after"
  created_at: string;              // ISO datetime
  noc_ticket_uid: string | null;
}

// ── Column key constants ──────────────────────────────────────────────────────

const COL = {
  zone: 'zone',
  pon: 'pon',
  pole: 'pole',
  category: 'category',
  severity: 'severity',
  description: 'description',
  status: 'status',
  ticket: 'ticket',
} as const;

// ── Accent mapping ────────────────────────────────────────────────────────────

const KPI_ACCENT: Record<string, ReportAccent> = {
  total: 'emerald',
  critical: 'rose',
  major: 'amber',
  minor: 'slate',
  resolved: 'blue',
};

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Returns scope summary string, e.g. "Zone 24 · PON 265" or "Whole project". */
function scopeSummary(meta: SnagReportMeta): string {
  const parts: string[] = [];
  if (meta.zones.length) parts.push(`Zone ${meta.zones.join(', ')}`);
  if (meta.pons.length) parts.push(`PON ${meta.pons.join(', ')}`);
  if (meta.poles.length) {
    const plural = meta.poles.length > 1 ? 's' : '';
    parts.push(`Pole${plural} ${meta.poles.join(', ')}`);
  }
  return parts.join(' · ') || 'Whole project';
}

/** Past-tense subtitle per feedback_report_tense_rectification. ISO dates only. */
function pastTenseSubtitle(meta: SnagReportMeta, totalSnags: number): string {
  const summary = scopeSummary(meta);
  const snagWord = totalSnags === 1 ? 'snag' : 'snags';
  return (
    `Covered snags raised between ${meta.fromDate} and ${meta.toDate} ` +
    `across ${summary}. ` +
    `${totalSnags} ${snagWord} identified.`
  );
}

/** Maps severity to a ReportPill with correct variant. */
function severityPill(severity: 'minor' | 'major' | 'critical'): ReportPill {
  const variant: ReportPill['variant'] =
    severity === 'critical' ? 'bad' :
    severity === 'major' ? 'warning' :
    'neutral';
  return { kind: 'pill', variant, text: severity };
}

// ── Exports ───────────────────────────────────────────────────────────────────

/**
 * Renders a scoped snag report as a self-contained HTML string.
 * Ready for puppeteer → PDF in the POST route handler.
 */
export async function renderScopeSnagReportHtml(
  meta: SnagReportMeta,
  rows: SnagReportScopeRow[],
): Promise<string> {
  log.info('snagReportRenderer.start', {
    reportNumber: meta.reportNumber,
    rowCount: rows.length,
  });

  // ── KPI aggregation ────────────────────────────────────────────────────────

  const bySev = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.severity] = (acc[r.severity] ?? 0) + 1;
    return acc;
  }, {});

  const resolvedCount = rows.filter(r =>
    ['resolved', 'verified', 'closed'].includes(r.status),
  ).length;

  const resolvedPct =
    rows.length === 0 ? 0 : Math.round((resolvedCount / rows.length) * 100);

  // ── Table rows (keyed by column key) ──────────────────────────────────────

  const tableRows: ReportTableRow[] = rows.map(r => ({
    [COL.zone]: r.zone_no === null ? '' : String(r.zone_no),
    [COL.pon]: r.pon_no === null ? '' : String(r.pon_no),
    [COL.pole]: r.pole_number ?? '',
    [COL.category]: r.category,
    [COL.severity]: severityPill(r.severity),
    [COL.description]: r.description,
    [COL.status]: r.status,
    [COL.ticket]: r.noc_ticket_uid ?? '',
  }));

  // ── Assemble ReportData ────────────────────────────────────────────────────

  const data: ReportData = {
    title: `Snag Report — ${meta.projectName}`,
    subtitle: pastTenseSubtitle(meta, rows.length),
    reportId: meta.reportNumber,
    dateRange: `${meta.fromDate} → ${meta.toDate}`,
    generatedBy: meta.generatedBy,
    generatedAt: meta.generatedAt,
    companyName: 'Velocity Fibre',
    kpis: [
      { label: 'Total snags', value: String(rows.length),          accent: KPI_ACCENT.total },
      { label: 'Critical',    value: String(bySev.critical ?? 0),  accent: KPI_ACCENT.critical },
      { label: 'Major',       value: String(bySev.major ?? 0),     accent: KPI_ACCENT.major },
      { label: 'Minor',       value: String(bySev.minor ?? 0),     accent: KPI_ACCENT.minor },
      { label: 'Resolved',    value: `${resolvedPct}%`,            accent: KPI_ACCENT.resolved },
    ],
    table: {
      title: 'Snags',
      columns: [
        { key: COL.zone,        label: 'Zone',        align: 'center', width: '48px' },
        { key: COL.pon,         label: 'PON',         align: 'center', width: '48px' },
        { key: COL.pole,        label: 'Pole',        align: 'left',   width: '100px' },
        { key: COL.category,    label: 'Category',    align: 'left' },
        { key: COL.severity,    label: 'Severity',    align: 'center', width: '80px' },
        { key: COL.description, label: 'Description', align: 'left' },
        { key: COL.status,      label: 'Status',      align: 'left',   width: '72px' },
        { key: COL.ticket,      label: 'Ticket',      align: 'left',   width: '100px' },
      ],
      rows: tableRows,
    },
    footer: {
      signatureLabel: 'Auditor',
      signatureName: meta.generatedBy,
      confidentiality: 'Velocity Fibre internal — not for external distribution',
    },
  };

  return generateReportHtml(data);
}
