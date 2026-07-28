/**
 * Digital safety file HTML generator (goal Phase 5, §7.5)
 *
 * Assembles a project's statutory appointment letters — each with its captured
 * (drawn) signature — plus the contractor compliance documents and risk
 * register entries linked to the project, into one self-contained HTML
 * document, rendered to a single PDF by the export endpoint's Puppeteer path
 * (the sanctioned PDF route, §4.6). No external assets at render time.
 *
 * Contractor documents and risk register entries are rendered as compact
 * register tables (one row per entry), not one page per row like the signed
 * appointment letters -- matching how these appear in the real client H&S
 * binders (a compliance register / risk register table, not per-item pages).
 */

import { letterTypeDef, type AppointmentLetter } from '@/modules/health-safety/types/appointment.types';
import { DOCUMENT_TYPES, type HSDocumentType } from '@/modules/health-safety/types/compliance.types';
import { RISK_CATEGORIES, RISK_LEVEL_CONFIG, type RiskCategory, type RiskLevel } from '@/modules/health-safety/types/risk.types';

/** Minimal shape the safety-file query selects -- not the full HSContractorDocument. */
export interface SafetyFileContractorDocument {
  id: string;
  company_name: string;
  document_type: HSDocumentType | string;
  /** hs_contractor_documents.status has no NOT NULL constraint (DEFAULT 'pending' only). */
  status: string | null;
  issue_date: string | null;
  expiry_date: string | null;
}

/** Minimal shape the safety-file query selects -- not the full RiskEntry. */
export interface SafetyFileRiskEntry {
  id: string;
  hazard_description: string;
  risk_category: RiskCategory | string;
  likelihood: number;
  severity: number;
  risk_score: number;
  risk_level: RiskLevel | string;
  residual_risk_score: number;
  residual_risk_level: RiskLevel | string;
  existing_controls: string | null;
  review_date: string | null;
  status: string;
}

export interface SafetyFileData {
  projectName: string;
  generatedAt: string;
  letters: AppointmentLetter[];
  contractorDocuments: SafetyFileContractorDocument[];
  riskRegister: SafetyFileRiskEntry[];
  /** Compliance record counts, for the cover summary. */
  summary: { training: number; toolbox: number; ppe: number; permits: number; audits: number };
}

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtDate(d: string | null): string {
  return d ? esc(String(d).slice(0, 10)) : '—';
}

function letterPage(letter: AppointmentLetter): string {
  const def = letterTypeDef(letter.letter_type);
  const signature = letter.signature_image
    ? `<img class="sig" src="${esc(letter.signature_image)}" alt="signature" />`
    : `<div class="sig-missing">Not yet signed</div>`;

  return `
  <section class="letter">
    <div class="letter-head">
      <div>
        <h2>${esc(def?.label ?? letter.letter_type)}</h2>
        <p class="statute">${esc(def?.statute ?? '')}</p>
      </div>
      <div class="ref">${esc(letter.reference_number)}</div>
    </div>

    <table class="meta">
      <tr><th>Appointee</th><td>${esc(letter.appointee_name)}${letter.appointee_designation ? ` — ${esc(letter.appointee_designation)}` : ''}</td></tr>
      <tr><th>Appointed by</th><td>${esc(letter.appointer_name ?? '—')}${letter.appointer_designation ? ` — ${esc(letter.appointer_designation)}` : ''}</td></tr>
      <tr><th>Appointment date</th><td>${fmtDate(letter.appointment_date)}</td></tr>
      <tr><th>Effective from</th><td>${fmtDate(letter.effective_from)}</td></tr>
    </table>

    <div class="scope"><h3>Scope of appointment</h3><p>${esc(letter.scope ?? '')}</p></div>

    <div class="sign-block">
      <div class="sign-col">
        <div class="sig-line">${signature}</div>
        <div class="sig-label">Signature of appointee</div>
      </div>
      <div class="sign-meta">
        ${letter.signature_name ? `<div>Signed: <strong>${esc(letter.signature_name)}</strong></div>` : ''}
        ${letter.signed_at ? `<div>Date: ${fmtDate(letter.signed_at)}</div>` : ''}
        <div class="status ${letter.status === 'signed' ? 'signed' : 'draft'}">${esc(letter.status.toUpperCase())}</div>
      </div>
    </div>
  </section>`;
}

