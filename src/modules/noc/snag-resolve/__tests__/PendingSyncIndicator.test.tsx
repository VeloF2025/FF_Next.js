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
});
