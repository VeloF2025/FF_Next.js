/**
 * Safety-file HTML generator (§7.5) — the assembled document must contain the
 * appointment letters and embed their captured (drawn) signatures, and must
 * escape untrusted text.
 */

import { describe, it, expect } from 'vitest';
import { generateSafetyFileHtml } from '../../../templates/health-safety/safety-file-template';
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

describe('generateSafetyFileHtml', () => {
  const base = {
    projectName: 'Lawley', generatedAt: '2026-07-24T00:00:00Z',
    summary: { training: 3, toolbox: 2, ppe: 5, permits: 1, audits: 4 },
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

  it('escapes untrusted text to prevent HTML injection', () => {
    const html = generateSafetyFileHtml({ ...base, letters: [letter({ appointee_name: '<script>x</script>' })] });
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders a summary tile per compliance domain', () => {
    const html = generateSafetyFileHtml({ ...base, letters: [] });
    expect(html).toContain('Training');
    expect(html).toContain('Toolbox talks');
    expect(html).toContain('No appointment letters');
  });
});
