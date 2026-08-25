/**
 * Which project, if any, does a detected event belong to?
 *
 * `fleet_operational_incidents.project_id` drives the manager queue's scoping,
 * so getting this wrong hides an incident from the people who should see it —
 * and inventing one shows it to people it is not about. There is no vehicle→
 * project assignment that is true at an arbitrary instant, so the only honest
 * answer available is geographic: the project whose AOI the event happened in.
 *
 * `findNearestPlace` unions declared parking locations with project AOIs and
 * returns the closest within 500 m. Only the `project_aoi` kind carries a
 * project — `fleet_vehicle_parking_locations` has a vehicle and no project at
 * all — so a parking hit resolves to NULL rather than to something adjacent.
 * Null is a first-class answer here: an unattributed incident is visible to
 * everyone with fleet scope, which is the safe direction.
 */

import { log } from '@/lib/logger';
import { findNearestPlace, type NearestPlace } from '../trips/placeResolver';

const MODULE = 'FleetVehicleProjectResolver';

export type PlaceResolver = (lat: number, lon: number) => Promise<NearestPlace | null>;

/**
 * The project the coordinate sits in, or null.
 *
 * A failing lookup returns null and logs rather than throwing: project
 * attribution is an enrichment, and losing it must not stop the incident that
 * carries it from being opened.
 */
export async function resolveVehicleProjectId(
  lat: number | null, lon: number | null, resolvePlace: PlaceResolver = findNearestPlace,
): Promise<string | null> {
  if (lat === null || lon === null) return null;
  try {
    const place = await resolvePlace(lat, lon);
    if (!place || place.kind !== 'project_aoi') return null;
    return place.id;
  } catch (error) {
    log.warn(
      '[fleet-detectors] project attribution failed; opening the incident unattributed',
      { error: error instanceof Error ? error.message : String(error) },
      MODULE,
    );
    return null;
  }
}
