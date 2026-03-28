
/**
 * Geolocation utilities for reverse geocoding in South Africa
 */

export interface LocationData {
  city: string;
  municipalDistrict: string;
  province: string;
}

/**
 * Reverse geocode GPS coordinates to get location information for South Africa
 */
export async function reverseGeocode(lat: number, lng: number): Promise<LocationData | null> {
  try {
    // Using Nominatim (OpenStreetMap) for free reverse geocoding
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&countrycodes=za&addressdetails=1&accept-language=en`,
      {
        headers: {
          'User-Agent': 'FibreFlow-Project-Management'
        }
      }
    );

    if (!response.ok) {
      throw new Error('Geocoding service unavailable');
    }

    const data = await response.json();

    if (!data || !data.address) {
      return null;
    }

    const address = data.address;

    // Extract location information for South Africa
    const city = 
      address.city || 
      address.town || 
      address.village || 
      address.suburb || 
      address.hamlet || 
      'Unknown City';

    // South African municipal districts (local municipalities)
    const municipalDistrict = 
      address.municipality ||
      address.county ||
      address.state_district ||
      extractMunicipalityFromDisplayName(data.display_name) ||
      'Unknown Municipality';

    // South African provinces
    const province = mapToSouthAfricanProvince(address.state || address.province);

    return {
      city: city.trim(),
      municipalDistrict: municipalDistrict.trim(),
      province: province
    };

  } catch (error) {
    // log.error('Reverse geocoding failed:', { data: error }, 'geoLocation');
    return null;
  }
}

/**
 * Map various province names to official South African province names
 */
function mapToSouthAfricanProvince(provinceName: string): string {
  if (!provinceName) return '';

  const name = provinceName.toLowerCase().trim();

  const provinceMap: Record<string, string> = {
    'eastern cape': 'Eastern Cape',
    'ec': 'Eastern Cape',
    'free state': 'Free State',
    'fs': 'Free State',
    'gauteng': 'Gauteng',
    'gp': 'Gauteng',
    'kwazulu-natal': 'KwaZulu-Natal',
    'kzn': 'KwaZulu-Natal',
    'limpopo': 'Limpopo',
    'lp': 'Limpopo',
    'mpumalanga': 'Mpumalanga',
    'mp': 'Mpumalanga',
    'northern cape': 'Northern Cape',
    'nc': 'Northern Cape',
    'north west': 'North West',
    'northwest': 'North West',
    'nw': 'North West',
    'western cape': 'Western Cape',
    'wc': 'Western Cape'
  };

  return provinceMap[name] || provinceName;
}

/**
 * Extract municipality from display name if not in address components
 */
function extractMunicipalityFromDisplayName(displayName: string): string | null {
  if (!displayName) return null;

  // Common patterns for South African municipalities
  const patterns = [
    /([A-Za-z\s]+)\s+Local\s+Municipality/i,
    /([A-Za-z\s]+)\s+Municipality/i,
    /([A-Za-z\s]+)\s+Metropolitan\s+Municipality/i,
    /([A-Za-z\s]+)\s+District\s+Municipality/i
  ];

  for (const pattern of patterns) {
    const match = displayName.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }

  return null;
}

/**
 * Validate GPS coordinates for South Africa
 */
export function validateSouthAfricanGPS(lat: number, lng: number): boolean {
  // South Africa bounds (approximate)
  const SA_BOUNDS = {
    minLat: -35.0,
    maxLat: -22.0,
    minLng: 16.0,
    maxLng: 33.0
  };

  return (
    lat >= SA_BOUNDS.minLat && 
    lat <= SA_BOUNDS.maxLat && 
    lng >= SA_BOUNDS.minLng && 
    lng <= SA_BOUNDS.maxLng
  );
}

/**
 * Parse GPS coordinates from various formats
 */
export function parseGPSCoordinates(input: string): { lat: number; lng: number } | null {
  if (!input || typeof input !== 'string') return null;

  const cleanInput = input.trim();

  // Format 1: "-34.031085438557376, 18.463559275830423"
  const decimalPair = cleanInput.match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
  if (decimalPair) {
    const lat = parseFloat(decimalPair[1]);
    const lng = parseFloat(decimalPair[2]);
    if (!isNaN(lat) && !isNaN(lng)) {
      return { lat, lng };
    }
  }

  // Format 2: DMS with direction — "25°59'14.8" S, 28°14'07.9" E" or "-25.96743N, 28.20015E"
  // Capture everything (including optional minus) up to a direction letter
  const dmsPattern = /(-?[\d°'′"″.\s]+)\s*([NSEW])\s*[,;]?\s*(-?[\d°'′"″.\s]+)\s*([NSEW])/i;
  const dmsMatch = cleanInput.match(dmsPattern);
  if (dmsMatch && dmsMatch.length >= 5) {
    const coord1 = dmsMatch[1];
    const dir1 = dmsMatch[2];
    const coord2 = dmsMatch[3];
    const dir2 = dmsMatch[4];

    // Type guard: ensure all captures are defined before proceeding
    if (coord1 !== undefined && dir1 !== undefined && coord2 !== undefined && dir2 !== undefined) {
      const lat = parseCoordinate(coord1.trim(), dir1);
      const lng = parseCoordinate(coord2.trim(), dir2);

      if (lat !== null && lng !== null) {
        return { lat, lng };
      }
    }
  }

  // Format 3: Single coordinate pair without separators "34.031085438557376 18.463559275830423"
  const spaceSeparated = cleanInput.match(/^(-?\d+\.?\d*)\s+(-?\d+\.?\d*)$/);
  if (spaceSeparated) {
    const lat = parseFloat(spaceSeparated[1]);
    const lng = parseFloat(spaceSeparated[2]);
    if (!isNaN(lat) && !isNaN(lng)) {
      return { lat: Math.abs(lat) * -1, lng }; // Assume SA coordinates (negative latitude)
    }
  }

  // Format 4: Try to extract two decimal numbers — only accept if they look like valid coordinates
  const allDecimals = cleanInput.match(/-?\d+\.\d+/g);
  if (allDecimals && allDecimals.length >= 2) {
    const lat = parseFloat(allDecimals[0]);
    const lng = parseFloat(allDecimals[1]);
    if (!isNaN(lat) && !isNaN(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { lat, lng };
    }
  }

  return null;
}

/**
 * Parse coordinate from DMS or decimal format with direction
 */
function parseCoordinate(coord: string, direction: string): number | null {
  const dir = direction.toUpperCase();
  const hasExplicitNegative = coord.trim().startsWith('-');
  // If coord already has a negative sign, respect it; otherwise use direction
  const multiplier = hasExplicitNegative ? -1 : (dir === 'S' || dir === 'W') ? -1 : 1;
  // Work with absolute value of the coordinate string
  const absCoord = coord.replace(/^-/, '').trim();

  // Try DMS format FIRST (degrees, minutes, seconds) — must check before decimal
  // Matches: 33°55'28.3", 25°59'14.8, 28d14m07.9s, etc.
  const dmsPattern = /(\d+)[°d]\s*(\d+(?:\.\d+)?)[′'m]\s*(\d+(?:\.\d+)?)[″"s]?/i;
  const dmsMatch = absCoord.match(dmsPattern);

  if (dmsMatch && dmsMatch[1] !== undefined && dmsMatch[2] !== undefined && dmsMatch[3] !== undefined) {
    const degrees = parseInt(dmsMatch[1]);
    const minutes = parseFloat(dmsMatch[2]) || 0;
    const seconds = parseFloat(dmsMatch[3]) || 0;

    const decimalDegrees = degrees + (minutes / 60) + (seconds / 3600);
    return decimalDegrees * multiplier;
  }

  // Try degrees + decimal minutes: 33°55.472'
  const dmPattern = /(\d+)[°d]\s*(\d+(?:\.\d+)?)[′'m]?/i;
  const dmMatch = absCoord.match(dmPattern);

  if (dmMatch && dmMatch[1] !== undefined && dmMatch[2] !== undefined) {
    const degrees = parseInt(dmMatch[1]);
    const minutes = parseFloat(dmMatch[2]) || 0;

    const decimalDegrees = degrees + (minutes / 60);
    return decimalDegrees * multiplier;
  }

  // Try decimal degrees: 33.9221° or just 33.9221
  const decimalOnly = absCoord.replace(/[°]/g, '').trim();
  const decimal = parseFloat(decimalOnly);
  if (!isNaN(decimal) && decimal < 360) {
    return decimal * multiplier;
  }

  return null;
}

/**
 * Get current location using browser geolocation API
 */
export function getCurrentLocation(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported by this browser'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude
        });
      },
      (error) => {
        reject(new Error(`Geolocation error: ${error.message}`));
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 300000 // 5 minutes
      }
    );
  });
}