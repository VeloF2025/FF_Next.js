/**
 * useStoresSession — session loading + role gate for /my/stores pages.
 *
 * Extracted from pages/my/stores/index.tsx and pages/my/stores/issue/index.tsx
 * which had identical session-loading boilerplate. Both pages are now thin shells
 * that call this hook and switch on state.
 *
 * Role gate delegates to isStoresAuthorised (STORES_ROLES from storesRoles.ts).
 *
 * Cancellation: the fetch effect uses a boolean flag so state updates are
 * skipped if the component unmounts before the request completes.
 */

import { useState, useEffect } from 'react';
import { getSession } from '@/modules/attendance/portal/client/api';
import type { AttendanceProfile } from '@/modules/attendance/portal/client/api';
import { isStoresAuthorised } from '@/modules/field-stock-pwa/lib/storesRoles';

// =============================================================================
// Return type
// =============================================================================

export type StoresSessionState =
  | 'loading'
  | 'guest'
  | 'authorised'
  | 'unauthorised'
  | 'error';

export interface UseStoresSessionResult {
  state: StoresSessionState;
  profile: AttendanceProfile | null;
  error: string | null;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Loads the current /my portal session and evaluates the STORES_ROLES gate.
 *
 * State transitions:
 *   loading → guest       (no valid session cookie)
 *   loading → authorised  (valid session, profile.role in STORES_ROLES)
 *   loading → unauthorised (valid session, but role not in STORES_ROLES)
 *   loading → error       (network or server error)
 */
export function useStoresSession(): UseStoresSessionResult {
  const [state, setState] = useState<StoresSessionState>('loading');
  const [profile, setProfile] = useState<AttendanceProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    getSession()
      .then((res) => {
        if (cancelled) return;
        if (!res.session || !res.profile) {
          setState('guest');
          return;
        }
        setProfile(res.profile);
        setState(
          isStoresAuthorised(res.profile.role, res.profile.authRole)
            ? 'authorised'
            : 'unauthorised',
        );
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Session check failed');
        setState('error');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { state, profile, error };
}
