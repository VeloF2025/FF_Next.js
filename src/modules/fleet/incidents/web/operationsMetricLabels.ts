/**
 * Reader-facing wording for the operations metric keys (stage 8, task 9).
 *
 * The incident and outcome halves are DERIVED from `incidentLabels.ts` rather
 * than restated. Those two label maps already govern the queue, the table, the
 * drawer and the action panel; a second spelling of "Accident / SOS" on the
 * analytics screen is how a reader ends up believing they are two different
 * things. Only the keys with no counterpart in the queue are written out here.
 */
import {
  INCIDENT_METRIC_KEYS, INPUT_METRIC_KEYS, OUTCOME_METRIC_KEYS, PRESENCE_METRIC_KEYS,
  RELIABILITY_METRIC_KEYS, TIMING_METRIC_KEYS,
} from '../analytics/aggregateSchema';
import type { OperationsMetricKey } from '../analytics/aggregateSchema';
import type { IncidentOutcome, IncidentType } from '../types';
import { INCIDENT_TYPE_LABELS, OUTCOME_LABELS } from './incidentLabels';

/** The keys the queue has no wording for: presence, timing, input, reliability. */
const OWN_LABELS: Record<string, string> = {
  'presence.scheduled_days': 'Scheduled days',
  'presence.confirmed_days': 'Confirmed present',
  'presence.unconfirmed_days': 'Unconfirmed',
  // Named at length deliberately. "Vehicle only" reads as a kind of present;
  // a vehicle at a site is not a person at a site, and the metric exists to
  // keep those apart.
  'presence.vehicle_only_days': 'Vehicle evidence only',
  'timing.acknowledgement': 'Time to acknowledge',
  'timing.review_start': 'Time to start review',
  'timing.resolution': 'Time to resolve',
  'timing.driver_response': 'Time for driver to respond',
  'input.requests_sent': 'Explanations requested',
  'input.responses_received': 'Explanations received',
  'input.responses_on_time': 'Explanations on time',
  'reliability.monitor_runs_expected': 'Monitor runs expected',
  'reliability.monitor_runs_completed': 'Monitor runs completed',
  'reliability.notifications_sent': 'Notifications sent',
  'reliability.notifications_delivered': 'Notifications delivered',
  'reliability.evidence_available': 'Incidents with evidence',
  'reliability.recurrence': 'Repeat incidents',
};

export function metricLabel(metricKey: OperationsMetricKey): string {
  if (metricKey.startsWith('incident.')) {
    return INCIDENT_TYPE_LABELS[metricKey.slice('incident.'.length) as IncidentType] ?? metricKey;
  }
  if (metricKey.startsWith('outcome.')) {
    return OUTCOME_LABELS[metricKey.slice('outcome.'.length) as IncidentOutcome] ?? metricKey;
  }
  return OWN_LABELS[metricKey] ?? metricKey;
}

export interface MetricGroup {
  title: string;
  keys: readonly OperationsMetricKey[];
}

/**
 * The breakdown table's sections. Grouped by the domain a reader thinks in, not
 * by the release components the suppression rule uses — those are the same
 * partition for presence, incidents and outcomes, and differ only where the
 * grouping would tell a reader nothing.
 */
export const METRIC_GROUPS: readonly MetricGroup[] = [
  { title: 'Presence', keys: PRESENCE_METRIC_KEYS },
  { title: 'Incidents by type', keys: INCIDENT_METRIC_KEYS },
  { title: 'Review outcomes', keys: OUTCOME_METRIC_KEYS },
  { title: 'Workflow timing', keys: TIMING_METRIC_KEYS },
  { title: 'Driver explanations', keys: INPUT_METRIC_KEYS },
  { title: 'System reliability', keys: RELIABILITY_METRIC_KEYS },
];

/**
 * The cards along the top.
 *
 * Every one is a metric the SERVER paired with a denominator. A card that
 * divided two numbers the server never called a ratio would be the page doing
 * arithmetic across metric keys — and where a component was released below
 * FULL, that division is over a total whose members were withheld, so the
 * percentage would be confidently wrong rather than absent.
 */
export const HEADLINE_METRICS: readonly OperationsMetricKey[] = [
  'presence.confirmed_days',
  'presence.unconfirmed_days',
  'reliability.evidence_available',
  'reliability.recurrence',
  'input.responses_on_time',
  'reliability.monitor_runs_completed',
];
