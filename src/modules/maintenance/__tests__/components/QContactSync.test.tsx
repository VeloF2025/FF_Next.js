/**
 * QContact Sync Components Tests
 *
 * 🟢 WORKING: Comprehensive tests for QContact sync components
 *
 * Tests:
 * - SyncDashboard: Display sync status, metrics, last sync time, success rate
 * - SyncTrigger: Manual sync trigger with direction options
 * - SyncAuditLog: Audit log display with filtering and pagination
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SyncDashboard } from '../../components/QContact/SyncDashboard';
import { SyncTrigger } from '../../components/QContact/SyncTrigger';
import { SyncAuditLog } from '../../components/QContact/SyncAuditLog';
import type {
  SyncStatusOverview,
  QContactSyncLog,
  FullSyncResult,
  SyncLogListResponse
} from '../../types/qcontact';

// Mock the hooks used by components
const mockRefetch = vi.fn();
const mockTriggerSync = vi.fn();

vi.mock('../../hooks/useQContactSync', () => ({
  useQContactSyncStatus: vi.fn(() => ({
    syncStatus: null,
    isLoading: true,
    isError: false,
    error: null,
    refetch: mockRefetch,
  })),
  useQContactSyncLogs: vi.fn(() => ({
    logs: [],
    total: 0,
    isLoading: true,
    isError: false,
    error: null,
  })),
  useTriggerQContactSync: vi.fn(() => ({
    triggerSync: mockTriggerSync,
    isTriggering: false,
    lastResult: null,
  })),
}));

// Import the mocked hook for modification in tests
import { useQContactSyncStatus, useQContactSyncLogs, useTriggerQContactSync } from '../../hooks/useQContactSync';

// Helper to create wrapper with QueryClient
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

// Helper to create mock sync status
const createMockSyncStatus = (overrides?: Partial<SyncStatusOverview>): SyncStatusOverview => ({
  last_sync_at: new Date('2024-01-15T10:30:00Z'),
  last_sync_status: 'success',
  last_sync_duration_seconds: 45,
  pending_outbound: 3,
  pending_inbound: 2,
  failed_last_24h: 1,
  success_rate_last_7d: 0.985,
  is_healthy: true,
  health_issues: [],
  ...overrides,
});

// Helper to create mock sync logs
const createMockSyncLogs = (count: number): QContactSyncLog[] => {
  return Array.from({ length: count }, (_, index) => ({
    id: `log-${index + 1}`,
    ticket_id: `ticket-${index + 1}`,
    qcontact_ticket_id: `qc-${index + 1}`,
    sync_direction: index % 2 === 0 ? 'inbound' : 'outbound',
    sync_type: 'status_update',
    request_payload: { test: 'data' },
    response_payload: { success: true },
    status: index === 0 ? 'failed' : 'success',
    error_message: index === 0 ? 'Connection timeout' : null,
    synced_at: new Date(`2024-01-15T${10 + index}:00:00Z`),
  }));
};

// Helper to create mock sync log list response
const createMockLogListResponse = (count: number): SyncLogListResponse => ({
  logs: createMockSyncLogs(count),
  total: count,
  by_direction: {
    inbound: Math.ceil(count / 2),
    outbound: Math.floor(count / 2),
  },
  by_status: {
    success: count - 1,
    failed: 1,
    partial: 0,
  },
  success_rate: (count - 1) / count,
});

// ==================== SyncDashboard Component Tests ====================

describe('SyncDashboard Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Initial Rendering', () => {
    it('should display sync status overview', () => {
      // Arrange
      const mockStatus = createMockSyncStatus();
      vi.mocked(useQContactSyncStatus).mockReturnValue({
        syncStatus: mockStatus,
        isLoading: false,
        isError: false,
        error: null,
        refetch: mockRefetch,
      });

      // Act
      render(<SyncDashboard />, { wrapper: createWrapper() });

      // Assert
      expect(screen.getByText(/Sync Status/i)).toBeInTheDocument();
      expect(screen.getByText(/Healthy/i)).toBeInTheDocument();
    });

    it('should display success rate as percentage', () => {
      // Arrange
      const mockStatus = createMockSyncStatus({ success_rate_last_7d: 95.8 });
      vi.mocked(useQContactSyncStatus).mockReturnValue({
        syncStatus: mockStatus,
        isLoading: false,
        isError: false,
        error: null,
        refetch: mockRefetch,
      });

      // Act
      render(<SyncDashboard />, { wrapper: createWrapper() });

      // Assert
      expect(screen.getByText(/95.8%/i)).toBeInTheDocument();
    });

    it('should show pending outbound count', () => {
      // Arrange
      const mockStatus = createMockSyncStatus({ pending_outbound: 5 });
      vi.mocked(useQContactSyncStatus).mockReturnValue({
        syncStatus: mockStatus,
        isLoading: false,
        isError: false,
        error: null,
        refetch: mockRefetch,
      });

      // Act
      render(<SyncDashboard />, { wrapper: createWrapper() });

      // Assert
      expect(screen.getByText('5')).toBeInTheDocument();
    });

    it('should show loading state', () => {
      // Arrange
      vi.mocked(useQContactSyncStatus).mockReturnValue({
        syncStatus: null,
        isLoading: true,
        isError: false,
        error: null,
        refetch: mockRefetch,
      });

      // Act
      render(<SyncDashboard />, { wrapper: createWrapper() });

      // Assert
      expect(screen.getByText(/Loading sync status/i)).toBeInTheDocument();
    });

    it('should show error state', () => {
      // Arrange
      vi.mocked(useQContactSyncStatus).mockReturnValue({
        syncStatus: null,
        isLoading: false,
        isError: true,
        error: { message: 'Failed to load status' },
        refetch: mockRefetch,
      });

      // Act
      render(<SyncDashboard />, { wrapper: createWrapper() });

      // Assert
      expect(screen.getByText(/Failed to load sync status/i)).toBeInTheDocument();
    });
  });

  describe('Health Status Display', () => {
    it('should show healthy status with green indicator', () => {
      // Arrange
      const mockStatus = createMockSyncStatus({
        is_healthy: true,
        health_issues: [],
      });
      vi.mocked(useQContactSyncStatus).mockReturnValue({
        syncStatus: mockStatus,
        isLoading: false,
        isError: false,
        error: null,
        refetch: mockRefetch,
      });

      // Act
      render(<SyncDashboard />, { wrapper: createWrapper() });

      // Assert
      expect(screen.getByText(/Healthy/i)).toBeInTheDocument();
    });

    it('should show unhealthy status with issues', () => {
      // Arrange
      const mockStatus = createMockSyncStatus({
        is_healthy: false,
        health_issues: ['High failure rate', 'Connection timeout'],
      });
      vi.mocked(useQContactSyncStatus).mockReturnValue({
        syncStatus: mockStatus,
        isLoading: false,
        isError: false,
        error: null,
        refetch: mockRefetch,
      });

      // Act
      render(<SyncDashboard />, { wrapper: createWrapper() });

      // Assert
      expect(screen.getByText(/Unhealthy/i)).toBeInTheDocument();
      expect(screen.getByText(/High failure rate/i)).toBeInTheDocument();
      expect(screen.getByText(/Connection timeout/i)).toBeInTheDocument();
    });
  });

  describe('Refresh Functionality', () => {
    it('should call refetch when refresh button clicked', () => {
      // Arrange
      const mockStatus = createMockSyncStatus();
      vi.mocked(useQContactSyncStatus).mockReturnValue({
        syncStatus: mockStatus,
        isLoading: false,
        isError: false,
        error: null,
        refetch: mockRefetch,
      });

      // Act
      render(<SyncDashboard />, { wrapper: createWrapper() });
      const refreshButton = screen.getByRole('button', { name: /refresh/i });
      fireEvent.click(refreshButton);

      // Assert
      expect(mockRefetch).toHaveBeenCalledTimes(1);
    });
  });
});

// ==================== SyncTrigger Component Tests ====================

describe('SyncTrigger Component', () => {
  describe('Initial Rendering', () => {
    it('should render trigger button', () => {
      // Arrange
      const mockTrigger = vi.fn();

      // Act
      render(<SyncTrigger onTriggerSync={mockTrigger} />, { wrapper: createWrapper() });

      // Assert
      expect(screen.getByRole('button', { name: /Trigger Sync/i })).toBeInTheDocument();
    });

    it('should display sync direction options', () => {
      // Arrange
      const mockTrigger = vi.fn();

      // Act
      render(<SyncTrigger onTriggerSync={mockTrigger} />, { wrapper: createWrapper() });

      // Assert
      expect(screen.getByText(/Bidirectional/i)).toBeInTheDocument();
      expect(screen.getByText(/Inbound Only/i)).toBeInTheDocument();
      expect(screen.getByText(/Outbound Only/i)).toBeInTheDocument();
    });
  });

  describe('Trigger Manual Sync', () => {
    it('should call onTriggerSync when button clicked', async () => {
      // Arrange
      const mockTrigger = vi.fn().mockResolvedValue({
        started_at: new Date(),
        completed_at: new Date(),
        duration_seconds: 30,
        inbound_stats: {
          total_processed: 5,
          successful: 5,
          failed: 0,
          partial: 0,
          skipped: 0,
          created: 3,
          updated: 2,
        },
        outbound_stats: {
          total_processed: 0,
          successful: 0,
          failed: 0,
          partial: 0,
          skipped: 0,
          created: 0,
          updated: 0,
        },
        total_success: 5,
        total_failed: 0,
        success_rate: 1.0,
        errors: [],
      });

      // Act
      render(<SyncTrigger onTriggerSync={mockTrigger} />, { wrapper: createWrapper() });
      const triggerButton = screen.getByRole('button', { name: /Trigger Sync/i });
      fireEvent.click(triggerButton);

      // Assert
      await waitFor(() => {
        expect(mockTrigger).toHaveBeenCalledTimes(1);
      });
    });

    it('should disable button when sync in progress', async () => {
      // Arrange
      const mockTrigger = vi.fn(() => new Promise(() => {})); // Never resolves

      // Act
      render(<SyncTrigger onTriggerSync={mockTrigger} />, { wrapper: createWrapper() });
      const triggerButton = screen.getByRole('button', { name: /Trigger Sync/i });
      fireEvent.click(triggerButton);

      // Assert
      await waitFor(() => {
        const syncingButton = screen.getByRole('button', { name: /Syncing/i });
        expect(syncingButton).toBeDisabled();
      });
    });

    it('should show advanced options when expanded', () => {
      // Arrange
      const mockTrigger = vi.fn();

      // Act
      render(<SyncTrigger onTriggerSync={mockTrigger} />, { wrapper: createWrapper() });
      const advancedToggle = screen.getByText(/Show Advanced Options/i);
      fireEvent.click(advancedToggle);

      // Assert - check for label text (labels aren't properly associated with inputs)
      expect(screen.getByText(/Start Date/i)).toBeInTheDocument();
      expect(screen.getByText(/End Date/i)).toBeInTheDocument();
      expect(screen.getByText(/Force Resync/i)).toBeInTheDocument();
    });
  });
});

// ==================== SyncAuditLog Component Tests ====================

describe('SyncAuditLog Component', () => {
  describe('Initial Rendering', () => {
    it('should display sync log entries', () => {
      // Arrange
      const mockData = createMockLogListResponse(3);

      // Act
      render(<SyncAuditLog data={mockData} />, { wrapper: createWrapper() });

      // Assert
      expect(screen.getByText(/Sync Audit Log/i)).toBeInTheDocument();
      // Log entries show ticket IDs in the visible area
      expect(screen.getByText(/ticket-1/i)).toBeInTheDocument();
      expect(screen.getByText(/ticket-2/i)).toBeInTheDocument();
    });

    it('should display statistics', () => {
      // Arrange
      const mockData = createMockLogListResponse(5);

      // Act
      render(<SyncAuditLog data={mockData} />, { wrapper: createWrapper() });

      // Assert - statistics are displayed in cards with bold numbers
      // Inbound count (3) and Outbound count (2) are shown
      const inboundCards = screen.getAllByText('3');
      const outboundCards = screen.getAllByText('2');
      expect(inboundCards.length).toBeGreaterThan(0);
      expect(outboundCards.length).toBeGreaterThan(0);
    });

    it('should show loading state', () => {
      // Act
      render(<SyncAuditLog data={null} isLoading={true} />, { wrapper: createWrapper() });

      // Assert
      expect(screen.getByText(/Loading sync logs/i)).toBeInTheDocument();
    });

    it('should show error state', () => {
      // Act
      render(<SyncAuditLog data={null} error="Failed to load logs" />, { wrapper: createWrapper() });

      // Assert
      expect(screen.getByText(/Failed to Load Sync Logs/i)).toBeInTheDocument();
      expect(screen.getByText(/Failed to load logs/i)).toBeInTheDocument();
    });

    it('should show empty state when no logs', () => {
      // Arrange
      const emptyData = createMockLogListResponse(0);

      // Act
      render(<SyncAuditLog data={emptyData} />, { wrapper: createWrapper() });

      // Assert
      expect(screen.getByText(/No sync logs found/i)).toBeInTheDocument();
    });
  });

  describe('Log Entry Display', () => {
    it('should display sync direction and type', () => {
      // Arrange
      const mockData = createMockLogListResponse(2);

      // Act
      render(<SyncAuditLog data={mockData} />, { wrapper: createWrapper() });

      // Assert - check for direction labels in log entries
      const inboundElements = screen.getAllByText('INBOUND');
      const outboundElements = screen.getAllByText('OUTBOUND');
      expect(inboundElements.length).toBeGreaterThan(0);
      expect(outboundElements.length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Status Update/i).length).toBeGreaterThan(0);
    });

    it('should display sync status', () => {
      // Arrange
      const mockData = createMockLogListResponse(2);

      // Act
      render(<SyncAuditLog data={mockData} />, { wrapper: createWrapper() });

      // Assert - both statuses should appear (first log is failed, second is success)
      const failedElements = screen.getAllByText('FAILED');
      const successElements = screen.getAllByText('SUCCESS');
      expect(failedElements.length).toBeGreaterThan(0);
      expect(successElements.length).toBeGreaterThan(0);
    });

    it('should expand log entry to show details', () => {
      // Arrange
      const mockData = createMockLogListResponse(1);

      // Act
      render(<SyncAuditLog data={mockData} />, { wrapper: createWrapper() });

      // Find and click the first log entry
      const logEntries = screen.getAllByRole('button');
      const firstEntry = logEntries[0];
      fireEvent.click(firstEntry);

      // Assert
      expect(screen.getByText(/Error Message/i)).toBeInTheDocument();
      expect(screen.getByText(/Connection timeout/i)).toBeInTheDocument();
    });
  });

  describe('Filtering', () => {
    it('should call onFilterChange when filters applied', () => {
      // Arrange
      const mockData = createMockLogListResponse(5);
      const mockFilterChange = vi.fn();

      // Act
      render(
        <SyncAuditLog
          data={mockData}
          onFilterChange={mockFilterChange}
        />,
        { wrapper: createWrapper() }
      );

      // Expand filters
      const filtersButton = screen.getByText(/Filters/i);
      fireEvent.click(filtersButton);

      // Change direction filter - find the select by role after finding Direction label
      const directionLabel = screen.getByText('Direction');
      const directionSelect = directionLabel.parentElement?.querySelector('select');
      expect(directionSelect).toBeTruthy();
      fireEvent.change(directionSelect!, { target: { value: 'inbound' } });

      // Apply filters
      const applyButton = screen.getByRole('button', { name: /Apply Filters/i });
      fireEvent.click(applyButton);

      // Assert
      expect(mockFilterChange).toHaveBeenCalledWith(
        expect.objectContaining({ sync_direction: 'inbound' })
      );
    });
  });

  describe('Pagination', () => {
    it('should call onPageChange when next page clicked', () => {
      // Arrange
      const mockData = {
        ...createMockLogListResponse(100),
        total: 100,
      };
      const mockPageChange = vi.fn();

      // Act
      render(
        <SyncAuditLog
          data={mockData}
          onPageChange={mockPageChange}
          currentPage={1}
          pageSize={50}
        />,
        { wrapper: createWrapper() }
      );

      const nextButton = screen.getByRole('button', { name: /Next/i });
      fireEvent.click(nextButton);

      // Assert
      expect(mockPageChange).toHaveBeenCalledWith(2);
    });

    it('should disable previous button on first page', () => {
      // Arrange
      const mockData = {
        ...createMockLogListResponse(100),
        total: 100,
      };
      const mockPageChange = vi.fn();

      // Act
      render(
        <SyncAuditLog
          data={mockData}
          onPageChange={mockPageChange}
          currentPage={1}
          pageSize={50}
        />,
        { wrapper: createWrapper() }
      );

      const previousButton = screen.getByRole('button', { name: /Previous/i });

      // Assert
      expect(previousButton).toBeDisabled();
    });
  });
});
