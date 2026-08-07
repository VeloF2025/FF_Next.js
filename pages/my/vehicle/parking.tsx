/**
 * /my/vehicle/parking — the driver's overnight parking address.
 *
 * Four states, one at a time: no address, pending request, approved address,
 * and the capture flow that produces a request. A rejection notice rides above
 * whichever state applies, because the manager's reason is the thing the
 * driver needs before they resubmit.
 *
 * Design: docs/superpowers/specs/2026-08-04-fleet-parking-compliance-design.md §8
 */
import type { NextPage } from 'next';
import React from 'react';

import { MyPortalShell } from '@/modules/attendance/portal/client/MyPortalShell';
import { ParkingCapture } from '@/modules/fleet/parking/client/ParkingCapture';
import {
  ActiveState,
  NoAddressState,
  PendingState,
  RejectedNotice,
} from '@/modules/fleet/parking/client/ParkingStates';
import {
  ParkingApiError,
  fetchParkingState,
  withdrawDeclaration,
} from '@/modules/fleet/parking/client/parkingApi';
import type { DriverParkingState } from '@/modules/fleet/parking/types';

const ParkingPage: NextPage & { getLayout?: (p: React.ReactElement) => React.ReactElement } = () => {
  const [state, setState] = React.useState<DriverParkingState | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [capturing, setCapturing] = React.useState(false);
  const [withdrawing, setWithdrawing] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setState(await fetchParkingState());
    } catch (err) {
      setError(
        err instanceof ParkingApiError && err.status === 404
          ? 'You do not have a vehicle assigned, so there is nothing to register here.'
          : 'Could not load your parking address. Reload the page to try again.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const withdraw = async () => {
    setWithdrawing(true);
    try {
      await withdrawDeclaration();
      await load();
    } catch (err) {
      setError(err instanceof ParkingApiError ? err.message : 'Could not withdraw the request.');
    } finally {
      setWithdrawing(false);
    }
  };

  // Only surface a rejection that is still the newest thing that happened:
  // once a request is approved or a new one is open, the old refusal is noise.
  const lastRejection =
    state && !state.pending && !state.active
      ? (state.history.find((h) => h.status === 'rejected') ?? null)
      : null;

  return (
    <MyPortalShell title="Vehicle parking">
      <div className="space-y-4">
        {loading && <p className="text-sm text-neutral-400">Loading…</p>}

        {error && !loading && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3">
            <p className="text-xs text-red-100">{error}</p>
          </div>
        )}

        {state && !loading && (
          <>
            {lastRejection && <RejectedNotice declaration={lastRejection} />}

            {capturing ? (
              <ParkingCapture
                registration={state.vehicle.registration}
                isChange={state.active !== null}
                onDone={() => {
                  setCapturing(false);
                  void load();
                }}
                onCancel={() => setCapturing(false)}
              />
            ) : state.pending ? (
              <PendingState
                declaration={state.pending}
                onWithdraw={withdraw}
                withdrawing={withdrawing}
              />
            ) : state.active ? (
              <ActiveState declaration={state.active} onChange={() => setCapturing(true)} />
            ) : (
              <NoAddressState
                registration={state.vehicle.registration}
                onStart={() => setCapturing(true)}
              />
            )}
          </>
        )}
      </div>
    </MyPortalShell>
  );
};

ParkingPage.getLayout = (page: React.ReactElement) => page;

export const getServerSideProps = async () => ({ props: {} });

export default ParkingPage;
