/**
 * The mock factory every operations read-path test file installs.
 *
 * The `vi.mock` calls themselves stay in each test file — they are hoisted and
 * must be visible where they apply. This only builds the spy objects and their
 * default behaviour, so three files cannot drift into three different ideas of
 * what a default request looks like.
 */
import type { Mock } from 'vitest';
import { PROJECT, STAFF, USER } from './operationsTestFixtures';

export interface OperationsMocks {
  scope: { resolveIncidentScope: Mock; isProjectOwnedByScope: Mock };
  settings: { getEffectiveAnalyticsRetentionSettings: Mock };
  facts: { loadIncidentFacts: Mock; loadNotificationFacts: Mock };
  monitor: { loadMonitorRunFacts: Mock };
  presence: { loadPresenceFacts: Mock; loadProjectsWithOperationalSites: Mock };
  aggregates: { readPublishedAggregates: Mock };
  runs: {
    latestAggregationRun: Mock; listScopedProjectIds: Mock; projectIdForOperationalSite: Mock;
  };
}

/** Every mock reset to the shape of an ordinary, unfiltered, in-scope request. */
export function resetOperationsMocks(mocks: OperationsMocks): void {
  mocks.scope.resolveIncidentScope.mockResolvedValue({ unrestricted: false, pmUserId: USER, pmStaffId: STAFF });
  mocks.scope.isProjectOwnedByScope.mockResolvedValue(true);
  mocks.settings.getEffectiveAnalyticsRetentionSettings.mockResolvedValue({ retentionMonths: 12, metricVersion: 1 });
  mocks.facts.loadIncidentFacts.mockResolvedValue([]);
  mocks.facts.loadNotificationFacts.mockResolvedValue([]);
  mocks.monitor.loadMonitorRunFacts.mockResolvedValue([]);
  mocks.presence.loadPresenceFacts.mockResolvedValue({ facts: [], skippedDays: 0 });
  mocks.presence.loadProjectsWithOperationalSites.mockResolvedValue([PROJECT]);
  mocks.aggregates.readPublishedAggregates.mockResolvedValue([]);
  mocks.runs.latestAggregationRun.mockResolvedValue({ status: 'succeeded', aggregatesThrough: '2026-07-01' });
  mocks.runs.listScopedProjectIds.mockResolvedValue([PROJECT]);
  mocks.runs.projectIdForOperationalSite.mockResolvedValue(PROJECT);
}
