import { useEffect, useState } from 'react';
import type { UseFormReturn, Path } from 'react-hook-form';
import type { FormData } from '../../../types';
import { reverseGeocode, getCurrentLocation, validateSouthAfricanGPS, parseGPSCoordinates } from '@/utils/geoLocation';
import type { GpsState } from '../types/basicInfo.types';
import { log } from '@/lib/logger';

export function useBasicInfoForm(form: UseFormReturn<FormData>) {
  const { watch, setValue } = form;
  const [gpsState, setGpsState] = useState<GpsState>({
    isGeocoding: false,
    geocodingError: null,
    gpsInput: ''
  });

  // Watch for changes in start date and duration
  const startDate = watch('startDate');
  const durationMonths = watch('durationMonths');
  
  // Watch for GPS coordinate changes
  const gpsLatitude = watch('location.coordinates.latitude' as Path<FormData>);
  const gpsLongitude = watch('location.coordinates.longitude' as Path<FormData>);

  // Calculate end date when start date or duration changes
  useEffect(() => {
    if (startDate && durationMonths && durationMonths > 0) {
      const start = new Date(startDate);
      const end = new Date(start);
      end.setMonth(start.getMonth() + durationMonths);
      
      // Format to YYYY-MM-DD for the date input
      const formattedEndDate = end.toISOString().split('T')[0] ?? '';
      setValue('endDate', formattedEndDate);
    }
  }, [startDate, durationMonths, setValue]);

  // Auto-populate location when GPS coordinates change
  useEffect(() => {
    async function populateLocation() {
      if (!gpsLatitude || !gpsLongitude) return;
      
      const lat = parseFloat(gpsLatitude);
      const lng = parseFloat(gpsLongitude);
      
      if (isNaN(lat) || isNaN(lng)) return;
      
      // Validate coordinates are in South Africa
      if (!validateSouthAfricanGPS(lat, lng)) {
        setGpsState(prev => ({ ...prev, geocodingError: 'Coordinates must be within South Africa' }));
        return;
      }

      setGpsState(prev => ({ ...prev, isGeocoding: true, geocodingError: null }));

      try {
        const locationData = await reverseGeocode(lat, lng);
        
        if (locationData) {
          setValue('location.city', locationData.city);
          setValue('location.province', locationData.province);
        } else {
          setGpsState(prev => ({ ...prev, geocodingError: 'Could not find location information' }));
        }
      } catch (error) {
        setGpsState(prev => ({ ...prev, geocodingError: 'Failed to lookup location' }));
        log.error('Geocoding error:', { data: error }, 'useBasicInfoForm');
      } finally {
        setGpsState(prev => ({ ...prev, isGeocoding: false }));
      }
    }

    populateLocation();
  }, [gpsLatitude, gpsLongitude, setValue]);

  // Get current location
  const handleGetCurrentLocation = async () => {
    setGpsState(prev => ({ ...prev, isGeocoding: true, geocodingError: null }));

    try {
      const position = await getCurrentLocation();
      setValue('location.coordinates.latitude' as Path<FormData>, position.lat);
      setValue('location.coordinates.longitude' as Path<FormData>, position.lng);
    } catch (error) {
      setGpsState(prev => ({ ...prev, geocodingError: 'Could not get current location' }));
      log.error('Geolocation error:', { data: error }, 'useBasicInfoForm');
    } finally {
      setGpsState(prev => ({ ...prev, isGeocoding: false }));
    }
  };

  // Parse GPS input from various formats
  const handleGpsInputParse = () => {
    if (!gpsState.gpsInput.trim()) return;

    const coords = parseGPSCoordinates(gpsState.gpsInput.trim());
    if (coords) {
      setValue('location.coordinates.latitude' as Path<FormData>, coords.lat);
      setValue('location.coordinates.longitude' as Path<FormData>, coords.lng);
      setGpsState(prev => ({ ...prev, gpsInput: '', geocodingError: null }));
    } else {
      setGpsState(prev => ({ 
        ...prev, 
        geocodingError: 'Could not parse GPS coordinates. Try formats like: "-34.031085, 18.463559" or "33.9221° S, 18.4231° E"' 
      }));
    }
  };

  const updateGpsInput = (value: string) => {
    setGpsState(prev => ({ ...prev, gpsInput: value }));
  };

  return {
    gpsState,
    handleGetCurrentLocation,
    handleGpsInputParse,
    updateGpsInput
  };
}