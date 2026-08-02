import { describe, expect, it } from 'vitest';

import {
  DayExceptionWorkflowError,
  validateApprovedHours,
} from '../dayExceptionDecisionValidation';

describe('supervisor approval bucket validation', () => {
  it('rejects a mixed ordinary and Sunday approval before persistence', () => {
    expect(() => validateApprovedHours(
      { regular: 5, overtime: 0, sunday: 5, holiday: 0, leave: 0, unpaid: 0 },
      null,
    )).toThrowError(expect.objectContaining<Partial<DayExceptionWorkflowError>>({ code: 'invalid_hours' }));
  });

  it('rejects classification buckets that contradict the selected absence', () => {
    expect(() => validateApprovedHours(
      { regular: 8, overtime: 0, sunday: 0, holiday: 0, leave: 8, unpaid: 0 },
      'approved_leave',
    )).toThrowError(expect.objectContaining<Partial<DayExceptionWorkflowError>>({ code: 'invalid_hours' }));
  });

  it('accepts ordinary plus overtime as one worked family', () => {
    expect(() => validateApprovedHours(
      { regular: 8, overtime: 1.5, sunday: 0, holiday: 0, leave: 0, unpaid: 0 },
      null,
    )).not.toThrow();
  });
});
