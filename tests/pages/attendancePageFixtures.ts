export const profile = {
  staffId: 'staff-1',
  name: 'Jane Worker',
  phone: '+27110000000',
  email: null,
  homeSiteId: null,
  hasAssignedVehicle: false,
  profilePhotoUrl: null,
  role: 'technician' as const,
  accountStatus: 'active' as const,
  authRole: null,
};

export const requiredAction = {
  exceptionId: 'ex-1',
  entryId: 'en-1',
  workDate: '2026-08-03',
  kind: 'missing_clock_out' as const,
  provisionalPaidHours: 8,
  clockInAt: '2026-08-03T06:00:00.000Z',
};

export const session = {
  session: {
    sessionId: 'session-1',
    staffId: 'staff-1',
    method: 'pin' as const,
    expiresAt: '2026-08-04T10:00:00.000Z',
  },
  profile,
};

export const history = {
  entries: [{
    entryId: 'en-1',
    workDate: '2026-08-03',
    clockInAt: '2026-08-03T06:00:00.000Z',
    clockOutAt: null,
    status: 'auto_closed' as const,
    siteGeofenceId: null,
    vehicleAssignmentId: null,
    selfieInUrl: null,
    selfieOutUrl: null,
    durationMs: null,
  }],
  limit: 30,
};

export const hints = {
  forgot_clock_out: { label: 'Forgot clock-out', placeholder: 'Explain why the clock-out was missed', hint: 'Enter the time your shift ended.', minReasonChars: 10 },
  wrong_clock_in_time: { label: 'Wrong clock-in', placeholder: '', hint: '', minReasonChars: 10 },
  wrong_clock_out_time: { label: 'Wrong clock-out', placeholder: '', hint: '', minReasonChars: 10 },
  wrong_site: { label: 'Wrong site', placeholder: '', hint: '', minReasonChars: 10 },
  duplicate_entry: { label: 'Duplicate entry', placeholder: '', hint: '', minReasonChars: 10 },
  other: { label: 'Other', placeholder: '', hint: '', minReasonChars: 10 },
};

export function currentAttendance(overrides: Record<string, unknown> = {}) {
  return {
    workDate: '2026-08-04',
    open: null,
    schedule: {
      policyId: 'policy-1', timezone: 'Africa/Johannesburg', start: '08:00', end: '17:00',
      unpaidBreakMinutes: 60, scheduledPaidHours: 8,
    },
    result: { status: 'expected', recordedElapsedHours: null, scheduledPaidHours: 8 },
    requiredAttendanceAction: null,
    ...overrides,
  };
}
