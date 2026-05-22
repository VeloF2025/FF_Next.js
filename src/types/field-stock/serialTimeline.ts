import type { TimelineEntry } from './timelineEntry';

export interface SerialDetail {
  id: string;
  serialNumber: string;
  macAddress: string | null;
  category: string | null;
  itemName: string | null;
  status: string;
  currentLocationName: string | null;
  allocatedProjectName: string | null;
  installedAtDropNumber: string | null;
  installedDate: string | null;
  receivedDate: string | null;
  activatedAtOltId: string | null;
}

export interface TimelineResult {
  serial: SerialDetail;
  entries: TimelineEntry[];
  hasRealEvents: boolean;
}
