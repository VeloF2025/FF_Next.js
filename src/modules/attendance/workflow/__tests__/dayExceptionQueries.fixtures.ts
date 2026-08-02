import type { AuthUser } from '@/lib/auth/types';

export const EXCEPTION_ID = '11111111-1111-4111-8111-111111111111';
export const STAFF_A = '22222222-2222-4222-8222-222222222222';
export const STAFF_B = '33333333-3333-4333-8333-333333333333';
export const ENTRY_ID = '44444444-4444-4444-8444-444444444444';
export const ADJUSTMENT_ID = '55555555-5555-4555-8555-555555555555';
export const SUPERVISOR: AuthUser = {
  id: '66666666-6666-4666-8666-666666666666', userId: '66666666-6666-4666-8666-666666666666',
  email: 'supervisor@example.com', firstName: 'Site', lastName: 'Supervisor',
  name: 'Site Supervisor', role: 'manager', permissions: [], isActive: true,
};

export const QUEUE_ROW = {
  exception_id: EXCEPTION_ID, staff_id: STAFF_A, staff_name: 'Worker A', crew_name: 'Civil',
  work_date: '2026-07-31', entry_id: ENTRY_ID, kind: 'missing_clock_out', status: 'awaiting_supervisor',
  owner_user_id: SUPERVISOR.id, proposed_hours: { scheduledPaidHours: 8, proposedRegularHours: 8 },
  exception_classification: null, result_version: '4', created_at: '2026-08-01T06:00:00Z',
  clock_in_at: '2026-07-31T06:00:00Z', clock_out_at: null, clock_in_gps_available: true,
  clock_out_gps_available: false, selfie_in_available: true, selfie_out_available: false,
  selfie_in_url: '/storage/private-in.jpg', selfie_out_url: 'https://storage.example/private-out.jpg',
  site_id: 'site-1', site_name: 'Lawley', adjustment_id: ADJUSTMENT_ID,
  adjustment_kind: 'forgot_clock_out', adjusted_clock_in_at: null,
  adjusted_clock_out_at: '2026-07-31T15:00:00Z', adjustment_reason: 'Forgot at close',
  adjustment_status: 'pending', result_status: 'awaiting_supervisor', scheduled_paid_hrs: '8',
  recorded_elapsed_hrs: '9', proposed_regular_hrs: '8', proposed_overtime_hrs: '1',
  proposed_sunday_hrs: '0', proposed_holiday_hrs: '0', approved_regular_hrs: null,
  approved_overtime_hrs: null, approved_sunday_hrs: null, approved_holiday_hrs: null,
  leave_hrs: '0', unpaid_hrs: '0', attendance_classification: null, blocking_reasons: ['missing_clock_out'],
};
