"""
EXIF Extraction Module - GPS Coordinate Extraction

Extracts GPS coordinates and metadata from photo EXIF data using Pillow.
No additional dependencies required (Pillow already in requirements).

Phase 2.1 Implementation - GPS Validation System
"""

import logging
from pathlib import Path
from typing import Dict, Any, Optional, Tuple
from datetime import datetime
from PIL import Image
from PIL.ExifTags import TAGS, GPSTAGS

logger = logging.getLogger(__name__)


def extract_exif(image_path: Path) -> Dict[str, Any]:
    """
    Extract all EXIF metadata including GPS from an image.

    Args:
        image_path: Path to image file

    Returns:
        Dictionary containing:
            - raw_exif: Dict of all EXIF tags
            - gps_data: Dict of GPS-specific tags (if present)
            - camera_make: str (if present)
            - camera_model: str (if present)
            - datetime_original: datetime (if present)
            - orientation: int (if present)
            - has_gps: bool

    Example:
        >>> exif = extract_exif(Path("/photos/dr_photo.jpg"))
        >>> print(exif["has_gps"])
        True
        >>> print(exif["gps_data"])
        {'GPSLatitude': ..., 'GPSLongitude': ...}
    """
    try:
        image = Image.open(image_path)
        exif_data = image._getexif()

        if not exif_data:
            logger.warning(f"No EXIF data found in {image_path}")
            return {
                "raw_exif": {},
                "gps_data": {},
                "has_gps": False,
                "camera_make": None,
                "camera_model": None,
                "datetime_original": None,
                "orientation": None
            }

        # Parse readable EXIF tags
        parsed_exif = {}
        gps_info = {}

        for tag_id, value in exif_data.items():
            tag_name = TAGS.get(tag_id, tag_id)
            parsed_exif[tag_name] = value

            # Extract GPS data specifically
            if tag_name == "GPSInfo":
                for gps_tag_id, gps_value in value.items():
                    gps_tag_name = GPSTAGS.get(gps_tag_id, gps_tag_id)
                    gps_info[gps_tag_name] = gps_value

        # Extract common metadata
        camera_make = parsed_exif.get("Make")
        camera_model = parsed_exif.get("Model")
        orientation = parsed_exif.get("Orientation")

        # Parse datetime
        datetime_original = None
        datetime_str = parsed_exif.get("DateTimeOriginal") or parsed_exif.get("DateTime")
        if datetime_str:
            try:
                datetime_original = datetime.strptime(datetime_str, "%Y:%m:%d %H:%M:%S")
            except ValueError:
                logger.warning(f"Could not parse datetime: {datetime_str}")

        result = {
            "raw_exif": parsed_exif,
            "gps_data": gps_info,
            "has_gps": len(gps_info) > 0,
            "camera_make": camera_make,
            "camera_model": camera_model,
            "datetime_original": datetime_original,
            "orientation": orientation
        }

        logger.info(
            f"Extracted EXIF from {image_path.name}: "
            f"GPS={result['has_gps']}, "
            f"Camera={camera_make} {camera_model}"
        )

        return result

    except Exception as e:
        logger.error(f"Error extracting EXIF from {image_path}: {e}")
        return {
            "raw_exif": {},
            "gps_data": {},
            "has_gps": False,
            "camera_make": None,
            "camera_model": None,
            "datetime_original": None,
            "orientation": None,
            "error": str(e)
        }


def _convert_to_degrees(value: Tuple) -> float:
    """
    Convert GPS coordinates from degrees/minutes/seconds to decimal degrees.

    GPS coordinates are stored as tuples of rationals:
    ((degrees_num, degrees_den), (minutes_num, minutes_den), (seconds_num, seconds_den))

    Args:
        value: Tuple of tuples representing DMS (degrees, minutes, seconds)

    Returns:
        Decimal degrees as float

    Example:
        >>> _convert_to_degrees(((34, 1), (0, 1), (3000, 100)))
        34.00833...
    """
    try:
        # Extract degrees, minutes, seconds
        d = float(value[0][0]) / float(value[0][1])  # degrees
        m = float(value[1][0]) / float(value[1][1])  # minutes
        s = float(value[2][0]) / float(value[2][1])  # seconds

        # Convert to decimal degrees
        decimal_degrees = d + (m / 60.0) + (s / 3600.0)

        return decimal_degrees

    except (IndexError, ZeroDivisionError, TypeError) as e:
        logger.error(f"Error converting GPS coordinates to degrees: {e}")
        return 0.0


def get_gps_coordinates(exif_data: Dict[str, Any]) -> Optional[Tuple[float, float]]:
    """
    Parse GPS latitude and longitude from EXIF data.

    Args:
        exif_data: Dictionary returned by extract_exif()

    Returns:
        Tuple of (latitude, longitude) in decimal degrees, or None if GPS data missing

    Example:
        >>> exif = extract_exif(Path("/photos/dr_photo.jpg"))
        >>> coords = get_gps_coordinates(exif)
        >>> print(coords)
        (-25.7479, 28.2293)  # Pretoria, South Africa
    """
    gps_data = exif_data.get("gps_data", {})

    if not gps_data:
        logger.warning("No GPS data present in EXIF")
        return None

    try:
        # Extract required GPS tags
        gps_latitude = gps_data.get("GPSLatitude")
        gps_latitude_ref = gps_data.get("GPSLatitudeRef")
        gps_longitude = gps_data.get("GPSLongitude")
        gps_longitude_ref = gps_data.get("GPSLongitudeRef")

        if not all([gps_latitude, gps_latitude_ref, gps_longitude, gps_longitude_ref]):
            logger.warning("Incomplete GPS data in EXIF")
            return None

        # Convert to decimal degrees
        lat = _convert_to_degrees(gps_latitude)
        lon = _convert_to_degrees(gps_longitude)

        # Apply direction (N/S for latitude, E/W for longitude)
        if gps_latitude_ref == "S":
            lat = -lat
        if gps_longitude_ref == "W":
            lon = -lon

        logger.info(f"Extracted GPS coordinates: ({lat:.6f}, {lon:.6f})")

        return (lat, lon)

    except Exception as e:
        logger.error(f"Error parsing GPS coordinates: {e}")
        return None


