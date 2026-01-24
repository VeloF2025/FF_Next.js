/**
 * Test Specification: Overview Dashboard
 * Source: tests/specs/overview-dashboard.spec.md
 * Phase: RED (failing tests)
 *
 * Landing tab for System Health Hub - aggregates health from all subsystems
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { OverviewDashboard } from '@/modules/system/components/OverviewDashboard';

// Mock the API fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Default mock data
const mockHealthyData = {
  overallStatus: 'healthy' as const,
  stats: {
    servicesUp: 14,
    servicesTotal: 14,
    activeIncidents: 0,
    vlmLatencyMs: 45,
    dbQueryTimeMs: 12,
    autoFixesToday: 5,
    lastIssueAt: null,
    pendingApprovals: 0,
    successRate: 100,
  },
  recentActivity: [],
};

const mockDegradedData = {
  overallStatus: 'degraded' as const,
  stats: {
    servicesUp: 11,
    servicesTotal: 14,
    activeIncidents: 2,
    vlmLatencyMs: 45,
    dbQueryTimeMs: 12,
    autoFixesToday: 3,
    lastIssueAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
    pendingApprovals: 2,
    successRate: 70,
  },
  recentActivity: [],
};

const mockCriticalData = {
  overallStatus: 'critical' as const,
  stats: {
    servicesUp: 8,
    servicesTotal: 14,
    activeIncidents: 5,
    vlmLatencyMs: 600,
    dbQueryTimeMs: 150,
    autoFixesToday: 0,
    lastIssueAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30 min ago
    pendingApprovals: 3,
    successRate: 40,
  },
  recentActivity: [],
};

describe('OverviewDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockHealthyData),
    });
  });

  describe('OS-001: HEALTHY when all services up', () => {
    it('should show green HEALTHY status when 14/14 services up and 0 incidents', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockHealthyData),
      });

      render(<OverviewDashboard />);

      await waitFor(() => {
        const statusElement = screen.getByTestId('overall-status');
        expect(statusElement).toHaveTextContent(/healthy/i);
        expect(statusElement).toHaveClass('text-green-500');
      });
    });
  });

  describe('OS-002: DEGRADED when 1-3 services down', () => {
    it('should show yellow DEGRADED status when 11/14 services up', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockDegradedData),
      });

      render(<OverviewDashboard />);

      await waitFor(() => {
        const statusElement = screen.getByTestId('overall-status');
        expect(statusElement).toHaveTextContent(/degraded/i);
        expect(statusElement).toHaveClass('text-yellow-500');
      });
    });
  });

  describe('OS-003: CRITICAL when 4+ services down', () => {
    it('should show red CRITICAL status when 8/14 services up', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockCriticalData),
      });

      render(<OverviewDashboard />);

      await waitFor(() => {
        const statusElement = screen.getByTestId('overall-status');
        expect(statusElement).toHaveTextContent(/critical/i);
        expect(statusElement).toHaveClass('text-red-500');
      });
    });
  });

  describe('OS-004: CRITICAL when critical service down', () => {
    it('should show red CRITICAL status when VLM (critical service) is down', async () => {
      const dataWithCriticalDown = {
        ...mockDegradedData,
        overallStatus: 'critical' as const,
        criticalServiceDown: true,
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(dataWithCriticalDown),
      });

      render(<OverviewDashboard />);

      await waitFor(() => {
        const statusElement = screen.getByTestId('overall-status');
        expect(statusElement).toHaveTextContent(/critical/i);
      });
    });
  });

  describe('OS-005: Status updates on data refresh', () => {
    it('should update status when data changes', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockHealthyData),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockCriticalData),
        });

      const { rerender } = render(<OverviewDashboard />);

      await waitFor(() => {
        expect(screen.getByTestId('overall-status')).toHaveTextContent(/healthy/i);
      });

      // Trigger refresh
      rerender(<OverviewDashboard refreshTrigger={Date.now()} />);

      await waitFor(() => {
        expect(screen.getByTestId('overall-status')).toHaveTextContent(/critical/i);
      });
    });
  });

  describe('Stat Cards Grid', () => {
    it('should render 8 stat cards', async () => {
      render(<OverviewDashboard />);

      await waitFor(() => {
        expect(screen.getAllByTestId(/stat-card-/)).toHaveLength(8);
      });
    });
  });
});

// Separate describe block for Stat Card tests
describe('Stat Cards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('SC-001: Services Up shows correct count', () => {
    it('should display "12/14" when 12 services up out of 14 total', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          ...mockDegradedData,
          stats: { ...mockDegradedData.stats, servicesUp: 12, servicesTotal: 14 },
        }),
      });

      render(<OverviewDashboard />);

      await waitFor(() => {
        const card = screen.getByTestId('stat-card-services-up');
        expect(card).toHaveTextContent('12/14');
      });
    });
  });

  describe('SC-002: Services Up all green when 100%', () => {
    it('should show green badge when all services are up', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockHealthyData),
      });

      render(<OverviewDashboard />);

      await waitFor(() => {
        const card = screen.getByTestId('stat-card-services-up');
        expect(card).toHaveClass('border-green-500');
      });
    });
  });

  describe('SC-003: Services Up yellow when degraded', () => {
    it('should show yellow badge when 1-3 services are down', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockDegradedData),
      });

      render(<OverviewDashboard />);

      await waitFor(() => {
        const card = screen.getByTestId('stat-card-services-up');
        expect(card).toHaveClass('border-yellow-500');
      });
    });
  });

  describe('SC-004: Services Up red when critical', () => {
    it('should show red badge when 4+ services are down', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockCriticalData),
      });

      render(<OverviewDashboard />);

      await waitFor(() => {
        const card = screen.getByTestId('stat-card-services-up');
        expect(card).toHaveClass('border-red-500');
      });
    });
  });

  describe('SC-005: Active Incidents shows count', () => {
    it('should display "3" when there are 3 active incidents', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          ...mockDegradedData,
          stats: { ...mockDegradedData.stats, activeIncidents: 3 },
        }),
      });

      render(<OverviewDashboard />);

      await waitFor(() => {
        const card = screen.getByTestId('stat-card-active-incidents');
        expect(card).toHaveTextContent('3');
      });
    });
  });

  describe('SC-006: Active Incidents zero shows green', () => {
    it('should show "0" with green styling when no active incidents', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockHealthyData),
      });

      render(<OverviewDashboard />);

      await waitFor(() => {
        const card = screen.getByTestId('stat-card-active-incidents');
        expect(card).toHaveTextContent('0');
        expect(card).toHaveClass('border-green-500');
      });
    });
  });

  describe('SC-007: VLM Latency shows milliseconds', () => {
    it('should display "45ms" when VLM latency is 45ms', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockHealthyData),
      });

      render(<OverviewDashboard />);

      await waitFor(() => {
        const card = screen.getByTestId('stat-card-vlm-latency');
        expect(card).toHaveTextContent('45ms');
      });
    });
  });

  describe('SC-008: VLM Latency red when > 500ms', () => {
    it('should show red badge when VLM latency exceeds 500ms', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockCriticalData),
      });

      render(<OverviewDashboard />);

      await waitFor(() => {
        const card = screen.getByTestId('stat-card-vlm-latency');
        expect(card).toHaveTextContent('600ms');
        expect(card).toHaveClass('border-red-500');
      });
    });
  });

  describe('SC-009: DB Query Time shows milliseconds', () => {
    it('should display "12ms" when DB query time is 12ms', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockHealthyData),
      });

      render(<OverviewDashboard />);

      await waitFor(() => {
        const card = screen.getByTestId('stat-card-db-query-time');
        expect(card).toHaveTextContent('12ms');
      });
    });
  });

  describe('SC-010: DB Query Time red when > 100ms', () => {
    it('should show red badge when DB query time exceeds 100ms', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockCriticalData),
      });

      render(<OverviewDashboard />);

      await waitFor(() => {
        const card = screen.getByTestId('stat-card-db-query-time');
        expect(card).toHaveTextContent('150ms');
        expect(card).toHaveClass('border-red-500');
      });
    });
  });

  describe('SC-011: Auto-Fixes Today shows count', () => {
    it('should display "5" when 5 auto-fixes occurred today', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockHealthyData),
      });

      render(<OverviewDashboard />);

      await waitFor(() => {
        const card = screen.getByTestId('stat-card-auto-fixes-today');
        expect(card).toHaveTextContent('5');
      });
    });
  });

  describe('SC-012: Last Issue shows relative time', () => {
    it('should display "2h ago" when last issue was 2 hours ago', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockDegradedData),
      });

      render(<OverviewDashboard />);

      await waitFor(() => {
        const card = screen.getByTestId('stat-card-last-issue');
        expect(card).toHaveTextContent(/2h ago/i);
      });
    });
  });

  describe('SC-013: Last Issue shows "None" if no issues', () => {
    it('should display "None" when there are no incidents', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockHealthyData),
      });

      render(<OverviewDashboard />);

      await waitFor(() => {
        const card = screen.getByTestId('stat-card-last-issue');
        expect(card).toHaveTextContent(/none/i);
      });
    });
  });

  describe('SC-014: Pending Approvals shows queue', () => {
    it('should display "2" with badge when 2 approvals pending', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockDegradedData),
      });

      render(<OverviewDashboard />);

      await waitFor(() => {
        const card = screen.getByTestId('stat-card-pending-approvals');
        expect(card).toHaveTextContent('2');
      });
    });
  });

  describe('SC-015: Success Rate shows percentage', () => {
    it('should display "90%" when success rate is 90%', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          ...mockHealthyData,
          stats: { ...mockHealthyData.stats, successRate: 90 },
        }),
      });

      render(<OverviewDashboard />);

      await waitFor(() => {
        const card = screen.getByTestId('stat-card-success-rate');
        expect(card).toHaveTextContent('90%');
      });
    });
  });

  describe('SC-016: Success Rate 100% is green', () => {
    it('should show green styling when success rate is 100%', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockHealthyData),
      });

      render(<OverviewDashboard />);

      await waitFor(() => {
        const card = screen.getByTestId('stat-card-success-rate');
        expect(card).toHaveTextContent('100%');
        expect(card).toHaveClass('border-green-500');
      });
    });
  });

  describe('SC-017: Success Rate < 80% is yellow', () => {
    it('should show yellow styling when success rate is 70%', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockDegradedData),
      });

      render(<OverviewDashboard />);

      await waitFor(() => {
        const card = screen.getByTestId('stat-card-success-rate');
        expect(card).toHaveTextContent('70%');
        expect(card).toHaveClass('border-yellow-500');
      });
    });
  });

  describe('SC-018: Success Rate < 50% is red', () => {
    it('should show red styling when success rate is 40%', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockCriticalData),
      });

      render(<OverviewDashboard />);

      await waitFor(() => {
        const card = screen.getByTestId('stat-card-success-rate');
        expect(card).toHaveTextContent('40%');
        expect(card).toHaveClass('border-red-500');
      });
    });
  });
});

// Activity Timeline tests
describe('Activity Timeline', () => {
  const mockActivityEvents = [
    { id: '1', type: 'service_restart', description: 'VLM restarted', timestamp: new Date(Date.now() - 10 * 60 * 1000).toISOString(), status: 'success' },
    { id: '2', type: 'incident_created', description: 'Incident: DB connection lost', timestamp: new Date(Date.now() - 30 * 60 * 1000).toISOString(), status: 'pending' },
    { id: '3', type: 'incident_resolved', description: 'Resolved: DB connection restored', timestamp: new Date(Date.now() - 25 * 60 * 1000).toISOString(), status: 'success' },
    { id: '4', type: 'approval_requested', description: 'Approval needed: Restart WA Bridge', timestamp: new Date(Date.now() - 5 * 60 * 1000).toISOString(), status: 'pending' },
    { id: '5', type: 'fix_executed', description: 'Auto-fix: Cache cleared', timestamp: new Date(Date.now() - 2 * 60 * 1000).toISOString(), status: 'success' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        ...mockHealthyData,
        recentActivity: mockActivityEvents,
      }),
    });
  });

  describe('AT-001: Shows last 10 events', () => {
    it('should only show 10 events when more than 10 exist', async () => {
      const manyEvents = Array.from({ length: 15 }, (_, i) => ({
        id: String(i),
        type: 'service_restart',
        description: `Event ${i}`,
        timestamp: new Date(Date.now() - i * 60 * 1000).toISOString(),
        status: 'success',
      }));

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          ...mockHealthyData,
          recentActivity: manyEvents,
        }),
      });

      render(<OverviewDashboard />);

      await waitFor(() => {
        const events = screen.getAllByTestId(/activity-event-/);
        expect(events).toHaveLength(10);
      });
    });
  });

  describe('AT-002: Events sorted newest first', () => {
    it('should show newest event at the top', async () => {
      render(<OverviewDashboard />);

      await waitFor(() => {
        const events = screen.getAllByTestId(/activity-event-/);
        // Event 5 (2 min ago) should be first
        expect(events[0]).toHaveTextContent(/cache cleared/i);
      });
    });
  });

  describe('AT-003: Service restart event renders', () => {
    it('should render service restart event with correct description', async () => {
      render(<OverviewDashboard />);

      await waitFor(() => {
        expect(screen.getByText(/VLM restarted/i)).toBeInTheDocument();
      });
    });
  });

  describe('AT-004: Incident created event renders', () => {
    it('should render incident created event with correct description', async () => {
      render(<OverviewDashboard />);

      await waitFor(() => {
        expect(screen.getByText(/Incident: DB connection lost/i)).toBeInTheDocument();
      });
    });
  });

  describe('AT-005: Incident resolved event renders', () => {
    it('should render incident resolved event with correct description', async () => {
      render(<OverviewDashboard />);

      await waitFor(() => {
        expect(screen.getByText(/Resolved: DB connection restored/i)).toBeInTheDocument();
      });
    });
  });

  describe('AT-006: Approval requested event renders', () => {
    it('should render approval requested event with correct description', async () => {
      render(<OverviewDashboard />);

      await waitFor(() => {
        expect(screen.getByText(/Approval needed: Restart WA Bridge/i)).toBeInTheDocument();
      });
    });
  });

  describe('AT-007: Empty state when no events', () => {
    it('should show "No recent activity" when there are no events', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          ...mockHealthyData,
          recentActivity: [],
        }),
      });

      render(<OverviewDashboard />);

      await waitFor(() => {
        expect(screen.getByText(/no recent activity/i)).toBeInTheDocument();
      });
    });
  });

  describe('AT-008: Event timestamp relative', () => {
    it('should show relative timestamp for recent events', async () => {
      render(<OverviewDashboard />);

      await waitFor(() => {
        // 30 min ago event
        expect(screen.getByText(/30m ago/i)).toBeInTheDocument();
      });
    });
  });

  describe('AT-009: Event timestamp absolute for > 24h', () => {
    it('should show absolute timestamp for events older than 24 hours', async () => {
      const oldEvent = {
        id: 'old',
        type: 'service_restart',
        description: 'Old restart',
        timestamp: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), // 25 hours ago
        status: 'success',
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          ...mockHealthyData,
          recentActivity: [oldEvent],
        }),
      });

      render(<OverviewDashboard />);

      await waitFor(() => {
        // Should show date format like "Jan 23, 14:30"
        expect(screen.getByText(/Jan \d+, \d+:\d+/i)).toBeInTheDocument();
      });
    });
  });
});

// Integration-style tests for loading and error states
describe('Loading and Error States', () => {
  describe('IT-003: Partial API failure handled', () => {
    it('should show error state for failed API call', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      render(<OverviewDashboard />);

      await waitFor(() => {
        expect(screen.getByText(/error loading data/i)).toBeInTheDocument();
      });
    });
  });

  describe('IT-005: Loading states shown', () => {
    it('should show loading skeletons while data is being fetched', async () => {
      // Delay the mock response
      mockFetch.mockImplementation(() => new Promise((resolve) => {
        setTimeout(() => {
          resolve({
            ok: true,
            json: () => Promise.resolve(mockHealthyData),
          });
        }, 100);
      }));

      render(<OverviewDashboard />);

      // Should show loading state immediately
      expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument();

      // After data loads, loading should disappear
      await waitFor(() => {
        expect(screen.queryByTestId('loading-skeleton')).not.toBeInTheDocument();
      });
    });
  });
});
