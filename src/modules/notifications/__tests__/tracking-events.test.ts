/**
 * Tracking notification event types registration.
 * Ensures both tracking pull-failure and data-gap events are registered
 * in all five constant maps (channel preferences, icons, severity, labels, groups).
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CHANNEL_PREFERENCES,
  EVENT_LABELS,
  EVENT_GROUPS,
  EVENT_SEVERITY,
  EVENT_ICONS,
} from '../constants';

const EVENTS = ['fleet.tracking_pull_failed', 'fleet.tracking_data_gap'] as const;

describe('tracking notification events', () => {
  it.each(EVENTS)('%s is registered in every constant map', (key) => {
    expect(DEFAULT_CHANNEL_PREFERENCES[key]).toBeDefined();
    expect(EVENT_LABELS[key]).toBeTruthy();
    expect(EVENT_GROUPS[key]).toBe('Fleet');
    expect(EVENT_SEVERITY[key]).toBeTruthy();
    expect(EVENT_ICONS[key]).toBeTruthy();
  });

  it('sends both to email and in-app', () => {
    for (const key of EVENTS) {
      expect(DEFAULT_CHANNEL_PREFERENCES[key]?.in_app).toBe(true);
      expect(DEFAULT_CHANNEL_PREFERENCES[key]?.email).toBe(true);
    }
  });

  it('keeps the data-gap event off WhatsApp', () => {
    expect(DEFAULT_CHANNEL_PREFERENCES['fleet.tracking_data_gap']?.whatsapp).toBe(false);
  });
});
