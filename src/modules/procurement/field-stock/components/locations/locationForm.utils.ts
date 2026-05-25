import type { CreateLocationInput, LocationType } from '../../types';

export interface LocationFormValue {
  name: string;
  code: string;
  locationType: LocationType;
  address: string;
  lat: string;            // kept as string for controlled inputs; parsed on submit
  lng: string;
  parentId: string;       // '' = no parent
  assignedToName: string;
  assignedToPhone: string;
}

export function generateCode(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  if (words.length === 1) return words[0]!.substring(0, 8).toUpperCase();
  return words.map((w) => w.substring(0, 4)).join('-').substring(0, 15).toUpperCase();
}

/** Build a CreateLocationInput from form state (coords parsed, blanks dropped). */
export function toCreateInput(v: LocationFormValue): CreateLocationInput {
  const lat = parseFloat(v.lat);
  const lng = parseFloat(v.lng);
  const coordinates =
    Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : undefined;
  return {
    name: v.name.trim(),
    code: v.code.trim().toUpperCase(),
    locationType: v.locationType,
    address: v.address.trim() || undefined,
    coordinates,
    parentId: v.parentId || undefined,
    assignedToName: v.assignedToName.trim() || undefined,
    assignedToPhone: v.assignedToPhone.trim() || undefined,
  };
}

export const EMPTY_LOCATION_FORM: LocationFormValue = {
  name: '', code: '', locationType: 'warehouse', address: '',
  lat: '', lng: '', parentId: '', assignedToName: '', assignedToPhone: '',
};
