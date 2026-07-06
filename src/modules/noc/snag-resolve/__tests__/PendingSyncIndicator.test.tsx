import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PendingSyncIndicator } from '../PendingSyncIndicator';

describe('PendingSyncIndicator', () => {
  it('renders nothing when count is 0', () => {
    const { container } = render(<PendingSyncIndicator count={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a negative count', () => {
    const { container } = render(<PendingSyncIndicator count={-1} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a singular status message when count is 1', () => {
    render(<PendingSyncIndicator count={1} />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('1 step completion saved on this device');
    expect(status).toHaveTextContent(/sync automatically/i);
  });

  it('renders a pluralised status message when count is greater than 1', () => {
    render(<PendingSyncIndicator count={3} />);
    expect(screen.getByRole('status')).toHaveTextContent('3 step completions saved on this device');
  });

  it('renders nothing when both step and photo counts are 0', () => {
    const { container } = render(<PendingSyncIndicator count={0} photoCount={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a queued-photo badge (singular) when photoCount is 1', () => {
    render(<PendingSyncIndicator count={0} photoCount={1} />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('1 photo saved on this device');
    expect(status).toHaveTextContent(/upload automatically/i);
  });

  it('pluralises the photo badge and shows both badges together', () => {
    render(<PendingSyncIndicator count={2} photoCount={3} />);
    const statuses = screen.getAllByRole('status');
    expect(statuses).toHaveLength(2);
    expect(statuses.map((s) => s.textContent).join(' ')).toContain('2 step completions saved on this device');
    expect(statuses.map((s) => s.textContent).join(' ')).toContain('3 photos saved on this device');
  });
});
