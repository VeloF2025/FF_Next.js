/**
 * /my/fleet/incidents/[incidentId] — a driver's own Fleet incident detail
 * and optional response (PR7 Task 7, design §14/§15).
 */
import React from 'react';
import type { NextPage } from 'next';
import { useRouter } from 'next/router';
import { ArrowLeft } from 'lucide-react';

import { ApiError, getSession, type SessionResponse } from '@/modules/attendance/portal/client/api';
import { MyPortalShell } from '@/modules/attendance/portal/client/MyPortalShell';
import { DriverIncidentDetail } from '@/modules/fleet/incidents/driver/web/DriverIncidentDetail';

const MyFleetIncidentDetailPage: NextPage & {
  getLayout?: (page: React.ReactElement) => React.ReactElement;
} = () => {
  const router = useRouter();
  const incidentId = typeof router.query.incidentId === 'string' ? router.query.incidentId : '';
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
      title="Incident"
      staffName={session?.profile?.name ?? null}
      staffPhotoUrl={session?.profile?.profilePhotoUrl ?? null}
    >
      <button
        type="button"
        onClick={() => router.push('/my/fleet/incidents')}
        className="mb-3 inline-flex touch-manipulation items-center gap-1 text-sm text-neutral-400 hover:text-neutral-200 active:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      {!session && !loadError && (
        <div className="flex items-center justify-center py-16 text-sm text-neutral-400">Loading…</div>
      )}
      {loadError && (
        <div role="alert" className="mb-4 rounded-lg border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-200">
          {loadError}
        </div>
      )}
      {session && incidentId && <DriverIncidentDetail incidentId={incidentId} />}
    </MyPortalShell>
  );
};

MyFleetIncidentDetailPage.getLayout = (page: React.ReactElement) => page;

export default MyFleetIncidentDetailPage;
