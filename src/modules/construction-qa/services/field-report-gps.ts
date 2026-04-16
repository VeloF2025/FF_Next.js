/**
 * GPS parsing utilities for field report PDFs.
 * Handles Google Maps URL and DMS coordinate formats.
 */

// ============================================================
// Patterns
// ============================================================

export const DMS_PATTERN = /(\d+)°(\d+)'([\d.]+)"([NS])\s+(\d+)°(\d+)'([\d.]+)"([EW])/;
export const GMAPS_ANCHOR = /https?:\/\/maps\.google\.com\//i;
const URL_DECIMAL_PATTERN = /[?&]q=(-?\d+\.?\d+)%2[Cc](\d+\.?\d+)/i;

// ============================================================
// DMS conversion
// ============================================================

export function dmsToDecimal(deg: string, min: string, sec: string, dir: string): number {
  const val = parseInt(deg, 10) + parseInt(min, 10) / 60 + parseFloat(sec) / 3600;
  return (dir === 'S' || dir === 'W') ? -val : val;
}

// ============================================================
// Public API
// ============================================================

/**
 * Extract GPS coordinates from a single pdftotext line.
 * Returns null if the line is not a GPS anchor line.
 *
 * Handles:
 *   - DMS: "26°07'41.2"S 28°28'29.6"E"
 *   - Google Maps URL with inline decimal: "https://maps.google.com/maps?q=-26.123%2C28.456"
 */
export function parseGpsFromLine(line: string): { lat: number; lng: number } | null {
  // DMS pattern
  const dmsMatch = line.match(DMS_PATTERN);
  if (dmsMatch && dmsMatch[1] && dmsMatch[2] && dmsMatch[3] && dmsMatch[4] &&
      dmsMatch[5] && dmsMatch[6] && dmsMatch[7] && dmsMatch[8]) {
    return {
      lat: dmsToDecimal(dmsMatch[1], dmsMatch[2], dmsMatch[3], dmsMatch[4]),
      lng: dmsToDecimal(dmsMatch[5], dmsMatch[6], dmsMatch[7], dmsMatch[8]),
    };
  }

  // Google Maps URL with inline decimal coords (full URL on one line)
  if (GMAPS_ANCHOR.test(line)) {
    const urlMatch = line.match(URL_DECIMAL_PATTERN);
    if (urlMatch && urlMatch[1] && urlMatch[2]) {
      return { lat: parseFloat(urlMatch[1]), lng: parseFloat(urlMatch[2]) };
    }
    // URL found but coords split across following lines — caller reconstructs
    return null;
  }

  return null;
}

/**
 * Reconstruct full Google Maps URL from the anchor line + following URL fragment lines,
 * then extract lat/lng.
 *
 * Example split across 4 lines from pdftotext:
 *   "        https://maps.google.com/ Pole Scew"
 *   "        maps?q=-"
 *   "        26.1270374%2C28.47388"
 *   "        11&z=17&hl=en"
 */
export function reconstructUrlGps(
  anchorLine: string,
  followingLines: string[]
): { lat: number; lng: number } | null {
  const fragments: string[] = [anchorLine.trim()];
  for (const fl of followingLines.slice(0, 5)) {
    const t = fl.trim();
    if (!t) break;
    if (DMS_PATTERN.test(t) || GMAPS_ANCHOR.test(t)) break;
    if (!/^(maps\?|[\d.]+%2C|[\d.]+&z=|[\d-]+&|\d+&)/i.test(t)) break;
    fragments.push(t);
  }

  const joined = fragments.join('').replace(/\s+/g, '');
  const urlMatch = joined.match(/[?&]q=(-?\d+\.?\d+)%2[Cc](\d+\.?\d+)/i);
  if (urlMatch && urlMatch[1] && urlMatch[2]) {
    return { lat: parseFloat(urlMatch[1]), lng: parseFloat(urlMatch[2]) };
  }
  return null;
}
