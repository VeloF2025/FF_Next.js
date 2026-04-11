/**
 * Bundle processor for the weekly billing upload.
 *
 * Takes a flat list of files dropped by the user and groups them by project,
 * then parses each project's FT payment PDF, notes XLSX, and zone uptake PDFs
 * into a normalized {@link ProjectBundleResult}.
 *
 * This is the glue that lets a user drop a whole `WE<date>/` folder and get
 * one-pass ingestion for every project in it — replacing the old one-PDF,
 * one-project flow.
 */

import {
  parseFTPaymentPdf,
  parseNotesXlsx,
  type ParsedPaymentSummary,
  type ParsedDeduction,
} from './parseFTPaymentSummary';
import { parseZoneUptakePdf, type ParsedZoneUptake } from './parseZoneUptake';
import {
  resolveProjectNameAgainst,
  type BillableProject,
  type ProjectResolution,
} from './resolveProjectName';

// ─── File kind detection ────────────────────────────────────────────────────

export type BundleFileKind =
  | 'ft-payment-pdf'
  | 'notes-xlsx'
  | 'zone-uptake-pdf'
  | 'zone-pon-uptake-pdf'
  | 'unknown';

export interface BundleFile {
  originalName: string;
  filepath: string;
  mimetype?: string | null;
  size: number;
}

export interface ClassifiedFile extends BundleFile {
  kind: BundleFileKind;
  /** Raw project name extracted from the filename before DB resolution. */
  projectHint: string;
}

/**
 * Classify a single file by filename shape:
 *
 * - `<Project> WE<code>.pdf`               → ft-payment-pdf
 * - `<Project> WE<code> notes.xlsx`        → notes-xlsx
 * - `<Project>_installation uptake per zone_<code>.pdf`       → zone-uptake-pdf
 * - `<Project>_installation uptake per zone per pon_<code>.pdf` → zone-pon-uptake-pdf
 */
export function classifyFile(file: BundleFile): ClassifiedFile {
  const name = file.originalName;
  const lower = name.toLowerCase();

  if (lower.endsWith('.xlsx') && /\bnotes\b/i.test(name)) {
    return { ...file, kind: 'notes-xlsx', projectHint: extractHint(name, 'notes') };
  }
  if (lower.endsWith('.pdf') && /per\s+pon/i.test(name)) {
    return { ...file, kind: 'zone-pon-uptake-pdf', projectHint: extractHint(name, 'uptake') };
  }
  if (lower.endsWith('.pdf') && /installation\s+uptake\s+per\s+zone/i.test(name)) {
    return { ...file, kind: 'zone-uptake-pdf', projectHint: extractHint(name, 'uptake') };
  }
  if (lower.endsWith('.pdf')) {
    return { ...file, kind: 'ft-payment-pdf', projectHint: extractHint(name, 'payment') };
  }
  return { ...file, kind: 'unknown', projectHint: '' };
}

/**
 * Extract the project name hint from a filename. Strips the file type
 * marker ("WE<code>", "_installation uptake...", " notes") so the leftover
 * is the bare project label.
 */
function extractHint(filename: string, kind: 'payment' | 'notes' | 'uptake'): string {
  const base = filename.replace(/\.(pdf|xlsx)$/i, '').trim();
  if (kind === 'uptake') {
    // "Lawley_installation uptake per zone_260405" → "Lawley"
    const m = base.match(/^(.+?)_installation\s+uptake/i);
    if (m && m[1]) return m[1].trim();
  }
  if (kind === 'payment' || kind === 'notes') {
    // "Lawley WE260405", "Lawley WE260405 notes" → "Lawley"
    const m = base.match(/^(.*?)\s+WE(?:\d|\s)/i);
    if (m && m[1]) return m[1].trim();
  }
  return base;
}

// ─── Grouping ───────────────────────────────────────────────────────────────

export interface ProjectFileGroup {
  /** Canonical hint used for DB resolution (first non-empty hint wins). */
  projectHint: string;
  files: ClassifiedFile[];
}

/**
 * Group files by resolved project. Files with the same DB-resolved project
 * id are bundled together; files whose hint cannot be resolved land in their
 * own singleton group keyed by the raw hint so the UI can surface them as
 * "couldn't route".
 */
