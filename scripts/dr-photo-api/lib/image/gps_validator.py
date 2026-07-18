"""
GPS Validator - Two-Tier Location Validation System

Validates photo GPS coordinates against DR site location with graduated thresholds:
- <25m: Auto-approve (high confidence worker is on-site)
- 25m-1km: Flag for manual review (possible legitimate or GPS drift)
- >1km: Reject (likely wrong location or wrong DR)

Phase 2.3 Implementation - GPS Validation System
"""

import logging
from typing import Tuple, Dict, Any, Optional
from enum import Enum
from lib.image.exif_extractor import calculate_distance_km

logger = logging.getLogger(__name__)


class GPSValidationStatus(Enum):
    """GPS validation status enumeration."""
    APPROVED = "approved"                              # <25m from site (auto-approve)
    NEEDS_LOCATION_REVIEW = "needs_location_review"   # 25m-1km (manual review)
    WRONG_LOCATION = "wrong_location"                 # >1km (reject)
    MISSING_GPS = "missing_gps"                       # No GPS data in photo


class GPSValidator:
    """
    GPS coordinate validator with two-tier distance validation.

    Thresholds:
    - STRICT_THRESHOLD: 25 meters (0.025 km) - Auto-approve if within this radius
    - GENERAL_THRESHOLD: 1000 meters (1.0 km) - Manual review if within this radius
    - Beyond general threshold: Reject as wrong location

    User Requirements:
    - 25m strict check for auto-approval
    - 25m-1km for manual location review
    - >1km reject as wrong location
    """

    # Distance thresholds (in kilometers)
    STRICT_THRESHOLD_KM = 0.025    # 25 meters - auto-approve
    GENERAL_THRESHOLD_KM = 1.0     # 1000 meters - manual review

    def __init__(self):
        """Initialize GPS validator."""
        logger.info(
            f"GPS Validator initialized: "
            f"strict={self.STRICT_THRESHOLD_KM * 1000}m, "
            f"general={self.GENERAL_THRESHOLD_KM * 1000}m"
        )

    def validate_gps_distance(
        self,
        photo_coords: Tuple[float, float],
        site_coords: Tuple[float, float]
    ) -> Tuple[GPSValidationStatus, float, str]:
        """
        Validate GPS distance with two-tier threshold system.

        Args:
            photo_coords: (latitude, longitude) from photo EXIF
            site_coords: (latitude, longitude) of DR installation site

        Returns:
            Tuple of:
                - GPSValidationStatus: Validation result
                - float: Distance in meters
                - str: User-facing message

        Example:
            >>> validator = GPSValidator()
            >>> photo_coords = (-25.7479, 28.2293)
            >>> site_coords = (-25.7480, 28.2295)
            >>> status, distance_m, message = validator.validate_gps_distance(
            ...     photo_coords, site_coords
            ... )
            >>> print(status)
            GPSValidationStatus.APPROVED
            >>> print(distance_m)
            23.5
            >>> print(message)
            '✅ GPS Approved: 23.5m from site (within 25m threshold)'
        """
        # Calculate distance
        distance_km = calculate_distance_km(photo_coords, site_coords)
        distance_m = distance_km * 1000  # Convert to meters for user display

        # Apply two-tier validation
        if distance_km <= self.STRICT_THRESHOLD_KM:
            # Tier 1: <25m - Auto-approve
            status = GPSValidationStatus.APPROVED
            message = (
                f"✅ GPS Approved: {distance_m:.1f}m from site "
                f"(within {self.STRICT_THRESHOLD_KM * 1000:.0f}m threshold)"
            )
            logger.info(
                f"GPS APPROVED: {distance_m:.1f}m <= {self.STRICT_THRESHOLD_KM * 1000}m. "
                f"Photo coords: {photo_coords}, Site coords: {site_coords}"
            )

        elif distance_km <= self.GENERAL_THRESHOLD_KM:
            # Tier 2: 25m-1km - Manual review
            status = GPSValidationStatus.NEEDS_LOCATION_REVIEW
            message = (
                f"⚠️ GPS Review Required: {distance_m:.1f}m from site "
                f"(between {self.STRICT_THRESHOLD_KM * 1000:.0f}m and "
                f"{self.GENERAL_THRESHOLD_KM * 1000:.0f}m). "
                f"Please verify photo taken at correct location."
            )
            logger.warning(
                f"GPS NEEDS REVIEW: {distance_m:.1f}m from site "
                f"(between {self.STRICT_THRESHOLD_KM * 1000}m and {self.GENERAL_THRESHOLD_KM * 1000}m). "
                f"Photo coords: {photo_coords}, Site coords: {site_coords}"
            )

        else:
            # Tier 3: >1km - Reject
            status = GPSValidationStatus.WRONG_LOCATION
            message = (
                f"❌ GPS Rejected: {distance_m:.1f}m from site "
                f"(exceeds {self.GENERAL_THRESHOLD_KM * 1000:.0f}m threshold). "
                f"Photo appears to be from wrong location."
            )
            logger.error(
                f"GPS REJECTED: {distance_m:.1f}m > {self.GENERAL_THRESHOLD_KM * 1000}m. "
                f"Photo coords: {photo_coords}, Site coords: {site_coords}"
            )

        return (status, distance_m, message)

    def validate_photo_location(
        self,
        photo_coords: Optional[Tuple[float, float]],
        site_coords: Optional[Tuple[float, float]],
        require_gps: bool = False
    ) -> Dict[str, Any]:
        """
        Complete photo location validation with missing GPS handling.

        Args:
            photo_coords: (latitude, longitude) from photo EXIF, or None if missing
            site_coords: (latitude, longitude) of DR site, or None if unknown
            require_gps: If True, missing GPS is a validation failure

        Returns:
            Dictionary containing:
                - status: GPSValidationStatus
                - distance_m: Optional[float] - Distance in meters (if GPS present)
                - message: str - User-facing message
                - passed: bool - True if validation passed (approved or manual review)
                - requires_review: bool - True if manual QA review required

        Example:
            >>> validator = GPSValidator()
            >>> result = validator.validate_photo_location(
            ...     photo_coords=(-25.7479, 28.2293),
            ...     site_coords=(-25.7480, 28.2295),
            ...     require_gps=False
            ... )
            >>> print(result["status"])
            GPSValidationStatus.APPROVED
            >>> print(result["passed"])
            True
        """
        # Handle missing GPS data
        if photo_coords is None:
            status = GPSValidationStatus.MISSING_GPS

            if require_gps:
                # GPS required but missing - fail validation
                message = (
                    "❌ GPS Required: Photo has no GPS coordinates. "
                    "Please ensure location services are enabled on your device."
                )
                passed = False
                logger.error("GPS validation FAILED: GPS required but missing from photo")
            else:
                # GPS optional - flag for manual review
                message = (
                    "⚠️ GPS Missing: Photo has no location data. "
                    "Flagged for manual location verification."
                )
                passed = True  # Allow photo but flag for review
                logger.warning("GPS missing from photo - flagged for manual review")

            return {
                "status": status,
                "distance_m": None,
                "message": message,
                "passed": passed,
                "requires_review": not require_gps  # Manual review if GPS optional
            }

        # Handle missing site coordinates
        if site_coords is None:
            logger.warning("Site coordinates not available - cannot validate GPS distance")
            return {
                "status": GPSValidationStatus.MISSING_GPS,
                "distance_m": None,
                "message": (
                    "⚠️ Site Location Unknown: Cannot validate photo location. "
                    "Flagged for manual review."
                ),
                "passed": True,  # Allow but flag for review
                "requires_review": True
            }

        # Validate GPS distance with two-tier system
        status, distance_m, message = self.validate_gps_distance(
            photo_coords=photo_coords,
            site_coords=site_coords
        )

        # Determine if validation passed
        if status == GPSValidationStatus.APPROVED:
            passed = True
            requires_review = False
        elif status == GPSValidationStatus.NEEDS_LOCATION_REVIEW:
            passed = True  # Photo acceptable but needs QA review
            requires_review = True
        else:  # WRONG_LOCATION
            passed = False
            requires_review = True

        return {
            "status": status,
            "distance_m": distance_m,
            "message": message,
            "passed": passed,
            "requires_review": requires_review
        }

    def batch_validate_photos(
        self,
        photos: list[Dict[str, Any]],
        site_coords: Tuple[float, float],
        require_gps: bool = False
    ) -> Dict[str, Any]:
        """
        Validate GPS location for batch of photos.

        Args:
            photos: List of photo dictionaries with 'latitude' and 'longitude' keys
            site_coords: (latitude, longitude) of DR site
            require_gps: If True, missing GPS is a validation failure

        Returns:
            Dictionary containing:
                - total: int - Total photos validated
                - approved: int - Photos auto-approved (<25m)
                - needs_review: int - Photos needing manual review (25m-1km or missing GPS)
                - rejected: int - Photos rejected (>1km)
                - missing_gps: int - Photos without GPS data
                - results: List[Dict] - Individual validation results

        Example:
            >>> validator = GPSValidator()
            >>> photos = [
            ...     {"id": 1, "latitude": -25.7479, "longitude": 28.2293},
            ...     {"id": 2, "latitude": -25.7485, "longitude": 28.2300},
            ...     {"id": 3, "latitude": None, "longitude": None}
            ... ]
            >>> batch_result = validator.batch_validate_photos(
            ...     photos=photos,
            ...     site_coords=(-25.7480, 28.2295)
            ... )
            >>> print(f"Approved: {batch_result['approved']}")
            Approved: 1
        """
        results = []
        counts = {
            "total": 0,
            "approved": 0,
            "needs_review": 0,
            "rejected": 0,
            "missing_gps": 0
        }

        for photo in photos:
            counts["total"] += 1

            # Extract photo coordinates
            photo_coords = None
            if photo.get("latitude") and photo.get("longitude"):
                photo_coords = (photo["latitude"], photo["longitude"])

            # Validate location
            validation = self.validate_photo_location(
                photo_coords=photo_coords,
                site_coords=site_coords,
                require_gps=require_gps
            )

            # Update counts
            if validation["status"] == GPSValidationStatus.APPROVED:
                counts["approved"] += 1
            elif validation["status"] == GPSValidationStatus.NEEDS_LOCATION_REVIEW:
                counts["needs_review"] += 1
            elif validation["status"] == GPSValidationStatus.WRONG_LOCATION:
                counts["rejected"] += 1
            elif validation["status"] == GPSValidationStatus.MISSING_GPS:
                counts["missing_gps"] += 1

            # Store result
            results.append({
                "photo_id": photo.get("id"),
                "validation": validation
            })

        logger.info(
            f"Batch GPS validation complete: {counts['total']} photos - "
            f"{counts['approved']} approved, {counts['needs_review']} review, "
            f"{counts['rejected']} rejected, {counts['missing_gps']} missing GPS"
        )

        return {
            **counts,
            "results": results
        }

    def get_validation_statistics(
        self,
        validations: list[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Calculate GPS validation statistics for reporting.

        Args:
            validations: List of validation result dictionaries

        Returns:
            Statistics dictionary with:
                - total_photos: int
                - approval_rate: float (0.0-1.0)
                - avg_distance_m: float
                - max_distance_m: float
                - min_distance_m: float

        Example:
            >>> validator = GPSValidator()
            >>> validations = [
            ...     {"status": GPSValidationStatus.APPROVED, "distance_m": 15.0},
            ...     {"status": GPSValidationStatus.APPROVED, "distance_m": 22.0},
            ...     {"status": GPSValidationStatus.NEEDS_LOCATION_REVIEW, "distance_m": 500.0}
            ... ]
            >>> stats = validator.get_validation_statistics(validations)
            >>> print(f"Approval rate: {stats['approval_rate']:.2%}")
            Approval rate: 66.67%
        """
        total = len(validations)

        if total == 0:
            return {
                "total_photos": 0,
                "approval_rate": 0.0,
                "avg_distance_m": 0.0,
                "max_distance_m": 0.0,
                "min_distance_m": 0.0
            }

        approved = sum(1 for v in validations if v.get("status") == GPSValidationStatus.APPROVED)
        distances = [v["distance_m"] for v in validations if v.get("distance_m") is not None]

        return {
            "total_photos": total,
            "approval_rate": approved / total,
            "avg_distance_m": sum(distances) / len(distances) if distances else 0.0,
            "max_distance_m": max(distances) if distances else 0.0,
            "min_distance_m": min(distances) if distances else 0.0
        }
