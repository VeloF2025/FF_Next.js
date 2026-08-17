import { describe, expect, it } from 'vitest';
import { resolveIncidentOpenedNotification } from '../types';
import type { IncidentRule } from '../types';

const criticalSourceRule: IncidentRule = {
  id: 'rule-1', incidentType: 'accident_sos', version: 1,
  effectiveFrom: '2026-08-18T08:00:00.000Z', effectiveTo: null, enabled: true,
  createsIncident: true, severity: 'critical', immediateNotification: true,
  channels: { inApp: true, email: true, whatsapp: false }, includeInMorningSummary: false,
  acknowledgementTargetMinutes: 5, reminderIntervalMinutes: 15, maximumEscalationLevel: 3,
  evidenceRequiredOutcomes: [],
};

const routineHighRule: IncidentRule = {
  ...criticalSourceRule,
  id: 'rule-2',
  incidentType: 'late',
  severity: 'high',
};

describe('incident notification channel plan', () => {
  it('requires WhatsApp only for critical explicit-source incidents', () => {
    expect(resolveIncidentOpenedNotification(criticalSourceRule, 'source_event')).toEqual({
      channels: { in_app: true, email: true, whatsapp: true },
      mandatoryChannels: ['whatsapp'],
    });
    expect(resolveIncidentOpenedNotification(criticalSourceRule, 'scheduled_detection')).toEqual({
      channels: { in_app: true, email: true, whatsapp: false },
      mandatoryChannels: [],
    });
    expect(resolveIncidentOpenedNotification(routineHighRule, 'scheduled_detection')).toEqual({
      channels: { in_app: true, email: true, whatsapp: false },
      mandatoryChannels: [],
    });
  });
});
