/**
 * /my/fleet/incidents — a driver's own Fleet incidents (PR7 Task 7,
 * design §14/§15). Session check mirrors `corrections.tsx`: any 401
 * anywhere punts back to `/my` to log in again.
 */
import React from 'react';
import type { NextPage } from 'next';
import { useRouter } from 'next/router';

import { ApiError, getSession, type SessionResponse } from '@/modules/attendance/portal/client/api';
import { MyPortalShell } from '@/modules/attendance/portal/client/MyPortalShell';
import { DriverIncidentList } from '@/modules/fleet/incidents/driver/web/DriverIncidentList';

const MyFleetIncidentsPage: NextPage & {
  getLayout?: (page: React.ReactElement) => React.ReactElement;
} = () => {
  const router = useRouter();
  const [session, setSession] = React.useState<SessionResponse | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sess = await getSession();
        if (cancelled) return;
        if (!sess.session) {
          await router.replace('/my');
          return;
        }
        setSession(sess);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          await router.replace('/my');
          return;
        }
        setLoadError(err instanceof Error ? err.message : 'Could not load your session.');
      }
    })();
    return () => { cancelled = true; };
  }, [router]);

  return (
    <MyPortalShell
      title="Fleet incidents"
      staffName={session?.profile?.name ?? null}
      staffPhotoUrl={session?.profile?.profilePhotoUrl ?? null}
    >
      {!session && !loadError && (
        <div className="flex items-center justify-center py-16 text-sm text-neutral-400">Loading…</div>
      )}
      {loadError && (
        <div role="alert" className="mb-4 rounded-lg border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-200">
          {loadError}
        </div>
      )}
      {session && <DriverIncidentList onUnauthorized={() => void router.replace('/my')} />}
    </MyPortalShell>
  );
};

MyFleetIncidentsPage.getLayout = (page: React.ReactElement) => page;

export default MyFleetIncidentsPage;
