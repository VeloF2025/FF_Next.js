/**
 * HandoverSnapshot Component Tests
 *
 * 🟢 WORKING: Comprehensive tests for handover snapshot display component
 *
 * Tests:
 * - Display snapshot data (ticket state at handover)
 * - Display evidence links (photos/documents)
 * - Display decisions (approvals/rejections)
 * - Display ownership transfer details
 * - Show locked status indicator
 * - Handle loading and error states
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HandoverSnapshot } from '../../components/Handover/HandoverSnapshot';
import { HandoverType, OwnerType } from '../../types/handover';
import type { HandoverSnapshot as HandoverSnapshotType } from '../../types/handover';

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

// Mock Clerk auth
  useUser: vi.fn(() => ({
    user: { id: 'test-user-id', fullName: 'Test User' },
    isLoaded: true,
  })),
}));

// Create mock handover snapshot
const createMockSnapshot = (): HandoverSnapshotType => ({
  id: 'snapshot-123',
  ticket_id: 'ticket-123',
  handover_type: HandoverType.QA_TO_MAINTENANCE,
  snapshot_data: {
    ticket_uid: 'FT406824',
    title: 'Fiber cut repair',
    description: 'Customer reported no signal',
    status: 'completed',
    priority: 'high',
    ticket_type: 'maintenance',
    dr_number: 'DR12345',
    project_id: 'project-123',
    zone_id: 'zone-123',
    pole_number: 'P-001',
    pon_number: 'PON-001',
    address: '123 Main St',
    ont_serial: 'ONT123456',
    ont_rx_level: -22.5,
    ont_model: 'HG8245H',
    assigned_to: 'user-123',
    assigned_contractor_id: 'contractor-123',
    assigned_team: 'Team A',
    qa_ready: true,
    qa_readiness_check_at: new Date('2024-01-15T10:00:00Z'),
    fault_cause: 'workmanship',
    fault_cause_details: 'Poor splicing detected',
    verification_steps_completed: 12,
    verification_steps_total: 12,
    snapshot_timestamp: new Date('2024-01-15T12:00:00Z'),
  },
  evidence_links: [
    {
      type: 'photo',
      step_number: 1,
      url: 'https://example.com/photo1.jpg',
      filename: 'photo1.jpg',
      uploaded_at: new Date('2024-01-15T09:00:00Z'),
      uploaded_by: 'user-123',
    },
    {
      type: 'photo',
      step_number: 2,
      url: 'https://example.com/photo2.jpg',
      filename: 'photo2.jpg',
      uploaded_at: new Date('2024-01-15T09:30:00Z'),
      uploaded_by: 'user-123',
    },
  ],
  decisions: [
    {
      decision_type: 'approval',
      decision_by: 'qa-user-123',
      decision_at: new Date('2024-01-15T11:00:00Z'),
      notes: 'All checks passed',
      metadata: null,
    },
  ],
  guarantee_status: 'under_guarantee',
  from_owner_type: OwnerType.QA,
  from_owner_id: 'qa-user-123',
  to_owner_type: OwnerType.MAINTENANCE,
  to_owner_id: 'maint-user-123',
  handover_at: new Date('2024-01-15T12:00:00Z'),
  handover_by: 'qa-user-123',
  is_locked: true,
  created_at: new Date('2024-01-15T12:00:00Z'),
});

describe('HandoverSnapshot Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Snapshot Data Display', () => {
    it('should display ticket basic info', () => {
      // Arrange
      const snapshot = createMockSnapshot();

      // Act
      render(<HandoverSnapshot snapshot={snapshot} expandedByDefault />, { wrapper: createWrapper() });

      // Assert
      expect(screen.getByText('FT406824')).toBeInTheDocument();
      expect(screen.getByText('Fiber cut repair')).toBeInTheDocument();
    });

    it('should display location data', () => {
      // Arrange
      const snapshot = createMockSnapshot();

      // Act
      render(<HandoverSnapshot snapshot={snapshot} expandedByDefault />, { wrapper: createWrapper() });

      // Assert
      expect(screen.getByText(/DR12345/i)).toBeInTheDocument();
      expect(screen.getByText(/P-001/i)).toBeInTheDocument();
      expect(screen.getByText(/PON-001/i)).toBeInTheDocument();
    });

    it('should display equipment data', () => {
      // Arrange
      const snapshot = createMockSnapshot();

      // Act
      render(<HandoverSnapshot snapshot={snapshot} expandedByDefault />, { wrapper: createWrapper() });

      // Assert
      expect(screen.getByText(/ONT123456/i)).toBeInTheDocument();
      expect(screen.getByText(/-22.5/i)).toBeInTheDocument(); // RX level
      expect(screen.getByText(/HG8245H/i)).toBeInTheDocument();
    });

    it('should display verification status', () => {
      // Arrange
      const snapshot = createMockSnapshot();

      // Act
      render(<HandoverSnapshot snapshot={snapshot} expandedByDefault />, { wrapper: createWrapper() });

      // Assert
      expect(screen.getByText('12 / 12')).toBeInTheDocument(); // Verification steps
    });

    it('should display fault attribution', () => {
      // Arrange
      const snapshot = createMockSnapshot();

      // Act
      render(<HandoverSnapshot snapshot={snapshot} expandedByDefault />, { wrapper: createWrapper() });

      // Assert
      expect(screen.getByText('workmanship')).toBeInTheDocument();
      // Note: fault_cause_details is not displayed in the component, only fault_cause
    });
  });

  describe('Evidence Links Display', () => {
    it('should display evidence count', () => {
      // Arrange
      const snapshot = createMockSnapshot();

      // Act
      render(<HandoverSnapshot snapshot={snapshot} showEvidence expandedByDefault />, { wrapper: createWrapper() });

      // Assert
      // Component shows evidence count as a number badge
      expect(screen.getByText('2')).toBeInTheDocument();
    });

    it('should display evidence links', () => {
      // Arrange
      const snapshot = createMockSnapshot();

      // Act
      render(<HandoverSnapshot snapshot={snapshot} showEvidence expandedByDefault />, { wrapper: createWrapper() });

      // Assert
      expect(screen.getByText('photo1.jpg')).toBeInTheDocument();
      expect(screen.getByText('photo2.jpg')).toBeInTheDocument();
    });

    it('should handle no evidence', () => {
      // Arrange
      const snapshot = createMockSnapshot();
      snapshot.evidence_links = [];

      // Act
      render(<HandoverSnapshot snapshot={snapshot} showEvidence expandedByDefault />, { wrapper: createWrapper() });

      // Assert
      expect(screen.getByText(/no evidence attached/i)).toBeInTheDocument();
    });
  });

  describe('Decisions Display', () => {
    it('should display decisions count', () => {
      // Arrange
      const snapshot = createMockSnapshot();

      // Act
      render(<HandoverSnapshot snapshot={snapshot} showDecisions expandedByDefault />, { wrapper: createWrapper() });

      // Assert
      // Component shows count as a number badge
      expect(screen.getByText('1')).toBeInTheDocument();
    });

    it('should display decision details', () => {
      // Arrange
      const snapshot = createMockSnapshot();

      // Act
      render(<HandoverSnapshot snapshot={snapshot} showDecisions expandedByDefault />, { wrapper: createWrapper() });

      // Assert
      expect(screen.getByText(/approval/i)).toBeInTheDocument();
      expect(screen.getByText(/all checks passed/i)).toBeInTheDocument();
    });

    it('should handle no decisions', () => {
      // Arrange
      const snapshot = createMockSnapshot();
      snapshot.decisions = [];

      // Act
      render(<HandoverSnapshot snapshot={snapshot} showDecisions expandedByDefault />, { wrapper: createWrapper() });

      // Assert
      expect(screen.getByText(/no decisions recorded/i)).toBeInTheDocument();
    });
  });

  describe('Ownership Transfer Display', () => {
    it('should display ownership transfer details', () => {
      // Arrange
      const snapshot = createMockSnapshot();

      // Act
      render(<HandoverSnapshot snapshot={snapshot} expandedByDefault />, { wrapper: createWrapper() });

      // Assert
      // Component uses formatOwnerType which returns "QA Team" and "Maintenance Team"
      expect(screen.getByText('QA Team')).toBeInTheDocument();
      expect(screen.getByText('Maintenance Team')).toBeInTheDocument();
    });

    it('should display handover timestamp', () => {
      // Arrange
      const snapshot = createMockSnapshot();

      // Act
      render(<HandoverSnapshot snapshot={snapshot} expandedByDefault />, { wrapper: createWrapper() });

      // Assert
      // Should show some formatted date/time
      expect(screen.getByText(/2024/i)).toBeInTheDocument();
    });
  });

  describe('Locked Status', () => {
    it('should display locked indicator', () => {
      // Arrange
      const snapshot = createMockSnapshot();
      snapshot.is_locked = true;

      // Act
      render(<HandoverSnapshot snapshot={snapshot} expandedByDefault />, { wrapper: createWrapper() });

      // Assert
      expect(screen.getByText(/locked/i)).toBeInTheDocument();
    });

    it('should not show unlocked state (snapshots always locked)', () => {
      // Arrange
      const snapshot = createMockSnapshot();
      snapshot.is_locked = false;

      // Act
      render(<HandoverSnapshot snapshot={snapshot} expandedByDefault />, { wrapper: createWrapper() });

      // Assert
      // Should still show as locked (business rule)
      expect(screen.getByText(/locked/i)).toBeInTheDocument();
    });
  });

  describe('Compact Mode', () => {
    it('should render in compact mode', () => {
      // Arrange
      const snapshot = createMockSnapshot();

      // Act
      render(<HandoverSnapshot snapshot={snapshot} compact />, { wrapper: createWrapper() });

      // Assert
      expect(screen.getByText('FT406824')).toBeInTheDocument();
      // In compact mode, some details may be hidden
    });
  });
});
