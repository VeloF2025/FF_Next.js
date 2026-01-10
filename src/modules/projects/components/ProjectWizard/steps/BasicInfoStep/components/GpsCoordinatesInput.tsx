import { MapPin, Loader2 } from 'lucide-react';
import type { GpsState } from '../types/basicInfo.types';

interface GpsCoordinatesInputProps {
  register: any;
  errors: any;
  gpsState: GpsState;
  onGetCurrentLocation: () => void;
  onGpsInputParse: () => void;
  onGpsInputChange: (value: string) => void;
}

export function GpsCoordinatesInput({ 
  register, 
  errors, 
  gpsState, 
  onGetCurrentLocation, 
  onGpsInputParse, 
  onGpsInputChange 
}: GpsCoordinatesInputProps) {
  const { isGeocoding, geocodingError, gpsInput } = gpsState;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="block text-sm font-medium text-[var(--ff-text-primary)]">
          GPS Coordinates *
        </label>
        <button
          type="button"
          onClick={onGetCurrentLocation}
          disabled={isGeocoding}
          className="inline-flex items-center px-3 py-1 text-xs font-medium text-blue-600 bg-blue-500/20 border border-blue-500/30 rounded-md hover:bg-blue-500/30 disabled:opacity-50"
        >
          {isGeocoding ? (
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
          ) : (
            <MapPin className="w-3 h-3 mr-1" />
          )}
          Use Current Location
        </button>
      </div>

      {/* GPS Input - Any Format */}
      <div className="mb-4 p-3 bg-blue-500/20 border border-blue-500/30 rounded-md">
        <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
          Paste GPS Coordinates (Any Format)
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={gpsInput}
            onChange={(e) => onGpsInputChange(e.target.value)}
            placeholder="e.g., -34.031085, 18.463559 or 33.9221° S, 18.4231° E"
            className="flex-1 px-3 py-2 text-sm border border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={onGpsInputParse}
            disabled={!gpsInput.trim() || isGeocoding}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Parse
          </button>
        </div>
        <p className="mt-1 text-xs text-[var(--ff-text-secondary)]">
          Supports: decimal (-34.031, 18.463), DMS (33°55'19" S, 18°25'23" E), and more
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <input
            {...register('location.coordinates.latitude' as any, {
              required: 'Latitude is required',
              pattern: {
                value: /^-?([1-8]?[0-9]\.{1}\d{1,6}$|90\.{1}0{1,6}$)/,
                message: 'Enter valid latitude (-35 to -22 for SA)'
              }
            })}
            type="number"
            step="any"
            className="w-full px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Latitude (e.g., -26.195246)"
          />
          {errors.location?.coordinates?.latitude && (
            <p className="mt-1 text-sm text-red-600">{errors.location.coordinates.latitude.message}</p>
          )}
        </div>

        <div>
          <input
            {...register('location.coordinates.longitude' as any, {
              required: 'Longitude is required',
              pattern: {
                value: /^-?(([-+]?)([\d]{1,3})((\.)(\d+))?)/,
                message: 'Enter valid longitude (16 to 33 for SA)'
              }
            })}
            type="number"
            step="any"
            className="w-full px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Longitude (e.g., 28.034088)"
          />
          {errors.location?.coordinates?.longitude && (
            <p className="mt-1 text-sm text-red-600">{errors.location.coordinates.longitude.message}</p>
          )}
        </div>
      </div>
      
      {geocodingError && (
        <p className="mt-1 text-sm text-red-600">{geocodingError}</p>
      )}
      
      {isGeocoding && (
        <div className="mt-2 flex items-center text-sm text-blue-600">
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          Looking up location information...
        </div>
      )}
    </div>
  );
}