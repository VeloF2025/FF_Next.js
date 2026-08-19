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
    expect(resolveIncidentOpenedNotification(criticalSourceRule, 'critical', 'source_event')).toEqual({
      channels: { in_app: true, email: true, whatsapp: true },
      mandatoryChannels: ['whatsapp'],
    });
    expect(resolveIncidentOpenedNotification(criticalSourceRule, 'critical', 'scheduled_detection')).toEqual({
      channels: { in_app: true, email: true, whatsapp: false },
      mandatoryChannels: [],
    });
    expect(resolveIncidentOpenedNotification(routineHighRule, 'high', 'scheduled_detection')).toEqual({
      channels: { in_app: true, email: true, whatsapp: false },
      mandatoryChannels: [],
    });
  });

  it('honours a severity override above the rule default', () => {
    // produceIncident resolves severity as `request.severity ?? rule.severity`, so a source
    // event can raise a `high` rule to critical. Keying the decision off rule.severity
    // silently dropped the mandatory WhatsApp for exactly the incidents that need it most.
    expect(resolveIncidentOpenedNotification(routineHighRule, 'critical', 'source_event')).toEqual({
      channels: { in_app: true, email: true, whatsapp: true },
      mandatoryChannels: ['whatsapp'],
    });
  });

  it('does not let a rule default above the resolved severity force WhatsApp', () => {
    // The mirror case: a critical-by-default rule whose incident resolved to high must not
    // inherit the rule's severity and escalate a routine incident onto WhatsApp.
    expect(resolveIncidentOpenedNotification(criticalSourceRule, 'high', 'source_event')).toEqual({
      channels: { in_app: true, email: true, whatsapp: false },
      mandatoryChannels: [],
    });
  });
});
