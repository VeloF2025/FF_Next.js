/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SerialTimeline } from '../SerialTimeline';

describe('SerialTimeline', () => {
  it('renders empty state when entries is empty', () => {
    render(<SerialTimeline entries={[]} hasRealEvents={false} />);
    expect(screen.getByText(/no lifecycle data recorded/i)).toBeInTheDocument();
  });
});
