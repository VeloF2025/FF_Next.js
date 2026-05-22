/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SerialSearch } from '../SerialSearch';

describe('SerialSearch', () => {
  it('renders search input prefilled from initialFilters.q', () => {
    render(
      <SerialSearch
        initialFilters={{ q: 'SN-12345' }}
        onFiltersChange={vi.fn()}
      />
    );
    const input = screen.getByRole('searchbox', { name: /serial or mac/i }) as HTMLInputElement;
    expect(input.value).toBe('SN-12345');
  });
});
