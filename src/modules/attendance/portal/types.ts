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

/** Staff role values matching the `role` column on the `staff` table. */
export type StaffRole = 'technician' | 'stores' | 'supervisor' | 'admin' | 'driver' | 'office';

/** Account lifecycle status matching the `account_status` column on the `staff` table. */
export type AccountStatus = 'pending' | 'active' | 'suspended';

/** Public staff profile returned by /api/my/session. */
export interface AttendanceSessionProfile {
  staffId: string;
  name: string;
  phone: string | null;
  email: string | null;
  homeSiteId: string | null;
  hasAssignedVehicle: boolean;
  profilePhotoUrl: string | null;
  /** Staff role — null when the column is not yet populated for legacy rows. */
  role: StaffRole | null;
  /** Account lifecycle status — always populated; defaults to 'active' for legacy rows. */
  accountStatus: AccountStatus;
}
