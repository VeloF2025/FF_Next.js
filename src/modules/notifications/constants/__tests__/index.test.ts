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

const fleetDriverInputEvents = [
  'fleet.driver_input_requested',
  'fleet.driver_response_received',
] as const;

// Words that would turn a neutral driver-facing notification into an
// accusatory one (design §4: "Labels such as fraud, misconduct, or
// violation are not used in the driver experience").
const DISCIPLINARY_WORDS = /fraud|misconduct|violation|accusation/i;

describe('Fleet operational notification registrations', () => {
  it.each(fleetOperationalEvents)('%s is present in every live event map', (eventType) => {
    expect(DEFAULT_CHANNEL_PREFERENCES[eventType]).toBeDefined();
    expect(EVENT_ICONS[eventType]).toBeTruthy();
    expect(EVENT_SEVERITY[eventType]).toBeTruthy();
    expect(EVENT_LABELS[eventType]).toBeTruthy();
    expect(EVENT_GROUPS[eventType]).toBe('Fleet');
  });

  it('uses mandatory channels for monitor health failures', () => {
    for (const eventType of [
      'fleet.operational_monitor_failed',
    ]) {
      expect(DEFAULT_CHANNEL_PREFERENCES[eventType]).toEqual({
        in_app: true,
        email: true,
        whatsapp: true,
      });
    }
  });

  // Escalation shares the routine default: a routine/high/scheduled incident
  // escalating past its ack target must never gain WhatsApp by accident.
  // Critical explicit-source-event escalations still get WhatsApp, but via
  // the same sendMandatoryWhatsApp bypass `sendIncidentOpenedNotification`
  // uses — never by broadening this default (see incidentNotifications.ts).
  it('keeps routine incident, escalation, and summary notifications off WhatsApp', () => {
    for (const eventType of [
      'fleet.operational_incident_opened',
      'fleet.operational_incident_escalated',
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

describe('Fleet driver-input notification registrations', () => {
  it.each(fleetDriverInputEvents)('%s is present in every live event map', (eventType) => {
    expect(DEFAULT_CHANNEL_PREFERENCES[eventType]).toBeDefined();
    expect(EVENT_ICONS[eventType]).toBeTruthy();
    expect(EVENT_SEVERITY[eventType]).toBeTruthy();
    expect(EVENT_LABELS[eventType]).toBeTruthy();
    expect(EVENT_GROUPS[eventType]).toBe('Fleet');
  });

  // Driver input is optional and never a critical/mandatory channel — a
  // manager request or a driver response is routine, not an emergency.
  it('keeps driver-input notifications off WhatsApp by default', () => {
    for (const eventType of fleetDriverInputEvents) {
      expect(DEFAULT_CHANNEL_PREFERENCES[eventType]).toEqual({
        in_app: true,
        email: true,
        whatsapp: false,
      });
    }
  });

  it('uses neutral, non-disciplinary labels for driver-input events', () => {
    for (const eventType of fleetDriverInputEvents) {
      expect(EVENT_LABELS[eventType]).not.toMatch(DISCIPLINARY_WORDS);
    }
  });
});

const fleetRetentionEvents = [
  'fleet.retention_hold_review_due',
  'fleet.operational_aggregation_failed',
  'fleet.operational_retention_failed',
] as const;

describe('Fleet analytics and retention notification registrations', () => {
  it.each(fleetRetentionEvents)('%s is present in every live event map', (eventType) => {
    expect(DEFAULT_CHANNEL_PREFERENCES[eventType]).toBeDefined();
    expect(EVENT_ICONS[eventType]).toBeTruthy();
    expect(EVENT_SEVERITY[eventType]).toBeTruthy();
    expect(EVENT_LABELS[eventType]).toBeTruthy();
    expect(EVENT_GROUPS[eventType]).toBe('Fleet');
  });

  // Both automation failures are health alerts on a job that silently deletes
  // data when it works. Losing one to an unread inbox is the failure mode, so
  // they share fleet.operational_monitor_failed's mandatory-channel treatment.
  it('uses mandatory channels for aggregation and retention failures', () => {
    for (const eventType of [
      'fleet.operational_aggregation_failed',
      'fleet.operational_retention_failed',
    ]) {
      expect(DEFAULT_CHANNEL_PREFERENCES[eventType]).toEqual({
        in_app: true,
        email: true,
        whatsapp: true,
      });
    }
  });

  // A review falling due is a scheduled administrative task, not an incident.
  it('keeps the hold review reminder off WhatsApp', () => {
    expect(DEFAULT_CHANNEL_PREFERENCES['fleet.retention_hold_review_due']).toEqual({
      in_app: true,
      email: true,
      whatsapp: false,
    });
  });

  // A hold exists because of an accident, a grievance, or litigation. The
  // reminder reaches administrators, but its label is still read by anyone
  // with the notification bell open.
  it('uses a neutral label for the hold review reminder', () => {
    expect(EVENT_LABELS['fleet.retention_hold_review_due']).not.toMatch(DISCIPLINARY_WORDS);
  });
});
