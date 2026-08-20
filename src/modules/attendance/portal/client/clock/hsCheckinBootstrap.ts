/**
 * Bootstrap fetch for the inline H&S declaration.
 *
 * Split out of HsCheckinSteps so the component stays under the size cap, and
 * so the timeout below is testable on its own.
 *
 * The timeout is the point of this module. The clock-in has already committed
 * by the time HsCheckinSteps mounts, and the component renders nothing while
 * this call is in flight — so a fetch that never settles (the ordinary failure
 * on a flaky mobile link, which no `.catch` ever sees) would leave the worker
 * on a blank screen with a recorded shift and no confirmation. Bounding the
 * wait turns that into the same fail-open path as a rejection.
 */

import type { CheckinActivityOption } from '@/modules/health-safety/components/checkin/CheckinPrompts';

export interface HsCheckinProject {
  id: string;
  project_name: string;
}

export type HsCheckinWorkLocation = 'site' | 'office';

export interface HsCheckinBootstrapData {
  completed: boolean;
  projects: HsCheckinProject[];
  activities: CheckinActivityOption[];
  defaultProjectId: string;
  /**
   * Null when the worker has no previous self declaration, or when the server
   * sent a location we do not recognise — an unknown value must not silently
   * pre-select one of the two real answers on a legal declaration.
   */
  defaultWorkLocation: HsCheckinWorkLocation | null;
  medicalStatus: string | null;
}

/** Long enough for a slow 3G round trip, short enough not to strand a worker. */
export const HS_BOOTSTRAP_TIMEOUT_MS = 10_000;

export async function fetchHsCheckinBootstrap(
  externalSignal: AbortSignal,
  timeoutMs: number = HS_BOOTSTRAP_TIMEOUT_MS
): Promise<HsCheckinBootstrapData> {
  const controller = new AbortController();
  const relayAbort = () => controller.abort();
  externalSignal.addEventListener('abort', relayAbort);
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    // Raced rather than left to the AbortSignal alone: aborting a fetch frees
    // the socket, but nothing guarantees the returned promise settles, and an
    // unsettled promise is exactly the hang this exists to bound.
    const expiry = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`bootstrap timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
    const res = await Promise.race([
      fetch('/api/my/hs/checkin', { credentials: 'include', signal: controller.signal }),
      expiry,
    ]);
    if (!res.ok) throw new Error(`bootstrap failed: ${res.status}`);
    const json = await res.json();
    const d = json?.data;
    if (!d) throw new Error('bootstrap returned no data');

    const rawLocation = d.default_work_location;
    const defaultProjectId: string = d.default_project_id ?? '';
    const defaultWorkLocation: HsCheckinWorkLocation | null =
      rawLocation === 'office'
        ? 'office'
        : // A site default is only usable with a project to go with it.
          rawLocation === 'site' && defaultProjectId
          ? 'site'
          : null;

    return {
      completed: Boolean(d.completed),
      projects: d.projects ?? [],
      activities: d.activities ?? [],
      defaultProjectId,
      defaultWorkLocation,
      medicalStatus: d.medical_status ?? null,
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    externalSignal.removeEventListener('abort', relayAbort);
  }
}
