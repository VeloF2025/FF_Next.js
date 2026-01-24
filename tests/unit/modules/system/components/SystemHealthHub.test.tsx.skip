/**
 * Test Specification: System Health Hub
 * Source: tests/specs/system-health-hub.spec.md
 * Phase: RED (failing tests)
 *
 * This is the unified System Health Hub with 4 tabs:
 * Overview, Infrastructure, QField, Self-Healing
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useRouter } from 'next/router';
import { SystemHealthHub } from '@/modules/system/components/SystemHealthHub';

// Mock Next.js router
vi.mock('next/router', () => ({
  useRouter: vi.fn(),
}));

// Mock auth context
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

// Mock child components (they exist, we just test they render)
vi.mock('@/modules/system/components/InfrastructureHealthDashboard', () => ({
  InfrastructureHealthDashboard: () => <div data-testid="infrastructure-dashboard">Infrastructure Dashboard</div>,
}));

vi.mock('@/modules/system/qfield/QFieldDashboard', () => ({
  QFieldDashboard: () => <div data-testid="qfield-dashboard">QField Dashboard</div>,
}));

vi.mock('@/modules/system/components/OverviewDashboard', () => ({
  OverviewDashboard: () => <div data-testid="overview-dashboard">Overview Dashboard</div>,
}));

vi.mock('@/modules/system/components/SelfHealingDashboard', () => ({
  SelfHealingDashboard: () => <div data-testid="self-healing-dashboard">Self-Healing Dashboard</div>,
}));

import { useAuth } from '@/contexts/AuthContext';
import { Permission } from '@/types/rbac';

const mockPush = vi.fn();
const mockReplace = vi.fn();

const createMockRouter = (query: Record<string, string> = {}) => ({
  query,
  push: mockPush,
  replace: mockReplace,
  pathname: '/system/health',
  asPath: '/system/health',
});

const mockSuperAdmin = {
  user: { id: '1', name: 'Admin', role: 'super_admin' },
  permissions: [Permission.SYSTEM_ADMIN],
  hasPermission: (perm: Permission) => perm === Permission.SYSTEM_ADMIN,
};

const mockManager = {
  user: { id: '2', name: 'Manager', role: 'manager' },
  permissions: [],
  hasPermission: () => false,
};

describe('SystemHealthHub', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    (useRouter as ReturnType<typeof vi.fn>).mockReturnValue(createMockRouter());
    (useAuth as ReturnType<typeof vi.fn>).mockReturnValue(mockSuperAdmin);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('UT-001: Renders with 4 tabs', () => {
    it('should render all 4 tab buttons when user has SYSTEM_ADMIN permission', () => {
      render(<SystemHealthHub />);

      expect(screen.getByRole('tab', { name: /overview/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /infrastructure/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /qfield/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /self-healing/i })).toBeInTheDocument();
    });
  });

  describe('UT-002: Default tab is Overview', () => {
    it('should show Overview tab as active when no query param provided', () => {
      render(<SystemHealthHub />);

      const overviewTab = screen.getByRole('tab', { name: /overview/i });
      expect(overviewTab).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByTestId('overview-dashboard')).toBeInTheDocument();
    });
  });

  describe('UT-003: Tab switch updates URL', () => {
    it('should update URL query param when clicking Infrastructure tab', async () => {
      render(<SystemHealthHub />);

      const infrastructureTab = screen.getByRole('tab', { name: /infrastructure/i });
      fireEvent.click(infrastructureTab);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith(
          expect.objectContaining({
            query: { tab: 'infrastructure' },
          }),
          undefined,
          { shallow: true }
        );
      });
    });

    it('should update URL query param when clicking QField tab', async () => {
      render(<SystemHealthHub />);

      const qfieldTab = screen.getByRole('tab', { name: /qfield/i });
      fireEvent.click(qfieldTab);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith(
          expect.objectContaining({
            query: { tab: 'qfield' },
          }),
          undefined,
          { shallow: true }
        );
      });
    });

    it('should update URL query param when clicking Self-Healing tab', async () => {
      render(<SystemHealthHub />);

      const selfHealingTab = screen.getByRole('tab', { name: /self-healing/i });
      fireEvent.click(selfHealingTab);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith(
          expect.objectContaining({
            query: { tab: 'self-healing' },
          }),
          undefined,
          { shallow: true }
        );
      });
    });
  });

  describe('UT-004: URL param sets active tab', () => {
    it('should activate QField tab when URL has ?tab=qfield', () => {
      (useRouter as ReturnType<typeof vi.fn>).mockReturnValue(
        createMockRouter({ tab: 'qfield' })
      );

      render(<SystemHealthHub />);

      const qfieldTab = screen.getByRole('tab', { name: /qfield/i });
      expect(qfieldTab).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByTestId('qfield-dashboard')).toBeInTheDocument();
    });

    it('should activate Infrastructure tab when URL has ?tab=infrastructure', () => {
      (useRouter as ReturnType<typeof vi.fn>).mockReturnValue(
        createMockRouter({ tab: 'infrastructure' })
      );

      render(<SystemHealthHub />);

      const infrastructureTab = screen.getByRole('tab', { name: /infrastructure/i });
      expect(infrastructureTab).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByTestId('infrastructure-dashboard')).toBeInTheDocument();
    });

    it('should activate Self-Healing tab when URL has ?tab=self-healing', () => {
      (useRouter as ReturnType<typeof vi.fn>).mockReturnValue(
        createMockRouter({ tab: 'self-healing' })
      );

      render(<SystemHealthHub />);

      const selfHealingTab = screen.getByRole('tab', { name: /self-healing/i });
      expect(selfHealingTab).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByTestId('self-healing-dashboard')).toBeInTheDocument();
    });
  });

  describe('UT-005: Invalid tab param defaults to Overview', () => {
    it('should default to Overview tab when URL has invalid tab param', () => {
      (useRouter as ReturnType<typeof vi.fn>).mockReturnValue(
        createMockRouter({ tab: 'invalid' })
      );

      render(<SystemHealthHub />);

      const overviewTab = screen.getByRole('tab', { name: /overview/i });
      expect(overviewTab).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByTestId('overview-dashboard')).toBeInTheDocument();
    });

    it('should default to Overview tab when URL has empty tab param', () => {
      (useRouter as ReturnType<typeof vi.fn>).mockReturnValue(
        createMockRouter({ tab: '' })
      );

      render(<SystemHealthHub />);

      const overviewTab = screen.getByRole('tab', { name: /overview/i });
      expect(overviewTab).toHaveAttribute('aria-selected', 'true');
    });
  });

  describe('UT-006: Unauthorized user sees AccessDenied', () => {
    it('should show AccessDenied component when user lacks SYSTEM_ADMIN permission', () => {
      (useAuth as ReturnType<typeof vi.fn>).mockReturnValue(mockManager);

      render(<SystemHealthHub />);

      expect(screen.getByText(/access denied/i)).toBeInTheDocument();
      expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    });

    it('should show AccessDenied when user has no permissions', () => {
      (useAuth as ReturnType<typeof vi.fn>).mockReturnValue({
        user: { id: '3', name: 'Guest', role: 'viewer' },
        permissions: [],
        hasPermission: () => false,
      });

      render(<SystemHealthHub />);

      expect(screen.getByText(/access denied/i)).toBeInTheDocument();
    });
  });

  describe('UT-007: Infrastructure tab renders dashboard', () => {
    it('should render InfrastructureHealthDashboard when Infrastructure tab is active', () => {
      (useRouter as ReturnType<typeof vi.fn>).mockReturnValue(
        createMockRouter({ tab: 'infrastructure' })
      );

      render(<SystemHealthHub />);

      expect(screen.getByTestId('infrastructure-dashboard')).toBeInTheDocument();
      expect(screen.queryByTestId('overview-dashboard')).not.toBeInTheDocument();
      expect(screen.queryByTestId('qfield-dashboard')).not.toBeInTheDocument();
      expect(screen.queryByTestId('self-healing-dashboard')).not.toBeInTheDocument();
    });
  });

  describe('UT-008: QField tab renders dashboard', () => {
    it('should render QFieldDashboard when QField tab is active', () => {
      (useRouter as ReturnType<typeof vi.fn>).mockReturnValue(
        createMockRouter({ tab: 'qfield' })
      );

      render(<SystemHealthHub />);

      expect(screen.getByTestId('qfield-dashboard')).toBeInTheDocument();
      expect(screen.queryByTestId('overview-dashboard')).not.toBeInTheDocument();
      expect(screen.queryByTestId('infrastructure-dashboard')).not.toBeInTheDocument();
      expect(screen.queryByTestId('self-healing-dashboard')).not.toBeInTheDocument();
    });
  });

  describe('UT-009: Auto-refresh triggers every 30s', () => {
    it('should call refresh function after 30 seconds', async () => {
      const onRefresh = vi.fn();

      render(<SystemHealthHub onRefresh={onRefresh} />);

      // Advance time by 30 seconds
      vi.advanceTimersByTime(30000);

      await waitFor(() => {
        expect(onRefresh).toHaveBeenCalledTimes(1);
      });
    });

    it('should call refresh function multiple times over time', async () => {
      const onRefresh = vi.fn();

      render(<SystemHealthHub onRefresh={onRefresh} />);

      // Advance time by 90 seconds (3 refresh cycles)
      vi.advanceTimersByTime(90000);

      await waitFor(() => {
        expect(onRefresh).toHaveBeenCalledTimes(3);
      });
    });

    it('should show loading state during auto-refresh', async () => {
      render(<SystemHealthHub />);

      vi.advanceTimersByTime(30000);

      await waitFor(() => {
        // Check for loading indicator
        expect(screen.getByTestId('refresh-indicator')).toBeInTheDocument();
      });
    });
  });

  describe('UT-010: Manual refresh button works', () => {
    it('should have a visible refresh button', () => {
      render(<SystemHealthHub />);

      const refreshButton = screen.getByRole('button', { name: /refresh/i });
      expect(refreshButton).toBeInTheDocument();
    });

    it('should trigger data refresh when refresh button is clicked', async () => {
      const onRefresh = vi.fn();

      render(<SystemHealthHub onRefresh={onRefresh} />);

      const refreshButton = screen.getByRole('button', { name: /refresh/i });
      fireEvent.click(refreshButton);

      await waitFor(() => {
        expect(onRefresh).toHaveBeenCalledTimes(1);
      });
    });

    it('should show loading state when refresh button is clicked', async () => {
      render(<SystemHealthHub />);

      const refreshButton = screen.getByRole('button', { name: /refresh/i });
      fireEvent.click(refreshButton);

      await waitFor(() => {
        expect(refreshButton).toBeDisabled();
      });
    });

    it('should reset auto-refresh timer when manual refresh is clicked', async () => {
      const onRefresh = vi.fn();

      render(<SystemHealthHub onRefresh={onRefresh} />);

      // Advance 20 seconds
      vi.advanceTimersByTime(20000);

      // Click manual refresh
      const refreshButton = screen.getByRole('button', { name: /refresh/i });
      fireEvent.click(refreshButton);

      // First call from manual refresh
      expect(onRefresh).toHaveBeenCalledTimes(1);

      // Advance another 20 seconds (would have triggered auto-refresh without manual)
      vi.advanceTimersByTime(20000);

      // Should still be just 1 call (timer was reset)
      expect(onRefresh).toHaveBeenCalledTimes(1);

      // Advance full 30 seconds from manual refresh
      vi.advanceTimersByTime(10000);

      // Now auto-refresh should trigger
      await waitFor(() => {
        expect(onRefresh).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('Tab Content Rendering', () => {
    it('should render Overview dashboard content by default', () => {
      render(<SystemHealthHub />);

      expect(screen.getByTestId('overview-dashboard')).toBeInTheDocument();
    });

    it('should render Self-Healing dashboard when tab is selected', () => {
      (useRouter as ReturnType<typeof vi.fn>).mockReturnValue(
        createMockRouter({ tab: 'self-healing' })
      );

      render(<SystemHealthHub />);

      expect(screen.getByTestId('self-healing-dashboard')).toBeInTheDocument();
    });

    it('should only render one dashboard at a time', () => {
      render(<SystemHealthHub />);

      const dashboards = [
        screen.queryByTestId('overview-dashboard'),
        screen.queryByTestId('infrastructure-dashboard'),
        screen.queryByTestId('qfield-dashboard'),
        screen.queryByTestId('self-healing-dashboard'),
      ].filter(Boolean);

      expect(dashboards).toHaveLength(1);
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA attributes on tabs', () => {
      render(<SystemHealthHub />);

      const tabList = screen.getByRole('tablist');
      expect(tabList).toBeInTheDocument();

      const tabs = screen.getAllByRole('tab');
      expect(tabs).toHaveLength(4);

      tabs.forEach((tab) => {
        expect(tab).toHaveAttribute('aria-selected');
      });
    });

    it('should have proper tabpanel for active content', () => {
      render(<SystemHealthHub />);

      const tabPanel = screen.getByRole('tabpanel');
      expect(tabPanel).toBeInTheDocument();
    });
  });
});
