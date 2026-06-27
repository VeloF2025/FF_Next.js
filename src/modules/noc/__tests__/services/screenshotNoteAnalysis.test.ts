import { describe, it, expect } from 'vitest';
import {
  parseInstallScreenshotResponse,
  composeNoteBody,
  buildInstallScreenshotPrompt,
  type InstallScreenshotAnalysis,
  type TicketCrossRef,
} from '@/modules/noc/services/screenshotNoteAnalysis';

describe('parseInstallScreenshotResponse', () => {
  it('parses JSON wrapped in <think> tags and ```json fences', () => {
    const raw =
      '<think>looking</think>\n```json\n{"is_1map_screenshot":true,"dr_number":"DR1746579",' +
      '"status":"Pole Permission: Approved","status_interpretation":"still pole permission",' +
      '"photos":{"total":8,"uploaded":0,"missing":["Photo of the Dome"]},"serial":"ALCLB491D094",' +
      '"pole":"LAW.P.B799","pon":"92","site":"LAW",' +
      '"mismatches":["Ticket expects Home Installation but 1map shows Pole Permission"],' +
      '"summary":"No photos uploaded; still pole permission.","confidence":"high"}\n```';
    const a = parseInstallScreenshotResponse(raw);
    expect(a.is_1map_screenshot).toBe(true);
    expect(a.dr_number).toBe('DR1746579');
    expect(a.photos).toEqual({ total: 8, uploaded: 0, missing: ['Photo of the Dome'] });
    expect(a.confidence).toBe('high');
  });

  it('throws when no JSON object is present', () => {
    expect(() => parseInstallScreenshotResponse('no json here')).toThrow();
  });

  it('defaults confidence to low and is_1map to false on a sparse object', () => {
    const a = parseInstallScreenshotResponse('{"summary":"x","confidence":"banana"}');
    expect(a.confidence).toBe('low');
    expect(a.is_1map_screenshot).toBe(false);
    expect(a.photos).toBeNull();
    expect(a.mismatches).toEqual([]);
  });
});

describe('composeNoteBody', () => {
  const ctx: TicketCrossRef = { dr_number: 'DR1746579', pole_number: 'LAW.P.B799', pon_number: '92', ont_serial: null };
  const base: InstallScreenshotAnalysis = {
    is_1map_screenshot: true, dr_number: 'DR1746579', status: 'Pole Permission: Approved',
    status_interpretation: 'still pole permission',
    photos: { total: 8, uploaded: 0, missing: ['Photo of the Dome'] },
    serial: 'ALCLB491D094', pole: 'LAW.P.B799', pon: '92', site: 'LAW',
    mismatches: ['Ticket expects Home Installation but 1map shows Pole Permission'],
    summary: 'No photos uploaded; drop still at Pole Permission.', confidence: 'high',
  };

  it('includes marker, summary, photo count, status, DR match, mismatch and confidence', () => {
    const body = composeNoteBody(base, ctx);
    expect(body).toContain('🤖 AI screenshot analysis');
    expect(body).toContain('No photos uploaded; drop still at Pole Permission.');
    expect(body).toContain('Photos: 0/8 uploaded');
    expect(body).toContain('Status: Pole Permission: Approved');
    expect(body).toContain('DR: DR1746579 ✓ matches ticket');
    expect(body).toContain('⚠ Ticket expects Home Installation');
    expect(body).toContain('(confidence: high)');
  });

  it('flags a DR mismatch against the ticket', () => {
    const body = composeNoteBody({ ...base, dr_number: 'DR9999999', mismatches: [] }, ctx);
    expect(body).toContain('✗ ticket DR is DR1746579');
  });

  it('omits the 1map checks block for non-1map screenshots', () => {
    const body = composeNoteBody({ ...base, is_1map_screenshot: false }, ctx);
    expect(body).not.toContain('Photos:');
    expect(body).toContain('(confidence: high)');
  });
});

describe('buildInstallScreenshotPrompt', () => {
  it('embeds the ticket cross-reference details and the schema keys', () => {
    const p = buildInstallScreenshotPrompt({ dr_number: 'DR1746579', pole_number: 'LAW.P.B799', pon_number: '92', ont_serial: null });
    expect(p).toContain('DR1746579');
    expect(p).toContain('LAW.P.B799');
    expect(p).toContain('is_1map_screenshot');
    expect(p).toContain('"missing"');
  });
});
