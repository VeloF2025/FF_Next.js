import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PhotoNotSavedBanner } from '../PhotoNotSavedBanner';

describe('PhotoNotSavedBanner', () => {
  it('renders nothing when show is false', () => {
    const { container } = render(<PhotoNotSavedBanner show={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders an emphatic failure alert when show is true', () => {
    render(<PhotoNotSavedBanner show />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Photo not saved on this device');
    expect(alert.textContent).toContain('Reconnect to free space');
  });
});
