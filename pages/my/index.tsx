/**
 * /my — root entry for the Velocity Fibre staff portal.
 *
 * Renders one of three states based on the current portal session:
 *   - loading  → blank shell (avoids flicker between SSR and first session check)
 *   - guest    → MyLoginScreen (extracted from this file in PRD-040 PR 2)
 *   - authed   → MyHub tile grid
 *
 * Session is checked client-side via /api/my/session. SSR renders the
 * loading shell so the page is cacheable in the SW without leaking
 * authed/guest state into the cached HTML.
 */

import React from 'react';
import { NextPage } from 'next';

import { getSession } from '@/modules/attendance/portal/client/api';
import type {
  AttendanceProfile,
  SessionResponse,
} from '@/modules/attendance/portal/client/api';
import { MyPortalShell } from '@/modules/attendance/portal/client/MyPortalShell';
import { MyLoginScreen } from '@/modules/attendance/portal/client/MyLoginScreen';
import { MyHub } from '@/modules/attendance/portal/client/MyHub';

type SessionState =
  | { kind: 'loading' }
  | { kind: 'guest' }
  | { kind: 'authed'; profile: AttendanceProfile };

const MyIndexPage: NextPage & { getLayout?: (page: React.ReactElement) => React.ReactElement } = () => {
  const [state, setState] = React.useState<SessionState>({ kind: 'loading' });

  React.useEffect(() => {
    let cancelled = false;
    getSession()
      .then((res: SessionResponse) => {
        if (cancelled) return;
        if (res.session && res.profile) {
          setState({ kind: 'authed', profile: res.profile });
        } else {
          setState({ kind: 'guest' });
        }
      })
      .catch(() => {
        // A failed session check is treated as guest — the worst-case UX
        // is the user re-enters credentials, vs. trapping them on a
        // blank loading screen if the server is briefly unreachable.
        if (!cancelled) setState({ kind: 'guest' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === 'loading') {
    return (
      <MyPortalShell title="Loading" showFooterNav={false} showHeader={false}>
        <div className="flex items-center justify-center pt-24 text-sm text-neutral-400">
          Loading…
        </div>
      </MyPortalShell>
    );
  }

  if (state.kind === 'guest') {
    return <MyLoginScreen />;
  }

  return <MyHub profile={state.profile} />;
};

// No AppLayout — full-screen portal.
MyIndexPage.getLayout = (page: React.ReactElement) => page;

export default MyIndexPage;
