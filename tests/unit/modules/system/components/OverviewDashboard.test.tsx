/**
 * Test Specification: Overview Dashboard
 * Tests the Overview Dashboard component for the System Health Hub
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import OverviewDashboard from '@/modules/system/components/OverviewDashboard';

// Mock the API fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Default mock data - matches API response structure
const mockHealthyData = {
  data: {
    health: {
      overall: 'healthy' as const,
      services: [
        { serviceId: '1', serviceName: 'VLM', status: 'healthy', lastChecked: new Date() },
        { serviceId: '2', serviceName: 'Database', status: 'healthy', lastChecked: new Date() },
      ],
      healthyCount: 14,
      unhealthyCount: 0,
      criticalDown: false,
    },
    stats: {
      successRate: 100,
      mttrSeconds: 300,
      incidentCount: 0,
    },
    pendingApprovals: [],
    recentActivity: [],
  },
};

const mockDegradedData = {
  data: {
    health: {
      overall: 'degraded' as const,
      services: [],
      healthyCount: 11,
      unhealthyCount: 3,
      criticalDown: false,
    },
    stats: {
      successRate: 70,
      mttrSeconds: 600,
      incidentCount: 2,
    },
    pendingApprovals: [
      { id: '1', actionName: 'Restart service' },
      { id: '2', actionName: 'Clear cache' },
    ],
    recentActivity: [],
  },
};

const mockCriticalData = {
  data: {
    health: {
      overall: 'critical' as const,
      services: [],
      healthyCount: 8,
      unhealthyCount: 6,
      criticalDown: true,
    },
    stats: {
      successRate: 40,
      mttrSeconds: 1200,
      incidentCount: 5,
    },
    pendingApprovals: [
      { id: '1', actionName: 'Critical fix' },
      { id: '2', actionName: 'Restart database' },
      { id: '3', actionName: 'Scale up' },
    ],
    recentActivity: [
      {
        id: '1',
        type: 'incident_created',
        description: 'Critical service down',
        timestamp: new Date(),
      },
    ],
  },
};

describe('OverviewDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockHealthyData),
    });
  });

  describe('Overall Status Display', () => {
    it('should show HEALTHY status when all services are up', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockHealthyData),
      });

      render(<OverviewDashboard />);

      await waitFor(() => {
        const statusElement = screen.getByTestId('overall-status');
        expect(statusElement).toHaveTextContent(/healthy/i);
        expect(statusElement).toHaveClass('text-green-400');
      });
    });

    it('should show DEGRADED status when some services are down', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockDegradedData),
      });

      render(<OverviewDashboard />);

      await waitFor(() => {
        const statusElement = screen.getByTestId('overall-status');
        expect(statusElement).toHaveTextContent(/degraded/i);
        expect(statusElement).toHaveClass('text-yellow-400');
      });
    });

    it('should show CRITICAL status when many services are down', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockCriticalData),
      });

      render(<OverviewDashboard />);

      await waitFor(() => {
        const statusElement = screen.getByTestId('overall-status');
        expect(statusElement).toHaveTextContent(/critical/i);
        expect(statusElement).toHaveClass('text-red-400');
      });
    });
  });

  describe('Stats Display', () => {
    it('should display services count', async () => {
      render(<OverviewDashboard />);

      await waitFor(() => {
        expect(screen.getByText(/14\/14/)).toBeInTheDocument();
      });
    });

    it('should display success rate', async () => {
      render(<OverviewDashboard />);

      await waitFor(() => {
        expect(screen.getByText(/100%/)).toBeInTheDocument();
      });
    });

    it('should display pending approvals count when present', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockDegradedData),
      });

      render(<OverviewDashboard />);

      await waitFor(() => {
        expect(screen.getByText(/Actions Awaiting Approval/i)).toBeInTheDocument();
        expect(screen.getByText(/Restart service/)).toBeInTheDocument();
      });
    });
  });

  describe('Loading and Error States', () => {
    it('should show loading skeleton while fetching data', async () => {
      mockFetch.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                ok: true,
                json: () => Promise.resolve(mockHealthyData),
              });
            }, 100);
          })
      );

      render(<OverviewDashboard />);

      // Should show loading state immediately
      expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument();

      // After data loads, loading should disappear
      await waitFor(() => {
        expect(screen.queryByTestId('loading-skeleton')).not.toBeInTheDocument();
      });
    });

    it('should show error state when API fails', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      render(<OverviewDashboard />);

      await waitFor(() => {
        expect(screen.getByText(/error loading data/i)).toBeInTheDocument();
      });
    });

    it('should display the specific error message', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'));

      render(<OverviewDashboard />);

      await waitFor(() => {
        expect(screen.getByText(/Connection refused/i)).toBeInTheDocument();
      });
    });
  });

  describe('Recent Activity', () => {
    it('should show recent activity section header', async () => {
      render(<OverviewDashboard />);

      await waitFor(() => {
        // Look for the heading specifically
        expect(screen.getByRole('heading', { name: /Recent Activity/i })).toBeInTheDocument();
      });
    });

    it('should show "No recent activity" when empty', async () => {
      render(<OverviewDashboard />);

      await waitFor(() => {
        expect(screen.getByText(/No recent activity/i)).toBeInTheDocument();
      });
    });
  });

  describe('Service Status', () => {
    it('should show service status section', async () => {
      render(<OverviewDashboard />);

      await waitFor(() => {
        expect(screen.getByText(/Service Status/i)).toBeInTheDocument();
      });
    });
  });
});
