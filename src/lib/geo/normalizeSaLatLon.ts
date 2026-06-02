/**
 * South Africa coordinate bounds. Used to detect and auto-correct
 * latitude/longitude that arrived swapped from a source import.
 *
 * Background: some imports (Mamelodi SOW file; Mamelodi/Etwatwa GPKG `lat`/`lon`
 * attribute columns) carried the two fields swapped, producing pole rows with
 * latitude ~= +28 (a SA longitude) and longitude ~= -25 (a SA latitude). This
 * helper repairs that at the import boundary so the bad shape never persists.
 */
export const SA_BOUNDS = {
  minLat: -35.0,
  maxLat: -22.0,
  minLon: 16.0,
  maxLon: 33.0,
} as const;

function inLatRange(v: number): boolean {
  return v >= SA_BOUNDS.minLat && v <= SA_BOUNDS.maxLat;
}

function inLonRange(v: number): boolean {
  return v >= SA_BOUNDS.minLon && v <= SA_BOUNDS.maxLon;
}

/**
 * Returns {latitude, longitude} with the two values swapped IFF they
 * unambiguously match the "swapped" signature (latitude holds a SA longitude
 * and longitude holds a SA latitude). Otherwise returns the inputs unchanged —
 * already-correct or partial/garbage values are left alone for a human to see.
 */
export function normalizeSaLatLon<T extends number | null | undefined>(
  latitude: T,
  longitude: T,
): { latitude: T; longitude: T } {
  if (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    inLonRange(latitude) &&
    inLatRange(longitude)
  ) {
    return { latitude: longitude, longitude: latitude };
  }
  return { latitude, longitude };
}
