/**
 * Safety-file HTML generator (§7.5) — the assembled document must contain the
 * appointment letters and embed their captured (drawn) signatures, and must
 * escape untrusted text.
 */

import { describe, it, expect } from 'vitest';
import {
  generateSafetyFileHtml,
  type SafetyFileContractorDocument,
  type SafetyFileRiskEntry,
} from '../../../templates/health-safety/safety-file-template';
import type { AppointmentLetter } from '../types/appointment.types';

function letter(overrides: Partial<AppointmentLetter>): AppointmentLetter {
  return {
    id: 'l1', letter_type: 's16_2', reference_number: 'APPT-20260724-001',
    project_id: 'p1', contractor_id: null, appointer_name: 'CEO', appointer_designation: null,
    appointee_name: 'Jane Doe', appointee_designation: 'Site Manager', scope: 'duties',
    appointment_date: '2026-07-24', effective_from: null, status: 'signed',
    signature_image: 'data:image/png;base64,ABC123', signature_name: 'Jane Doe',
    signed_at: '2026-07-24T09:00:00Z', signed_by: 'u1', signed_ip: '1.2.3.4',
    notes: null, created_at: '', updated_at: '',
    ...overrides,
  };
}

function contractorDoc(overrides: Partial<SafetyFileContractorDocument>): SafetyFileContractorDocument {
  return {
    id: 'd1', company_name: 'Acme Contracting', document_type: 'liability_insurance',
    status: 'valid', issue_date: '2026-01-01', expiry_date: '2026-12-31',
    ...overrides,
  };
}

function riskEntry(overrides: Partial<SafetyFileRiskEntry>): SafetyFileRiskEntry {
  return {
    id: 'r1', hazard_description: 'Trenching near live cables', risk_category: 'electrical',
    likelihood: 4, severity: 5, risk_score: 20, risk_level: 'extreme',
    residual_risk_score: 6, residual_risk_level: 'medium',
    existing_controls: 'Cable locator scan before digging', review_date: '2026-08-01',
    status: 'active',
    ...overrides,
  };
}

describe('generateSafetyFileHtml', () => {
  const base = {
    projectName: 'Lawley', generatedAt: '2026-07-24T00:00:00Z',
    summary: { training: 3, toolbox: 2, ppe: 5, permits: 1, audits: 4 },
    contractorDocuments: [] as SafetyFileContractorDocument[],
    riskRegister: [] as SafetyFileRiskEntry[],
  };

  it('embeds each signed letter and its signature image', () => {
    const html = generateSafetyFileHtml({ ...base, letters: [letter({})] });
    expect(html).toContain('APPT-20260724-001');
    expect(html).toContain('Section 16(2) Appointment');
    expect(html).toContain('Jane Doe');
    // the drawn signature is rendered as an <img> data URL
    expect(html).toContain('src="data:image/png;base64,ABC123"');
    expect(html).toContain('SIGNED');
  });

  it('shows "Not yet signed" for a draft letter', () => {
    const html = generateSafetyFileHtml({ ...base, letters: [letter({ status: 'draft', signature_image: null })] });
    expect(html).toContain('Not yet signed');
    expect(html).not.toContain('base64');
  });

  it('escapes untrusted text in every interpolated field', () => {
    const html = generateSafetyFileHtml({
      ...base,
      projectName: '<img onerror=alert(1)>',
      letters: [letter({
        appointee_name: '<script>x</script>',
        scope: '</section><script>evil()</script>',
        appointer_name: '"><b>bold</b>',
        reference_number: 'APPT-<svg>',
      })],
      contractorDocuments: [contractorDoc({
        company_name: '<script>doc()</script>',
        document_type: '"><i>italic</i>',
      })],
      riskRegister: [riskEntry({
        hazard_description: '<script>risk()</script>',
        existing_controls: '"><u>underline</u>',
      })],
    });
    // No raw injected markup survives anywhere in the document.
    expect(html).not.toContain('<script>x</script>');
    expect(html).not.toContain('<script>evil()</script>');
    expect(html).not.toContain('<img onerror');
    expect(html).not.toContain('<b>bold</b>');
    expect(html).not.toContain('APPT-<svg>');
    expect(html).not.toContain('<script>doc()</script>');
    expect(html).not.toContain('<i>italic</i>');
    expect(html).not.toContain('<script>risk()</script>');
    expect(html).not.toContain('<u>underline</u>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders a summary tile per compliance domain', () => {
    const html = generateSafetyFileHtml({ ...base, letters: [] });
    expect(html).toContain('Training');
    expect(html).toContain('Toolbox talks');
    expect(html).toContain('No appointment letters');
  });

  it('renders the contractor documents register with type label and status', () => {
    const html = generateSafetyFileHtml({
      ...base,
      letters: [],
      contractorDocuments: [contractorDoc({})],
    });
    expect(html).toContain('Contractor Compliance Documents');
    expect(html).toContain('Acme Contracting');
    expect(html).toContain('Liability Insurance'); // DOCUMENT_TYPES label, not the raw enum value
    expect(html).toContain('VALID');
    expect(html).toContain('2026-01-01');
    expect(html).toContain('2026-12-31');
  });

  it('shows an empty state when no contractor documents exist', () => {
    const html = generateSafetyFileHtml({ ...base, letters: [] });
    expect(html).toContain('No contractor documents on file for this project.');
  });

  it('escapes an unmapped document_type exactly once (document_type is an unconstrained VARCHAR, not a closed enum)', () => {
    const html = generateSafetyFileHtml({
      ...base,
      letters: [],
      contractorDocuments: [contractorDoc({ document_type: 'Health & Safety <Legacy>' })],
    });
    // Correct single-escape: "&" -> "&amp;", "<"/">" -> "&lt;"/"&gt;".
    expect(html).toContain('Health &amp; Safety &lt;Legacy&gt;');
    // A double-escape bug would re-escape the already-escaped "&amp;" into "&amp;amp;".
    expect(html).not.toContain('&amp;amp;');
    expect(html).not.toContain('&amp;lt;');
  });

  it('renders the risk register with category label, risk pill, and residual risk', () => {
    const html = generateSafetyFileHtml({
      ...base,
      letters: [],
      riskRegister: [riskEntry({})],
    });
    expect(html).toContain('Risk Register');
    expect(html).toContain('Trenching near live cables');
    expect(html).toContain('Electrical'); // RISK_CATEGORIES label, not the raw enum value
    expect(html).toContain('risk-extreme');
    expect(html).toContain('Extreme (20)');
    expect(html).toContain('risk-medium');
    expect(html).toContain('Medium (6)');
    expect(html).toContain('Cable locator scan before digging');
  });

  it('shows an empty state when no risk register entries exist', () => {
    const html = generateSafetyFileHtml({ ...base, letters: [] });
    expect(html).toContain('No risk assessments on file for this project.');
  });

  it('includes contractor-document and risk-register counts in the cover summary', () => {
    const html = generateSafetyFileHtml({
      ...base,
      letters: [],
      contractorDocuments: [contractorDoc({}), contractorDoc({ id: 'd2' })],
      riskRegister: [riskEntry({})],
    });
    expect(html).toContain('Contractor Documents');
    expect(html).toContain('Risk Entries');
  });
});