function contractorDocumentsSection(docs: SafetyFileContractorDocument[]): string {
  if (!docs.length) {
    return `<section class="register"><h2>Contractor Compliance Documents</h2><p class="empty">No contractor documents on file for this project.</p></section>`;
  }
  const rows = docs
    .map((d) => {
      // Raw (unescaped) fallback -- esc() below is the ONE place this gets
      // escaped. Pre-escaping here too would double-escape any document_type
      // not in DOCUMENT_TYPES (the column is unconstrained VARCHAR(100), so
      // this path is reachable for legacy/unknown values).
      const typeLabel = DOCUMENT_TYPES[d.document_type as HSDocumentType]?.label ?? d.document_type;
      const status = d.status ?? 'pending';
      return `<tr>
        <td>${esc(d.company_name)}</td>
        <td>${esc(typeLabel)}</td>
        <td><span class="status ${status === 'valid' ? 'signed' : 'draft'}">${esc(status.toUpperCase())}</span></td>
        <td>${fmtDate(d.issue_date)}</td>
        <td>${fmtDate(d.expiry_date)}</td>
      </tr>`;
    })
    .join('\n');

  return `
  <section class="register">
    <h2>Contractor Compliance Documents</h2>
    <table class="reg-table">
      <thead><tr><th>Contractor</th><th>Document</th><th>Status</th><th>Issued</th><th>Expires</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`;
}

function riskRegisterSection(risks: SafetyFileRiskEntry[]): string {
  if (!risks.length) {
    return `<section class="register"><h2>Risk Register</h2><p class="empty">No risk assessments on file for this project.</p></section>`;
  }
  const rows = risks
    .map((r) => {
      // Raw (unescaped) fallbacks -- esc() at the render site below is the
      // ONE place these get escaped. Pre-escaping here too would double-
      // escape any value not in the lookup map.
      const category = RISK_CATEGORIES[r.risk_category as RiskCategory]?.label ?? r.risk_category;
      const level = r.risk_level as RiskLevel;
      const residualLevel = r.residual_risk_level as RiskLevel;
      const levelLabel = RISK_LEVEL_CONFIG[level]?.label ?? r.risk_level;
      const residualLabel = RISK_LEVEL_CONFIG[residualLevel]?.label ?? r.residual_risk_level;
      return `<tr>
        <td>${esc(r.hazard_description)}</td>
        <td>${esc(category)}</td>
        <td><span class="risk-pill risk-${esc(r.risk_level)}">${esc(levelLabel)} (${r.risk_score})</span></td>
        <td><span class="risk-pill risk-${esc(r.residual_risk_level)}">${esc(residualLabel)} (${r.residual_risk_score})</span></td>
        <td>${esc(r.existing_controls ?? '—')}</td>
        <td>${fmtDate(r.review_date)}</td>
      </tr>`;
    })
    .join('\n');

  return `
  <section class="register">
    <h2>Risk Register</h2>
    <table class="reg-table">
      <thead><tr><th>Hazard</th><th>Category</th><th>Risk</th><th>Residual risk</th><th>Existing controls</th><th>Review date</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`;
}

