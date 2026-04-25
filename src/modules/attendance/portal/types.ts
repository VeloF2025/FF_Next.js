/**
 * Attendance /my portal — shared types
 */

export type LoginMethod = 'pin' | 'password';

/** Session payload stored inside the HMAC-signed cookie. */
export interface AttendanceSession {
  sessionId: string;        // UUID of the attendance_auth_sessions row
  staffId: string;
  staffName: string;
  method: LoginMethod;
  createdAt: string;        // ISO
  expiresAt: string;        // ISO
}

/** Public staff profile returned by /api/my/session. */
export interface AttendanceSessionProfile {
  staffId: string;
  name: string;
  phone: string | null;
  email: string | null;
  homeSiteId: string | null;
  hasAssignedVehicle: boolean;
  profilePhotoUrl: string | null;
}
