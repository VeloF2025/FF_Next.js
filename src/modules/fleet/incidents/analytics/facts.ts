/**
 * The input contract for monthly metric calculation (PR8 task 2).
 *
 * A fact is one thing that happened, already scoped to a project and an
 * operational site, and already carrying the staff member it concerns as an
 * opaque `contributorKey`. The calculator unions those keys to decide whether a
 * group clears the anonymity threshold, and `suppression.ts` drops them before
 * anything is persisted — no contributor key ever reaches
 * `fleet_operational_monthly_aggregates`, which has no column that could hold
 * one.
 *
 * Facts are loaded by Task 3's `aggregateRepository`; nothing here touches SQL.
 */
import type { OperationsMetricKey } from './aggregateSchema';

/** Every fact is site-scoped. Site-less operational data has no dimension to roll up. */
export interface FactDimension {
  projectId: string;
  operationalSiteId: string;
}

interface FactBase {
  /** SAST calendar date, `YYYY-MM-DD`. The month is derived from this. */
  workDate: string;
  dimension: FactDimension;
}

/**
 * One scheduled staff-day on the operational roster.
 *
 * `vehicle_only` is its own confirmation state, never a kind of `confirmed`: a
 * vehicle at a site is not a person at a site.
 */
export interface PresenceFact extends FactBase {
  kind: 'presence';
  contributorKey: string;
  confirmation: 'confirmed' | 'unconfirmed' | 'vehicle_only';
}

/** One incident from `fleet_operational_incidents`, with its review outcome so far. */
export interface IncidentFact extends FactBase {
  kind: 'incident';
  contributorKey: string;
  /** The bare type, e.g. `late`; prefixed to `incident.late` by the calculator. */
  incidentType: string;
  /** The bare outcome, e.g. `confirmed`; null while the incident is unreviewed. */
  outcome: string | null;
  acknowledgementSeconds: number | null;
  reviewStartSeconds: number | null;
  resolutionSeconds: number | null;
  driverResponseSeconds: number | null;
  driverInputRequested: boolean;
  driverInputResponded: boolean;
  driverInputOnTime: boolean;
  evidenceAvailable: boolean;
  isRecurrence: boolean;
}

/**
 * One expected monitor run over a roster.
 *
 * `contributorKeys` are the staff that run evaluated. They exist for one
 * reason: the aggregate table's `contributor_count >= 5` is unconditional, so a
 * system-health metric still has to name a group to be publishable. Inheriting
 * the covered roster is the honest answer — a monitor statistic over three
 * people is suppressed exactly as their presence statistics are.
 */
export interface MonitorRunFact extends FactBase {
  kind: 'monitor_run';
  contributorKeys: readonly string[];
  completed: boolean;
}

/** One notification dispatched about one staff member. */
export interface NotificationFact extends FactBase {
  kind: 'notification';
  contributorKey: string;
  delivered: boolean;
}

export type OperationsFact = PresenceFact | IncidentFact | MonitorRunFact | NotificationFact;

/**
 * One metric for one site, one month, before anonymity is applied.
 *
 * `contributors` is a live `Set` and is the reason this type is internal: it is
 * the only place identity survives calculation. `ReleasedAggregate` is its
 * public counterpart and has a count in its place.
 */
export interface CalculatedMetricGroup {
  /** First day of the month, `YYYY-MM-01`, SAST. */
  monthStart: string;
  /**
   * The definition these numbers were computed under. Two versions of the same
   * month coexist in the table, so this is part of a row's identity and part of
   * its checksum - not decoration.
   */
  metricVersion: number;
  projectId: string;
  operationalSiteId: string;
  metricKey: OperationsMetricKey;
  numerator: number;
  denominator: number | null;
  histogram: { sampleCount: number; sumSeconds: number; buckets: number[] } | null;
  contributors: Set<string>;
}
