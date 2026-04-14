/**
 * Lightweight EXIF GPS extractor for JPEG images.
 * Reads GPS latitude/longitude from EXIF APP1 marker without external dependencies.
 */

interface GpsCoordinates {
  latitude: number;
  longitude: number;
}

/**
 * Extract GPS coordinates from a JPEG File object.
 * Returns null if no EXIF GPS data found or the file is not JPEG.
 */
export async function extractGpsFromExif(file: File): Promise<GpsCoordinates | null> {
  try {
    const buffer = await file.arrayBuffer();
    const view = new DataView(buffer);

    // JPEG must start with 0xFFD8
    if (view.byteLength < 4 || view.getUint16(0) !== 0xFFD8) return null;

    let offset = 2;
    while (offset < view.byteLength - 2) {
      const marker = view.getUint16(offset);
      offset += 2;

      // APP1 marker (EXIF)
      if (marker === 0xFFE1) {
        const length = view.getUint16(offset);
        return parseExifGps(view, offset + 2, length - 2);
      }

      // Skip non-APP1 markers
      if ((marker & 0xFF00) === 0xFF00 && marker !== 0xFFD9) {
        offset += view.getUint16(offset);
      } else {
        break;
      }
    }

    return null;
  } catch {
    return null;
  }
}

function parseExifGps(view: DataView, start: number, _length: number): GpsCoordinates | null {
  // Check "Exif\0\0" header
  if (
    view.getUint8(start) !== 0x45 || // E
    view.getUint8(start + 1) !== 0x78 || // x
    view.getUint8(start + 2) !== 0x69 || // i
    view.getUint8(start + 3) !== 0x66 // f
  ) return null;

  const tiffStart = start + 6;
  const byteOrder = view.getUint16(tiffStart);
  const littleEndian = byteOrder === 0x4949; // II = little-endian

  const get16 = (o: number) => view.getUint16(o, littleEndian);
  const get32 = (o: number) => view.getUint32(o, littleEndian);

  // Read IFD0 to find GPS IFD pointer
  const ifd0Offset = tiffStart + get32(tiffStart + 4);
  const ifd0Count = get16(ifd0Offset);

  let gpsIfdOffset: number | null = null;
  for (let i = 0; i < ifd0Count; i++) {
    const entryOffset = ifd0Offset + 2 + i * 12;
    const tag = get16(entryOffset);
    if (tag === 0x8825) { // GPSInfoIFDPointer
      gpsIfdOffset = tiffStart + get32(entryOffset + 8);
      break;
    }
  }

  if (gpsIfdOffset === null) return null;

  // Read GPS IFD entries
  const gpsCount = get16(gpsIfdOffset);
  let latRef = '', lngRef = '';
  let latRationals: number[] | null = null;
  let lngRationals: number[] | null = null;

  for (let i = 0; i < gpsCount; i++) {
    const entryOffset = gpsIfdOffset + 2 + i * 12;
    const tag = get16(entryOffset);

    if (tag === 1) { // GPSLatitudeRef
      latRef = String.fromCharCode(view.getUint8(entryOffset + 8));
    } else if (tag === 2) { // GPSLatitude
      latRationals = readRationals(view, tiffStart + get32(entryOffset + 8), 3, littleEndian);
    } else if (tag === 3) { // GPSLongitudeRef
      lngRef = String.fromCharCode(view.getUint8(entryOffset + 8));
    } else if (tag === 4) { // GPSLongitude
      lngRationals = readRationals(view, tiffStart + get32(entryOffset + 8), 3, littleEndian);
    }
  }

  if (!latRationals || latRationals.length < 3 || !lngRationals || lngRationals.length < 3) return null;

  let latitude = latRationals[0]! + latRationals[1]! / 60 + latRationals[2]! / 3600;
  let longitude = lngRationals[0]! + lngRationals[1]! / 60 + lngRationals[2]! / 3600;

  if (latRef === 'S') latitude = -latitude;
  if (lngRef === 'W') longitude = -longitude;

  // Sanity check
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;

  return { latitude, longitude };
}

function readRationals(view: DataView, offset: number, count: number, littleEndian: boolean): number[] {
  const result: number[] = [];
  for (let i = 0; i < count; i++) {
    const num = view.getUint32(offset + i * 8, littleEndian);
    const den = view.getUint32(offset + i * 8 + 4, littleEndian);
    result.push(den === 0 ? 0 : num / den);
  }
  return result;
}
