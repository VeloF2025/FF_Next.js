/**
 * Row shape returned by the /serials/search API (JSON boundary), mirrored on
 * the client. Lives in the types layer so both the fetch hook and the
 * presentational table import it from one canonical place (avoids a
 * hook→component dependency).
 *
 * KEEP IN SYNC with serialSearchService.ts → SerialSearchRow. The legacy
 * serials/index.tsx keeps its own local copy (pre-existing debt); this is the
 * shared one used by the drill-down surfaces.
 */
export interface SerialSearchRowView {
  id: string;
  serialNumber: string;
  macAddress: string | null;
  category: string | null;
  itemName: string | null;
  status: string;
  currentLocationName: string | null;
  allocatedProjectName: string | null;
  installedAtDropNumber: string | null;
  lastEventType: string | null;
  lastEventAt: string | null;
}
