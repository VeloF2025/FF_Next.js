export interface GpsCoordinates {
  latitude: number;
  longitude: number;
}

export interface LocationData {
  city: string;
  region: string;
  province: string;
  coordinates: GpsCoordinates;
}

import type { UseFormReturn } from 'react-hook-form';
import type { FormData } from '../../../types';

export interface BasicInfoStepProps {
  form: UseFormReturn<FormData>;
  clients: Array<{ id: string; name: string }>;
  isClientsLoading: boolean;
}

export interface GpsState {
  isGeocoding: boolean;
  geocodingError: string | null;
  gpsInput: string;
}