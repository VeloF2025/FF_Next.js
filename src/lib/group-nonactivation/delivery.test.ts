import { describe, it, expect, vi } from 'vitest';
import type { GroupReportCounts } from './buildWorkbook';

// delivery.ts pulls in the WA bridge client, which opens a DB handle at import
// time. The caption builder itself is pure — stub the transport so it stays that
// way under test.
vi.mock('@/modules/notifications/services/whatsappDelivery', () => ({
  sendWhatsAppGroupDocument: vi.fn(),
}));

const { groupCaption } = await import('./delivery');

const BASE: GroupReportCounts = {
  cohort: 7,
  activated: 7,
  miss: 0,
  pp: 0,
  ppNew: 0,
  ppNotFound: 0,
  ppLinkedAwaiting: 0,
  ppActivated: 0,
  backlog: 0,
  typos: 0,
  olt: 0,
  oltNew: 0,
  oltNote2: 0,
  oltNote4: 0,
};

describe('group-nonactivation/delivery groupCaption — OLT block', () => {
  it('omits the OLT block entirely when nothing is open', () => {
    const caption = groupCaption('Mamelodi', 'Mamelodi', '2026-07-22', BASE);
    expect(caption).not.toContain('1Map data issues');
    expect(caption).not.toContain('OLT Mismatches');
  });

  it('reports the total, the new-yesterday count and both note breakdowns', () => {
    const caption = groupCaption('Mamelodi', 'Mamelodi', '2026-07-22', {
      ...BASE,
      olt: 36,
      oltNew: 4,
      oltNote2: 22,
      oltNote4: 14,
    });
    expect(caption).toContain('🔧 1Map data issues: 36 still open (4 raised yesterday)');
    expect(caption).toContain('*OLT Mismatches* tab');
    expect(caption).toContain('Note 2 — no entry on 1Map: 22');
    expect(caption).toContain('Note 4 — Drop# / ONT serial mismatch: 14');
  });

  it('drops the "raised yesterday" clause when the whole list is carried over', () => {
    const caption = groupCaption('Mohadin', 'Mohadin', '2026-07-22', {
      ...BASE,
      olt: 76,
      oltNew: 0,
      oltNote2: 60,
      oltNote4: 16,
    });
    expect(caption).toContain('🔧 1Map data issues: 76 still open —');
    expect(caption).not.toContain('raised yesterday');
  });

  it('omits a note line whose count is zero', () => {
    const caption = groupCaption('Etwatwa', 'Etwatwa', '2026-07-22', {
      ...BASE,
      olt: 3,
      oltNew: 1,
      oltNote2: 3,
      oltNote4: 0,
    });
    expect(caption).toContain('Note 2 — no entry on 1Map: 3');
    expect(caption).not.toContain('Note 4');
  });

  it('still signs off as Jarvis with the OLT block present', () => {
    const caption = groupCaption('Lawley', 'Lawley', '2026-07-22', {
      ...BASE,
      olt: 32,
      oltNew: 9,
      oltNote2: 18,
      oltNote4: 14,
    });
    expect(caption.trimEnd().endsWith('— Jarvis 🤖')).toBe(true);
  });
});
