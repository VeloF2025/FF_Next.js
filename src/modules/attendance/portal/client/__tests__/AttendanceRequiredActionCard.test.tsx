import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AttendanceRequiredActionCard } from '../AttendanceRequiredActionCard';

describe('AttendanceRequiredActionCard', () => {
  it('explains the provisional cap and starts correction for the blocking exception', async () => {
    const user = userEvent.setup();
    const onCorrect = vi.fn();

    render(
      <AttendanceRequiredActionCard
        action={{
          exceptionId: 'ex-1',
          entryId: 'en-1',
          workDate: '2026-08-03',
          kind: 'missing_clock_out',
          provisionalPaidHours: 8,
          clockInAt: '2026-08-03T06:00:00.000Z',
        }}
        onCorrect={onCorrect}
      />
    );

    expect(
      screen.getByRole('heading', { name: /previous clock-out missing/i })
    ).toBeVisible();
    expect(screen.getByText(/provisional cap: 8 hours/i)).toBeVisible();

    const submit = screen.getByRole('button', { name: /submit clock-out correction/i });
    expect(submit.className).toContain('focus-visible:');
    expect(submit.className).toContain('active:');
    expect(submit.className).toContain('touch-manipulation');

    await user.click(submit);

    expect(onCorrect).toHaveBeenCalledWith('ex-1');
  });
});