def get_gps_altitude(exif_data: Dict[str, Any]) -> Optional[float]:
    """
    Extract GPS altitude from EXIF data.

    Args:
        exif_data: Dictionary returned by extract_exif()

    Returns:
        Altitude in meters, or None if not present

    Example:
        >>> exif = extract_exif(Path("/photos/dr_photo.jpg"))
        >>> altitude = get_gps_altitude(exif)
        >>> print(altitude)
        1350.0  # meters above sea level
    """
    gps_data = exif_data.get("gps_data", {})

    if not gps_data:
        return None

    try:
        gps_altitude = gps_data.get("GPSAltitude")
        gps_altitude_ref = gps_data.get("GPSAltitudeRef", 0)

        if not gps_altitude:
            return None

        # Convert rational to float
        altitude = float(gps_altitude[0]) / float(gps_altitude[1])

        # Apply altitude reference (0 = above sea level, 1 = below sea level)
        if gps_altitude_ref == 1:
            altitude = -altitude

        logger.info(f"Extracted GPS altitude: {altitude:.2f}m")

        return altitude

    except Exception as e:
        logger.error(f"Error parsing GPS altitude: {e}")
        return None


def calculate_distance_km(
    coord1: Tuple[float, float],
    coord2: Tuple[float, float]
) -> float:
    """
    Calculate distance between two GPS coordinates using Haversine formula.

    Args:
        coord1: (latitude, longitude) in decimal degrees
        coord2: (latitude, longitude) in decimal degrees

    Returns:
        Distance in kilometers

    Example:
        >>> site_coords = (-25.7479, 28.2293)  # Pretoria
        >>> photo_coords = (-25.7480, 28.2295)  # 20m away
        >>> distance = calculate_distance_km(site_coords, photo_coords)
        >>> print(distance)
        0.023  # km (23 meters)
    """
    import math

    lat1, lon1 = coord1
    lat2, lon2 = coord2

    # Earth's radius in kilometers
    R = 6371.0

    # Convert degrees to radians
    lat1_rad = math.radians(lat1)
    lon1_rad = math.radians(lon1)
    lat2_rad = math.radians(lat2)
    lon2_rad = math.radians(lon2)

    # Haversine formula
    dlat = lat2_rad - lat1_rad
    dlon = lon2_rad - lon1_rad

    a = math.sin(dlat / 2)**2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(dlon / 2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    distance = R * c

    logger.debug(f"Distance between {coord1} and {coord2}: {distance:.3f} km")

    return distance


def validate_gps_within_radius(
    photo_coords: Tuple[float, float],
    expected_coords: Tuple[float, float],
    max_distance_km: float = 1.0
) -> bool:
    """
    Check if photo was taken within specified radius of expected location.

    Args:
        photo_coords: (latitude, longitude) from photo EXIF
        expected_coords: (latitude, longitude) of DR site
        max_distance_km: Maximum allowed distance in kilometers (default: 1.0)

    Returns:
        True if photo taken within radius, False otherwise

    Example:
        >>> site_coords = (-25.7479, 28.2293)
        >>> photo_coords = (-25.7480, 28.2295)  # 20m away
        >>> validate_gps_within_radius(photo_coords, site_coords, max_distance_km=1.0)
        True
        >>> validate_gps_within_radius(photo_coords, site_coords, max_distance_km=0.01)
        False
    """
    distance = calculate_distance_km(photo_coords, expected_coords)

    within_radius = distance <= max_distance_km

    if within_radius:
        logger.info(
            f"GPS validation PASSED: {distance:.3f} km <= {max_distance_km} km"
        )
    else:
        logger.warning(
            f"GPS validation FAILED: {distance:.3f} km > {max_distance_km} km"
        )

    return within_radius


def extract_gps_metadata(image_path: Path) -> Dict[str, Any]:
    """
    Complete GPS metadata extraction for database storage.

    Convenience function that extracts all GPS-related metadata in one call.

    Args:
        image_path: Path to image file

    Returns:
        Dictionary containing:
            - has_gps: bool
            - latitude: Optional[float]
            - longitude: Optional[float]
            - altitude: Optional[float]
            - camera_make: Optional[str]
            - camera_model: Optional[str]
            - photo_datetime: Optional[datetime]
            - orientation: Optional[int]
            - raw_gps_data: Dict

    Example:
        >>> metadata = extract_gps_metadata(Path("/photos/dr_photo.jpg"))
        >>> if metadata["has_gps"]:
        ...     print(f"Photo taken at: {metadata['latitude']}, {metadata['longitude']}")
    """
    exif = extract_exif(image_path)

    coords = get_gps_coordinates(exif)
    altitude = get_gps_altitude(exif)

    return {
        "has_gps": exif["has_gps"],
        "latitude": coords[0] if coords else None,
        "longitude": coords[1] if coords else None,
        "altitude": altitude,
        "camera_make": exif["camera_make"],
        "camera_model": exif["camera_model"],
        "photo_datetime": exif["datetime_original"],
        "orientation": exif["orientation"],
        "raw_gps_data": exif["gps_data"]
    }
