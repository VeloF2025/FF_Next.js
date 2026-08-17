import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHANNEL_PREFERENCES,
  EVENT_GROUPS,
  EVENT_ICONS,
  EVENT_LABELS,
  EVENT_SEVERITY,
} from '..';

const fleetOperationalEvents = [
  'fleet.operational_incident_opened',
  'fleet.operational_incident_escalated',
  'fleet.operational_incident_resolved',
  'fleet.operational_morning_summary',
  'fleet.operational_monitor_failed',
] as const;

describe('Fleet operational notification registrations', () => {
  it.each(fleetOperationalEvents)('%s is present in every live event map', (eventType) => {
    expect(DEFAULT_CHANNEL_PREFERENCES[eventType]).toBeDefined();
    expect(EVENT_ICONS[eventType]).toBeTruthy();
    expect(EVENT_SEVERITY[eventType]).toBeTruthy();
    expect(EVENT_LABELS[eventType]).toBeTruthy();
    expect(EVENT_GROUPS[eventType]).toBe('Fleet');
  });

  it('uses mandatory channels for critical safety and monitor failures', () => {
    for (const eventType of [
      'fleet.operational_incident_escalated',
      'fleet.operational_monitor_failed',
    ]) {
      expect(DEFAULT_CHANNEL_PREFERENCES[eventType]).toEqual({
        in_app: true,
        email: true,
        whatsapp: true,
      });
    }
  });

  it('keeps routine incident and summary notifications off WhatsApp', () => {
    for (const eventType of [
      'fleet.operational_incident_opened',
      'fleet.operational_incident_resolved',
      'fleet.operational_morning_summary',
    ]) {
      expect(DEFAULT_CHANNEL_PREFERENCES[eventType]).toEqual({
        in_app: true,
        email: true,
        whatsapp: false,
      });
    }
  });
});