export function generateSafetyFileHtml(data: SafetyFileData): string {
  const { summary } = data;
  const pages = data.letters.map(letterPage).join('\n');
  const contractorDocsHtml = contractorDocumentsSection(data.contractorDocuments);
  const riskRegisterHtml = riskRegisterSection(data.riskRegister);

  return `<!doctype html><html><head><meta charset="utf-8" />
  <style>
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; margin: 0; }
    .cover { padding: 40px; border-bottom: 4px solid #059669; }
    .cover h1 { margin: 0 0 4px; font-size: 26px; }
    .cover .sub { color: #555; margin: 0; }
    .cover .summary { display: flex; gap: 24px; margin-top: 24px; flex-wrap: wrap; }
    .cover .summary div { border: 1px solid #ddd; border-radius: 8px; padding: 12px 16px; }
    .cover .summary .n { font-size: 22px; font-weight: bold; color: #059669; }
    .cover .summary .l { font-size: 12px; color: #666; text-transform: uppercase; }
    .letter { padding: 40px; page-break-before: always; }
    .letter-head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #059669; padding-bottom: 8px; }
    .letter-head h2 { margin: 0; font-size: 20px; }
    .statute { margin: 2px 0 0; color: #777; font-size: 12px; }
    .ref { font-family: monospace; color: #555; }
    table.meta { width: 100%; border-collapse: collapse; margin: 20px 0; }
    table.meta th { text-align: left; width: 180px; padding: 6px 8px; color: #555; vertical-align: top; }
    table.meta td { padding: 6px 8px; }
    .scope h3 { font-size: 14px; margin-bottom: 4px; }
    .scope p { line-height: 1.5; }
    .sign-block { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 48px; }
    .sig-line { border-bottom: 1px solid #333; width: 260px; height: 90px; display: flex; align-items: flex-end; }
    .sig { max-height: 88px; max-width: 260px; }
    .sig-missing { color: #b91c1c; font-style: italic; padding-bottom: 8px; }
    .sig-label { font-size: 12px; color: #666; margin-top: 4px; }
    .sign-meta { text-align: right; font-size: 12px; color: #444; }
    .status { display: inline-block; margin-top: 6px; padding: 2px 8px; border-radius: 4px; font-weight: bold; font-size: 11px; }
    .status.signed { background: #d1fae5; color: #065f46; }
    .status.draft { background: #fee2e2; color: #991b1b; }
    .register { padding: 40px; page-break-before: always; }
    .register h2 { margin: 0 0 16px; font-size: 20px; border-bottom: 2px solid #059669; padding-bottom: 8px; }
    .register .empty { color: #666; font-style: italic; }
    table.reg-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    table.reg-table th { text-align: left; padding: 6px 8px; background: #f3f4f6; color: #444; border-bottom: 1px solid #ddd; }
    table.reg-table td { padding: 6px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
    .risk-pill { display: inline-block; padding: 2px 8px; border-radius: 4px; font-weight: bold; font-size: 11px; white-space: nowrap; }
    .risk-low { background: #d1fae5; color: #065f46; }
    .risk-medium { background: #fef3c7; color: #92400e; }
    .risk-high { background: #ffedd5; color: #9a3412; }
    .risk-extreme { background: #fee2e2; color: #991b1b; }
  </style></head><body>
    <div class="cover">
      <h1>Health &amp; Safety File</h1>
      <p class="sub">${esc(data.projectName)} · generated ${fmtDate(data.generatedAt)}</p>
      <div class="summary">
        <div><div class="n">${summary.training}</div><div class="l">Training</div></div>
        <div><div class="n">${summary.toolbox}</div><div class="l">Toolbox talks</div></div>
        <div><div class="n">${summary.ppe}</div><div class="l">PPE issued</div></div>
        <div><div class="n">${summary.permits}</div><div class="l">Permits</div></div>
        <div><div class="n">${summary.audits}</div><div class="l">Audits</div></div>
        <div><div class="n">${data.letters.length}</div><div class="l">Appointments</div></div>
        <div><div class="n">${data.contractorDocuments.length}</div><div class="l">Contractor Documents</div></div>
        <div><div class="n">${data.riskRegister.length}</div><div class="l">Risk Entries</div></div>
      </div>
    </div>
    ${contractorDocsHtml}
    ${riskRegisterHtml}
    ${pages || '<section class="letter"><p>No appointment letters have been created for this project.</p></section>'}
  </body></html>`;
}
