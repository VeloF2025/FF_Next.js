import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import PlanningPageClient from '../client';

// Deny only planning.main/view: proves the gate is keyed to the correct permission.
// A mis-keyed gate (wrong key or action) would return true → board renders → test fails.
vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({
    can: (key: string, action: string = 'view') => !(key === 'planning.main' && action === 'view'),
    canAny: () => true,
    canAll: () => true,
    isLoading: false,
    permissions: [],
  }),
}));

// useUrlFilters touches next/navigation — stub it so the page renders in jsdom.
vi.mock('@/hooks/useUrlFilters', () => ({
  useUrlFilters: () => ({ filters: { project: '', stage: '', search: '' }, setFilter: vi.fn(), clearAll: vi.fn() }),
}));

describe('PlanningPageClient RBAC gate', () => {
  it('renders Access Denied and not the board when view is denied', () => {
    render(<PlanningPageClient />);
    expect(screen.getByText('Access Denied')).toBeTruthy();
    expect(screen.queryByText('New Planning Item')).toBeNull();
  });
});
