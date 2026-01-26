/**
 * Fleet Portal Types
 *
 * Type definitions for the plate-based portal authentication system.
 */

/**
 * Portal session data stored in httpOnly cookie
 */
export interface PortalSession {
  sessionId: string;
  vehicleId: string;
  vehicleRegistration: string;
  driverId: string | null;
  driverName: string | null;
  driverPhone: string | null;
  createdAt: string;
  expiresAt: string;
}

/**
 * Vehicle info returned after plate authentication
 */
export interface PortalVehicle {
  id: string;
  registration: string;
  make: string | null;
  model: string | null;
  year: number | null;
  vehicleType: string;
  color: string | null;
  assignedDriver: {
    name: string;
    idNumber: string | null;
    phone: string | null;
  } | null;
  lastOdometer: {
    reading: number;
    recordedAt: string;
    source: string;
  } | null;
  lastFuel: {
    level: number;
    recordedAt: string;
    source: string;
  } | null;
  lastCheckIn: {
    id: string;
    checkType: string;
    status: string;
    completedAt: string;
    completedBy: string | null;
  } | null;
}

/**
 * Driver info from portal session
 */
export interface PortalDriver {
  id: string | null;
  name: string;
  phone: string | null;
}

/**
 * Result from plate-auth API
 */
export interface PlateAuthResult {
  success: boolean;
  extractedPlate: string;
  confidence: number;
  error?: string;
  session?: {
    sessionId: string;
    expiresAt: string;
  };
  vehicle?: PortalVehicle;
  driver?: PortalDriver;
}

/**
 * Portal context value for React context
 */
export interface PortalContextValue {
  session: PortalSession | null;
  vehicle: PortalVehicle | null;
  driver: PortalDriver | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  error: string | null;
  authenticate: (platePhotoBase64: string) => Promise<PlateAuthResult>;
  logout: () => void;
  refreshSession: () => Promise<void>;
}
