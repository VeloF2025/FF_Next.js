/**
 * Portal Session Hook
 *
 * React hook for managing portal authentication state on the client side.
 * Handles plate-based authentication without requiring traditional login.
 */

import { useState, useCallback, useEffect } from 'react';
import type {
  PortalSession,
  PortalVehicle,
  PortalDriver,
  PlateAuthResult,
} from './types';

interface UsePortalSessionReturn {
  // State
  session: PortalSession | null;
  vehicle: PortalVehicle | null;
  driver: PortalDriver | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  error: string | null;

  // Actions
  authenticateWithPlate: (platePhotoBase64: string) => Promise<PlateAuthResult>;
  logout: () => void;
  clearError: () => void;
}

/**
 * Hook for portal session management
 *
 * @example
 * ```tsx
 * const { isAuthenticated, vehicle, authenticateWithPlate } = usePortalSession();
 *
 * // Authenticate by scanning plate
 * const result = await authenticateWithPlate(base64Photo);
 * if (result.success) {
 *   // User is now authenticated, vehicle data is available
 * }
 * ```
 */
export function usePortalSession(): UsePortalSessionReturn {
  const [session, setSession] = useState<PortalSession | null>(null);
  const [vehicle, setVehicle] = useState<PortalVehicle | null>(null);
  const [driver, setDriver] = useState<PortalDriver | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Check for existing session on mount
  useEffect(() => {
    async function checkExistingSession() {
      try {
        const response = await fetch('/api/fleet/portal/session');
        const data = await response.json();

        if (response.ok && data.data?.session) {
          setSession(data.data.session);
          setVehicle(data.data.vehicle || null);
          setDriver(data.data.driver || null);
        }
      } catch {
        // No existing session, that's fine
      } finally {
        setIsLoading(false);
      }
    }

    checkExistingSession();
  }, []);

  // Authenticate with plate photo (with retry for network failures)
  const authenticateWithPlate = useCallback(
    async (platePhotoBase64: string): Promise<PlateAuthResult> => {
      setIsLoading(true);
      setError(null);

      const MAX_RETRIES = 2;
      const requestBody = JSON.stringify({ platePhotoBase64 });

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const response = await fetch('/api/fleet/portal/plate-auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: requestBody,
          });

          const data = await response.json();
          const result = data.data as PlateAuthResult;

          if (response.ok && (data.success || result?.success)) {
            // Session cookie is set automatically by the API
            // Update local state with the returned data
            if (result.session) {
              setSession({
                sessionId: result.session.sessionId,
                vehicleId: result.vehicle?.id || '',
                vehicleRegistration: result.vehicle?.registration || '',
                driverId: result.driver?.id || null,
                driverName: result.driver?.name || null,
                driverPhone: result.driver?.phone || null,
                createdAt: new Date().toISOString(),
                expiresAt: result.session.expiresAt,
                ...(result.session.source ? { source: result.session.source } : {}),
              });
            }

            if (result.vehicle) {
              setVehicle(result.vehicle);
            }

            if (result.driver) {
              setDriver(result.driver);
            }

            return { ...result, success: true };
          } else {
            // Server returned an error - don't retry these
            const rawError = result?.error || data.error || 'Authentication failed';
            const errorMsg = typeof rawError === 'object' ? (rawError.message || JSON.stringify(rawError)) : String(rawError);
            setError(errorMsg);
            setIsLoading(false);
            return {
              success: false,
              extractedPlate: result?.extractedPlate || '',
              confidence: result?.confidence || 0,
              error: errorMsg,
            };
          }
        } catch (err) {
          const isNetworkError = err instanceof TypeError && (
            err.message === 'Failed to fetch' ||
            err.message === 'NetworkError when attempting to fetch resource.' ||
            err.message === 'Network request failed' ||
            err.message.includes('network')
          );

          // Retry on network errors, but not on other errors
          if (isNetworkError && attempt < MAX_RETRIES) {
            // Wait before retry: 2s, then 4s
            await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 2000));
            continue;
          }

          const errorMsg = isNetworkError
            ? 'NETWORK_ERROR'
            : (err instanceof Error ? err.message : 'Unknown error');
          setError(errorMsg);
          setIsLoading(false);
          return {
            success: false,
            extractedPlate: '',
            confidence: 0,
            error: errorMsg,
          };
        }
      }

      // Should not reach here, but just in case
      setIsLoading(false);
      return {
        success: false,
        extractedPlate: '',
        confidence: 0,
        error: 'NETWORK_ERROR',
      };
    },
    []
  );

  // Logout - clear session
  const logout = useCallback(async () => {
    try {
      await fetch('/api/fleet/portal/logout', { method: 'POST' });
    } catch {
      // Ignore logout errors
    }

    setSession(null);
    setVehicle(null);
    setDriver(null);
  }, []);

  // Clear error
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    session,
    vehicle,
    driver,
    isLoading,
    isAuthenticated: !!session,
    error,
    authenticateWithPlate,
    logout,
    clearError,
  };
}
