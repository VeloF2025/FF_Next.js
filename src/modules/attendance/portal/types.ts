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
  /**
   * Auth-tier role from the `users` table (AuthRole), surfaced via the
   * staff.user_id → users.id join in /api/my/session.
   *
   * Null when the staff row has no user_id link (e.g. PIN-only field staff
   * who were never given a web-app account). In that case the gate falls back
   * to the staff.role check only.
   *
   * Values: 'super_admin' | 'system' | 'admin' | 'manager' | 'storeman' |
   *         'technician' | 'viewer' (mirrors AuthRole in src/lib/auth/types.ts)
   */
  authRole: string | null;
}