export function groupFilesByProject(
  files: ClassifiedFile[],
  billable: BillableProject[],
): ProjectFileGroup[] {
  const groups = new Map<string, ProjectFileGroup>();

  for (const f of files) {
    const resolution = resolveProjectNameAgainst(f.projectHint, billable);
    // Key by the DB project id when matched, else by normalized hint
    const key = resolution.matched && resolution.project
      ? `db:${resolution.project.id}`
      : `hint:${f.projectHint.toLowerCase()}`;
    let g = groups.get(key);
    if (!g) {
      g = { projectHint: f.projectHint, files: [] };
      groups.set(key, g);
    }
    g.files.push(f);
  }

  return [...groups.values()];
}

// ─── Per-project processing ────────────────────────────────────────────────

export interface ProjectBundleResult {
  /** The raw project hint used for resolution (first file's hint). */
  projectHint: string;
  resolution: ProjectResolution;
  /** Files this group contained (useful for UI diagnostics). */
  files: ClassifiedFile[];
  /** Parsed FT payment summary (null when no FT payment PDF in the bundle). */
  summary: ParsedPaymentSummary | null;
  /** Parsed deductions from notes XLSX (empty when absent). */
  deductions: ParsedDeduction[];
  /** Parsed zone uptake (per-zone PDF). Null when absent. */
  zoneUptake: ParsedZoneUptake | null;
  /** Parsed zone+PON uptake. Null when absent. */
  zonePonUptake: ParsedZoneUptake | null;
  /** Reconcile check result (null when FT + uptake not both present). */
  reconcile: {
    ftTotalOnts: number;
    uptakeInstalled: number;
    delta: number;
    ok: boolean;
  } | null;
  /** All parse warnings across every file in this group, plus reconcile. */
  parseWarnings: string[];
  /** Fatal error when the whole group can't be processed. */
  fatalError: string | null;
}

/** Tolerance for reconcile: uptake.installed ≈ ft.totalOnts. */
const RECONCILE_TOLERANCE = 50;

/**
 * Process one project group: parse every file, run reconcile, aggregate
 * warnings. Does NOT write to the DB — the API handler owns that.
 */
export async function processProjectGroup(
  group: ProjectFileGroup,
  readBytes: (filepath: string) => Buffer,
  billable: BillableProject[],
): Promise<ProjectBundleResult> {
  const warnings: string[] = [];
  let summary: ParsedPaymentSummary | null = null;
  let deductions: ParsedDeduction[] = [];
  let zoneUptake: ParsedZoneUptake | null = null;
  let zonePonUptake: ParsedZoneUptake | null = null;
  let fatalError: string | null = null;

  try {
    for (const file of group.files) {
      const buf = readBytes(file.filepath);
      switch (file.kind) {
        case 'ft-payment-pdf': {
          summary = await parseFTPaymentPdf(buf, file.originalName);
          warnings.push(...summary.parseWarnings);
          break;
        }
        case 'notes-xlsx': {
          const r = await parseNotesXlsx(buf);
          deductions = r.deductions;
          warnings.push(...r.parseWarnings);
          break;
        }
        case 'zone-uptake-pdf': {
          zoneUptake = await parseZoneUptakePdf(buf, file.originalName);
          warnings.push(...zoneUptake.parseWarnings);
          break;
        }
        case 'zone-pon-uptake-pdf': {
          zonePonUptake = await parseZoneUptakePdf(buf, file.originalName);
          warnings.push(...zonePonUptake.parseWarnings);
          break;
        }
        case 'unknown': {
          warnings.push(`Ignored unrecognized file: ${file.originalName}`);
          break;
        }
      }
    }
  } catch (err) {
    fatalError = err instanceof Error ? err.message : String(err);
  }

  // Resolve project against DB — prefer PDF Site over filename hint
  const rawInput = (summary?.site?.trim()) || group.projectHint || '';
  const resolution = resolveProjectNameAgainst(rawInput, billable);

  // Reconcile check: FT total ONTs ≈ uptake grand-total installed
  let reconcile: ProjectBundleResult['reconcile'] = null;
  if (summary && zoneUptake) {
    const ft = summary.totalOnts;
    const up = zoneUptake.grandTotal.installed;
    const delta = Math.abs(ft - up);
    const ok = delta <= RECONCILE_TOLERANCE;
    reconcile = { ftTotalOnts: ft, uptakeInstalled: up, delta, ok };
    if (!ok) {
      warnings.push(
        `Reconcile mismatch: FT total ONTs=${ft}, zone uptake installed=${up}, delta=${delta} (>${RECONCILE_TOLERANCE})`,
      );
    }
  }

  return {
    projectHint: group.projectHint,
    resolution,
    files: group.files,
    summary,
    deductions,
    zoneUptake,
    zonePonUptake,
    reconcile,
    parseWarnings: warnings,
    fatalError,
  };
}
