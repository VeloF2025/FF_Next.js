"""
DR Photo Verification API - Standalone Service

A dedicated FastAPI service for DR photo verification workflow.
Provides REST API and web UI for QA teams to verify installation photos.

Features:
- Download photos from 1Map GIS
- Store photo metadata in PostgreSQL
- AI-powered photo evaluation using Gemini Vision
- REST API for accessing photos and evaluations

Usage:
    uvicorn api.dr_photo_api:app --host 0.0.0.0 --port 8001

Environment Variables:
    ONEMAP_EMAIL: 1Map account email
    ONEMAP_PASSWORD: 1Map account password
    DATABASE_URL: PostgreSQL connection string (optional)
    GEMINI_API_KEY: Google Gemini API key for AI evaluation

Author: BOSS System
"""

import base64
import hashlib
import io
import json
import logging
import os
import time
import uuid
import zipfile
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
from dotenv import load_dotenv
from fastapi import WebSocket, WebSocketDisconnect, BackgroundTasks, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from pydantic import BaseModel

# Database support (optional)
try:
    import asyncpg
    HAS_ASYNCPG = True
except ImportError:
    HAS_ASYNCPG = False
    asyncpg = None

# Load environment
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Import 1Map agent
from agents.integrations.onemap_specialist_agent import (
    OneMapSpecialistAgent,
    PhotoType,
)


# Photo type to step number mapping for 1Map photos
PHOTO_TYPE_TO_STEP = {
    # Step 1: House Photo
    'ph_prop': 1, 'ph_prop_2': 1, 'ph_prop_3': 1,
    'ph_sign1': 1, 'ph_sign1_2': 1, 'ph_sign1_3': 1,
    'ph_sign2': 1, 'ph_sign3': 1,
    # Step 2: Cable Pole / Cable Route
    'ph_cbl_r': 2, 'ph_cbl': 2, 'ph_pole': 2,
    # Step 3: Entry Out / Home Line
    'ph_hm_ln': 3, 'ph_entry_out': 3,
    # Step 4: Entry In / Home Entry
    'ph_hm_en': 4, 'ph_entry_in': 4,
    # Step 5: Wall
    'ph_wall': 5, 'ph_wall_2': 5,
    # Step 6: ONT Back
    'ph_ont': 6, 'ph_ont_back': 6, 'ph_ont_2': 6,
    # Step 7: Power Meter
    'ph_powm': 7, 'ph_powm2': 7, 'ph_power': 7,
    # Step 8: Barcode / Label
    'ph_bl': 8, 'ph_barcode': 8, 'ph_label': 8,
    # Step 9: UPS
    'ph_ups': 9, 'ph_ups_2': 9,
    # Step 10: Final / After
    'ph_after': 10, 'ph_final': 10,
    # Step 11: Lights / LED
    'ph_lights': 11, 'ph_led': 11, 'ph_ont_led': 11,
}

def get_step_for_photo_type(photo_type: str) -> int:
    """Get step number for a photo type, defaulting to 1 if unknown."""
    # Handle variations like ph_prop_3 -> ph_prop
    base_type = photo_type.lower()
    
    # Direct match
    if base_type in PHOTO_TYPE_TO_STEP:
        return PHOTO_TYPE_TO_STEP[base_type]
    
    # Try without trailing numbers (e.g., ph_prop_3 -> ph_prop)
    for known_type in PHOTO_TYPE_TO_STEP:
        if base_type.startswith(known_type):
            return PHOTO_TYPE_TO_STEP[known_type]
    
    # Default to step 1 for unknown types
    return 1



# 1Map Photo Fetching (fixed to use async context manager)

async def search_1map_photos(dr_number: str) -> List[Dict[str, Any]]:
    """Fetch photos from 1Map for a DR number.
    
    Uses OneMapSpecialistAgent.get_dr() to fetch the DR record,
    then extracts photos from ALL property records.
    
    Each photo includes the primary_id of the property record it belongs to,
    which is needed for downloading.
    
    Args:
        dr_number: DR number (e.g., "DR1736607")
        
    Returns:
        List of photo dicts with 'filename', 'photo_type', 'photo_id', 
        'primary_id', and 'step_number' keys
    """
    try:
        async with OneMapSpecialistAgent() as agent:
            record = await agent.get_dr(dr_number)
            
            if not record:
                logger.info(f"No 1Map record found for {dr_number}")
                return []
            
            photos_list = []
            
            # Iterate through all property records to get photos with their primary_id
            property_records = getattr(record, 'property_records', []) or []
            
            if property_records:
                for prop_record in property_records:
                    prop_primary_id = getattr(prop_record, 'primary_id', None)
                    prop_photos = getattr(prop_record, 'photos', {}) or {}
                    
                    for photo_type, photo_id in prop_photos.items():
                        if photo_id and prop_primary_id:
                            step_num = get_step_for_photo_type(photo_type)
                            photos_list.append({
                                'filename': f"{photo_type}_{photo_id}.jpg",
                                'photo_type': photo_type,
                                'photo_id': photo_id,
                                'primary_id': str(prop_primary_id),
                                'step_number': step_num,
                                'source': '1map'
                            })
            else:
                # Fallback: use combined photos dict with main primary_id
                photos_dict = getattr(record, 'photos', None) or {}
                main_primary_id = getattr(record, 'primary_id', None)
                
                for photo_type, photo_id in photos_dict.items():
                    if photo_id:
                        step_num = get_step_for_photo_type(photo_type)
                        photos_list.append({
                            'filename': f"{photo_type}_{photo_id}.jpg",
                            'photo_type': photo_type,
                            'photo_id': photo_id,
                            'primary_id': str(main_primary_id) if main_primary_id else None,
                            'step_number': step_num,
                            'source': '1map'
                        })
            
            logger.info(f"1Map returned {len(photos_list)} photos for {dr_number}")
            return photos_list
            
    except Exception as e:
        logger.error(f"Error fetching 1Map photos for {dr_number}: {e}")
        return []


# GPS/EXIF extraction (Phase 2.4)
from lib.image.exif_extractor import extract_gps_metadata
from lib.image.gps_validator import GPSValidator, GPSValidationStatus

# Photo storage path
PHOTOS_BASE_PATH = Path(os.getenv("DR_PHOTOS_PATH", "data/dr_photos"))
PHOTOS_BASE_PATH.mkdir(parents=True, exist_ok=True)

# Database URL (optional - enables persistence)
DATABASE_URL = os.getenv("DATABASE_URL", "")

# Gemini API for AI evaluation
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = "gemini-2.0-flash"  # Use latest flash model for vision

# OpenAI API for fallback evaluation
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = "gpt-4o"  # GPT-4o Vision

# Claude Vision Agent (fallback 2)
CLAUDE_VISION_URL = os.getenv("CLAUDE_VISION_URL", "http://localhost:8092")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")

# =============================================================================
# DATABASE HELPER CLASS
# =============================================================================

class PhotoDatabase:
    """Database interface for storing photo metadata and evaluations."""

    def __init__(self):
        self.pool: Optional[asyncpg.Pool] = None
        self._enabled = bool(DATABASE_URL) and HAS_ASYNCPG

    @property
    def enabled(self) -> bool:
        return self._enabled and self.pool is not None

    async def connect(self):
        """Initialize database connection pool."""
        if not self._enabled:
            logger.info("Database disabled (no DATABASE_URL or asyncpg not installed)")
            return

        try:
            self.pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
            logger.info(f"Database connected: {DATABASE_URL[:30]}...")
        except Exception as e:
            logger.error(f"Database connection failed: {e}")
            self._enabled = False

    async def disconnect(self):
        """Close database connection pool."""
        if self.pool:
            await self.pool.close()
            logger.info("Database disconnected")

    async def store_photo_metadata(
        self,
        dr_number: str,
        project: str,
        filename: str,
        file_path: str,
        file_size: int,
        file_hash: str,
        photo_type: str,
        onemap_layer_id: Optional[str] = None,
        onemap_attachment_id: Optional[str] = None,
        # GPS/EXIF metadata (Phase 2.4)
        gps_metadata: Optional[Dict[str, Any]] = None,
        gps_validation_status: Optional[str] = None,
        gps_distance_km: Optional[float] = None
    ) -> Optional[str]:
        """Store photo download metadata in database (with GPS validation - Phase 2.4)."""
        if not self.enabled:
            return None

        try:
            photo_id = str(uuid.uuid4())
            async with self.pool.acquire() as conn:
                # Extract GPS data if provided
                exif_data = None
                gps_latitude = None
                gps_longitude = None
                gps_altitude = None
                photo_datetime = None
                camera_make = None
                camera_model = None
                orientation = None

                if gps_metadata:
                    exif_data = json.dumps(gps_metadata.get("raw_gps_data", {}))
                    gps_latitude = gps_metadata.get("latitude")
                    gps_longitude = gps_metadata.get("longitude")
                    gps_altitude = gps_metadata.get("altitude")
                    photo_datetime = gps_metadata.get("photo_datetime")
                    camera_make = gps_metadata.get("camera_make")
                    camera_model = gps_metadata.get("camera_model")
                    orientation = gps_metadata.get("orientation")

                await conn.execute(
                    """
                    INSERT INTO dr_photo_downloads (
                        id, dr_number, project, filename, file_path, file_size,
                        file_hash, onemap_layer_id, onemap_attachment_id,
                        content_type, downloaded_at,
                        exif_data, gps_latitude, gps_longitude, gps_altitude,
                        photo_datetime, camera_make, camera_model, orientation,
                        gps_validation_status, gps_distance_from_site_km
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(),
                        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
                    )
                    ON CONFLICT (file_hash) DO UPDATE SET
                        downloaded_at = NOW(),
                        gps_validation_status = EXCLUDED.gps_validation_status,
                        gps_distance_from_site_km = EXCLUDED.gps_distance_from_site_km
                    """,
                    photo_id, dr_number, project, filename, file_path, file_size,
                    file_hash, onemap_layer_id, onemap_attachment_id, 'image/jpeg',
                    exif_data, gps_latitude, gps_longitude, gps_altitude,
                    photo_datetime, camera_make, camera_model, orientation,
                    gps_validation_status, gps_distance_km
                )
            logger.debug(f"Stored photo metadata with GPS: {dr_number}/{filename} (GPS: {gps_validation_status})")
            return photo_id
        except Exception as e:
            logger.error(f"Failed to store photo metadata: {e}")
            return None

    async def store_evaluation_result(
        self,
        dr_number: str,
        project: str,
        photo_filename: str,
        evaluation: Dict[str, Any]
    ) -> bool:
        """Store AI evaluation result in database."""
        if not self.enabled:
            return False

        try:
            async with self.pool.acquire() as conn:
                await conn.execute(
                    """
                    UPDATE dr_photo_downloads SET
                        ai_verification_status = $1,
                        ai_verification_result = $2,
                        ai_confidence = $3,
                        analyzed_at = NOW()
                    WHERE dr_number = $4 AND filename = $5
                    """,
                    evaluation.get('overall_status', 'pending'),
                    json.dumps(evaluation),
                    evaluation.get('confidence', 0.0),
                    dr_number, photo_filename
                )
            logger.debug(f"Stored evaluation for: {dr_number}/{photo_filename}")
            return True
        except Exception as e:
            logger.error(f"Failed to store evaluation: {e}")
            return False

    async def get_photos_by_dr(self, dr_number: str) -> List[Dict[str, Any]]:
        """Get all photos for a DR from database."""
        if not self.enabled:
            return []

        try:
            async with self.pool.acquire() as conn:
                rows = await conn.fetch(
                    """
                    SELECT id, dr_number, project, filename, file_path, file_size,
                           file_hash, ai_verification_status, ai_confidence,
                           downloaded_at, analyzed_at
                    FROM dr_photo_downloads
                    WHERE dr_number = $1
                    ORDER BY downloaded_at DESC
                    """, dr_number)
                return [dict(row) for row in rows]
        except Exception as e:
            logger.error(f"Failed to get photos: {e}")
            return []

    async def get_all_drs_with_photos(self) -> List[Dict[str, Any]]:
        """Get summary of all DRs with photos in database."""
        if not self.enabled:
            return []

        try:
            async with self.pool.acquire() as conn:
                rows = await conn.fetch(
                    """
                    SELECT
                        dr_number,
                        project,
                        COUNT(*) as photo_count,
                        SUM(file_size) as total_size,
                        MAX(downloaded_at) as last_download,
                        COUNT(CASE WHEN ai_verification_status = 'pass' THEN 1 END) as passed,
                        COUNT(CASE WHEN ai_verification_status = 'fail' THEN 1 END) as failed
                    FROM dr_photo_downloads
                    GROUP BY dr_number, project
                    ORDER BY last_download DESC
                    """)
                return [dict(row) for row in rows]
        except Exception as e:
            logger.error(f"Failed to get DRs summary: {e}")
            return []

    async def store_qa_result(
        self,
        dr_number: str,
        project: str,
        photo_filename: str,
        qa_result: Dict[str, Any]
    ) -> bool:
        """Store QA evaluation result with provider/cost/latency tracking."""
        if not self.enabled:
            return False

        try:
            async with self.pool.acquire() as conn:
                await conn.execute(
                    """
                    UPDATE dr_photo_downloads SET
                        ai_verification_status = $1,
                        ai_verification_result = $2,
                        ai_confidence = $3,
                        qa_provider = $4,
                        qa_cost = $5,
                        qa_latency_ms = $6,
                        analyzed_at = NOW()
                    WHERE dr_number = $7 AND filename = $8
                    """,
                    qa_result.get('status', 'pending'),
                    json.dumps(qa_result),
                    qa_result.get('confidence', 0.0),
                    qa_result.get('provider', 'unknown'),
                    qa_result.get('cost', 0.0),
                    qa_result.get('latency_ms', 0),
                    dr_number, photo_filename
                )
            logger.debug(f"Stored QA result for: {dr_number}/{photo_filename} (provider: {qa_result.get('provider')})")
            return True
        except Exception as e:
            logger.error(f"Failed to store QA result: {e}")
            return False

    async def store_qa_summary(
        self,
        dr_number: str,
        project: str,
        summary: Dict[str, Any]
    ) -> bool:
        """Store DR-level QA summary."""
        if not self.enabled:
            return False

        try:
            async with self.pool.acquire() as conn:
                # Check if qa_summary table exists, if not store in dr_photo_downloads
                await conn.execute(
                    """
                    INSERT INTO dr_qa_audit_log (
                        dr_number, project, provider, accepted, confidence, cost, latency_ms
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                    ON CONFLICT DO NOTHING
                    """,
                    dr_number, project, "cascade",
                    summary.get("overall_status") == "passed",
                    summary.get("passed_count", 0) / max(summary.get("total_photos", 1), 1),
                    summary.get("total_cost", 0.0),
                    0
                )
            logger.debug(f"Stored QA summary for: {dr_number}")
            return True
        except Exception as e:
            logger.warning(f"Failed to store QA summary (table may not exist): {e}")
            return False

    async def get_qa_status(
        self,
        dr_number: str,
        project: str
    ) -> Optional[Dict[str, Any]]:
        """Get QA status for a DR from database."""
        if not self.enabled:
            return None

        try:
            async with self.pool.acquire() as conn:
                rows = await conn.fetch(
                    """
                    SELECT
                        dr_number,
                        project,
                        ai_verification_status,
                        ai_confidence,
                        qa_provider,
                        qa_cost,
                        qa_latency_ms,
                        analyzed_at,
                        ai_verification_result
                    FROM dr_photo_downloads
                    WHERE dr_number = $1 AND (project = $2 OR project IS NULL)
                    ORDER BY analyzed_at DESC NULLS LAST
                    """, dr_number, project)

                if not rows:
                    return None

                # Aggregate results
                results = [dict(row) for row in rows]
                total_photos = len(results)
                evaluated = sum(1 for r in results if r.get("ai_verification_status"))
                passed = sum(1 for r in results if r.get("ai_verification_status") == "pass")
                failed = sum(1 for r in results if r.get("ai_verification_status") == "fail")
                total_cost = sum(r.get("qa_cost", 0) or 0 for r in results)

                # Determine overall status
                if failed > 0:
                    overall_status = "failed"
                elif evaluated < total_photos:
                    overall_status = "pending"
                elif passed == total_photos:
                    overall_status = "passed"
                else:
                    overall_status = "needs_review"

                return {
                    "dr_number": dr_number,
                    "project": project,
                    "status": overall_status,
                    "analyzed_at": str(results[0].get("analyzed_at")) if results[0].get("analyzed_at") else None,
                    "summary": {
                        "total_photos": total_photos,
                        "evaluated": evaluated,
                        "passed_count": passed,
                        "failed_count": failed,
                        "total_cost": total_cost
                    },
                    "results": results
                }

        except Exception as e:
            logger.error(f"Failed to get QA status: {e}")
            return None

    async def get_qa_summary(
        self,
        project: Optional[str] = None,
        status: Optional[str] = None,
        limit: int = 100
    ) -> Dict[str, Any]:
        """Get QA summary across all DRs."""
        if not self.enabled:
            return {"aggregate": {}, "evaluations": []}

        try:
            async with self.pool.acquire() as conn:
                query = """
                    SELECT
                        dr_number,
                        project,
                        COUNT(*) as total_photos,
                        COUNT(CASE WHEN ai_verification_status = 'pass' THEN 1 END) as passed_count,
                        COUNT(CASE WHEN ai_verification_status = 'fail' THEN 1 END) as failed_count,
                        COUNT(CASE WHEN ai_verification_status NOT IN ('pass', 'fail') AND ai_verification_status IS NOT NULL THEN 1 END) as needs_review_count,
                        SUM(COALESCE(qa_cost, 0)) as total_cost,
                        MAX(analyzed_at) as completed_at,
                        CASE
                            WHEN COUNT(CASE WHEN ai_verification_status = 'fail' THEN 1 END) > 0 THEN 'failed'
                            WHEN COUNT(CASE WHEN ai_verification_status = 'pass' THEN 1 END) = COUNT(*) THEN 'passed'
                            ELSE 'needs_review'
                        END as status
                    FROM dr_photo_downloads
                    WHERE ai_verification_status IS NOT NULL
                """

                params = []
                param_idx = 1

                if project:
                    query += f" AND project = ${param_idx}"
                    params.append(project)
                    param_idx += 1

                query += " GROUP BY dr_number, project"

                if status:
                    query = f"""
                        SELECT * FROM ({query}) sub
                        WHERE status = ${param_idx}
                    """
                    params.append(status)
                    param_idx += 1

                query += f" ORDER BY completed_at DESC NULLS LAST LIMIT ${param_idx}"
                params.append(limit)

                rows = await conn.fetch(query, *params)
                evaluations = [dict(row) for row in rows]

                # Calculate aggregates
                total_drs = len(evaluations)
                total_passed = sum(1 for e in evaluations if e.get("status") == "passed")
                total_failed = sum(1 for e in evaluations if e.get("status") == "failed")
                total_review = sum(1 for e in evaluations if e.get("status") == "needs_review")
                total_cost = sum(e.get("total_cost", 0) or 0 for e in evaluations)

                return {
                    "aggregate": {
                        "total_drs": total_drs,
                        "passed": total_passed,
                        "failed": total_failed,
                        "needs_review": total_review,
                        "total_cost": round(float(total_cost), 4),
                        "pass_rate": round(total_passed / max(total_drs, 1) * 100, 1)
                    },
                    "evaluations": evaluations
                }

        except Exception as e:
            logger.error(f"Failed to get QA summary: {e}")
            return {"aggregate": {}, "evaluations": []}

    async def log_sharepoint_sync(
        self,
        dr_number: str,
        project: str,
        files_count: int,
        status: str
    ) -> bool:
        """Log SharePoint sync request."""
        if not self.enabled:
            return False

        try:
            async with self.pool.acquire() as conn:
                await conn.execute(
                    """
                    INSERT INTO dr_sharepoint_sync_log (
                        dr_number, project, status, files_synced, started_at
                    ) VALUES ($1, $2, $3, $4, NOW())
                    ON CONFLICT DO NOTHING
                    """,
                    dr_number, project, status, files_count
                )
            logger.debug(f"Logged SharePoint sync for: {dr_number}")
            return True
        except Exception as e:
            logger.warning(f"Failed to log SharePoint sync (table may not exist): {e}")
            return False


# Initialize database helper
db = PhotoDatabase()




# =============================================================================
# CASCADE VISION EVALUATOR (3-Model: Gemini → OpenAI → Claude)
# =============================================================================

class CascadeVisionEvaluator:
    """AI-powered photo evaluation using 3-model cascade: Gemini → OpenAI → Claude.

    Cost optimization:
    - Gemini: ~$0.001/image (primary)
    - OpenAI GPT-4o: ~$0.01/image (fallback 1)
    - Claude Vision: ~$0.015/image (fallback 2)

    Cascade logic:
    - Try Gemini first (cheapest)
    - If confidence < 0.7 or error, try OpenAI
    - If still low confidence or error, try Claude
    """

    # Cost tracking per provider (approximate USD per image)
    COST_PER_IMAGE = {
        "gemini": 0.001,
        "openai": 0.01,
        "claude": 0.015
    }

    def __init__(
        self,
        gemini_api_key: str = "",
        openai_api_key: str = "",
        anthropic_api_key: str = "",
        claude_vision_url: str = "http://localhost:8092"
    ):
        self.gemini_api_key = gemini_api_key
        self.openai_api_key = openai_api_key
        self.anthropic_api_key = anthropic_api_key
        self.claude_vision_url = claude_vision_url
        self.gemini_base_url = "https://generativelanguage.googleapis.com/v1beta/models"

    async def evaluate_photo(
        self,
        image_path: Path,
        photo_type: str = "installation",
        min_confidence: float = 0.7
    ) -> Dict[str, Any]:
        """Evaluate a single photo using 3-model cascade.

        Args:
            image_path: Path to the image file
            photo_type: Type of photo (installation, signature, meter, etc.)
            min_confidence: Minimum confidence to accept result (0.0-1.0)

        Returns:
            Dict with evaluation results including provider used and cost
        """
        start_time = time.time()
        total_cost = 0.0
        providers_tried = []

        # Read and encode image once
        with open(image_path, "rb") as f:
            image_bytes = f.read()
        image_b64 = base64.b64encode(image_bytes).decode("utf-8")

        prompt = self._get_evaluation_prompt(photo_type)

        # === TRY 1: GEMINI (Primary - Cheapest) ===
        if self.gemini_api_key:
            providers_tried.append("gemini")
            result = await self._try_gemini(image_b64, prompt)
            total_cost += self.COST_PER_IMAGE["gemini"]

            if result.get("status") == "completed" and result.get("confidence", 0) >= min_confidence:
                result["provider"] = "gemini"
                result["providers_tried"] = providers_tried
                result["total_cost"] = total_cost
                result["processing_time_ms"] = int((time.time() - start_time) * 1000)
                logger.info(f"Gemini evaluation succeeded: confidence={result.get('confidence')}")
                return result
            else:
                logger.warning(f"Gemini low confidence ({result.get('confidence', 0)}) or error, trying OpenAI...")

        # === TRY 2: OPENAI GPT-4o (Fallback 1) ===
        if self.openai_api_key:
            providers_tried.append("openai")
            result = await self._try_openai(image_b64, prompt)
            total_cost += self.COST_PER_IMAGE["openai"]

            if result.get("status") == "completed" and result.get("confidence", 0) >= min_confidence:
                result["provider"] = "openai"
                result["providers_tried"] = providers_tried
                result["total_cost"] = total_cost
                result["processing_time_ms"] = int((time.time() - start_time) * 1000)
                logger.info(f"OpenAI evaluation succeeded: confidence={result.get('confidence')}")
                return result
            else:
                logger.warning(f"OpenAI low confidence ({result.get('confidence', 0)}) or error, trying Claude...")

        # === TRY 3: CLAUDE VISION (Fallback 2 - Most Accurate) ===
        if self.anthropic_api_key or self.claude_vision_url:
            providers_tried.append("claude")
            result = await self._try_claude(image_b64, prompt)
            total_cost += self.COST_PER_IMAGE["claude"]

            result["provider"] = "claude"
            result["providers_tried"] = providers_tried
            result["total_cost"] = total_cost
            result["processing_time_ms"] = int((time.time() - start_time) * 1000)

            if result.get("status") == "completed":
                logger.info(f"Claude evaluation succeeded: confidence={result.get('confidence')}")
            else:
                logger.error(f"All providers failed for photo evaluation")

            return result

        # No providers available
        return {
            "status": "skipped",
            "reason": "No AI providers configured (need GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY)",
            "overall_score": None,
            "provider": None,
            "providers_tried": providers_tried,
            "total_cost": 0.0,
            "processing_time_ms": int((time.time() - start_time) * 1000)
        }

    async def _try_gemini(self, image_b64: str, prompt: str) -> Dict[str, Any]:
        """Try Gemini Vision API evaluation."""
        try:
            url = f"{self.gemini_base_url}/{GEMINI_MODEL}:generateContent?key={self.gemini_api_key}"

            payload = {
                "contents": [{
                    "parts": [
                        {"text": prompt},
                        {"inline_data": {"mime_type": "image/jpeg", "data": image_b64}}
                    ]
                }],
                "generationConfig": {
                    "temperature": 0.2,
                    "topK": 32,
                    "topP": 1,
                    "maxOutputTokens": 2048
                }
            }

            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(url, json=payload)
                response.raise_for_status()
                result = response.json()

            text_response = result["candidates"][0]["content"]["parts"][0]["text"]
            evaluation = self._parse_evaluation_response(text_response)

            return {
                "status": "completed",
                "overall_score": evaluation.get("score", 0),
                "overall_status": evaluation.get("status", "needs_review"),
                "confidence": evaluation.get("confidence", 0.5),
                "installation_quality_score": evaluation.get("installation_quality", 0),
                "safety_compliance_score": evaluation.get("safety_compliance", 0),
                "documentation_quality_score": evaluation.get("documentation_quality", 0),
                "equipment_visibility_score": evaluation.get("equipment_visibility", 0),
                "issues_detected": evaluation.get("issues", []),
                "summary": evaluation.get("summary", ""),
                "detailed_analysis": evaluation.get("analysis", ""),
                "recommendations": evaluation.get("recommendations", ""),
                "model_name": GEMINI_MODEL,
                "raw_response": text_response
            }

        except Exception as e:
            logger.error(f"Gemini evaluation failed: {e}")
            return {"status": "failed", "error": str(e), "confidence": 0}

    async def _try_openai(self, image_b64: str, prompt: str) -> Dict[str, Any]:
        """Try OpenAI GPT-4o Vision API evaluation."""
        try:
            url = "https://api.openai.com/v1/chat/completions"

            headers = {
                "Authorization": f"Bearer {self.openai_api_key}",
                "Content-Type": "application/json"
            }

            payload = {
                "model": OPENAI_MODEL,
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/jpeg;base64,{image_b64}",
                                    "detail": "high"
                                }
                            }
                        ]
                    }
                ],
                "max_tokens": 2048,
                "temperature": 0.2
            }

            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(url, headers=headers, json=payload)
                response.raise_for_status()
                result = response.json()

            text_response = result["choices"][0]["message"]["content"]
            evaluation = self._parse_evaluation_response(text_response)

            return {
                "status": "completed",
                "overall_score": evaluation.get("score", 0),
                "overall_status": evaluation.get("status", "needs_review"),
                "confidence": evaluation.get("confidence", 0.5),
                "installation_quality_score": evaluation.get("installation_quality", 0),
                "safety_compliance_score": evaluation.get("safety_compliance", 0),
                "documentation_quality_score": evaluation.get("documentation_quality", 0),
                "equipment_visibility_score": evaluation.get("equipment_visibility", 0),
                "issues_detected": evaluation.get("issues", []),
                "summary": evaluation.get("summary", ""),
                "detailed_analysis": evaluation.get("analysis", ""),
                "recommendations": evaluation.get("recommendations", ""),
                "model_name": OPENAI_MODEL,
                "raw_response": text_response
            }

        except Exception as e:
            logger.error(f"OpenAI evaluation failed: {e}")
            return {"status": "failed", "error": str(e), "confidence": 0}

    async def _try_claude(self, image_b64: str, prompt: str) -> Dict[str, Any]:
        """Try Claude Vision evaluation (via local agent or direct API)."""
        try:
            # First try local Claude Vision Agent service
            if self.claude_vision_url:
                try:
                    async with httpx.AsyncClient(timeout=60.0) as client:
                        # Try the local Claude Vision Agent
                        response = await client.post(
                            f"{self.claude_vision_url}/api/evaluate",
                            json={
                                "image_base64": image_b64,
                                "prompt": prompt
                            }
                        )
                        if response.status_code == 200:
                            result = response.json()
                            evaluation = self._parse_evaluation_response(result.get("response", ""))

                            return {
                                "status": "completed",
                                "overall_score": evaluation.get("score", 0),
                                "overall_status": evaluation.get("status", "needs_review"),
                                "confidence": evaluation.get("confidence", 0.5),
                                "installation_quality_score": evaluation.get("installation_quality", 0),
                                "safety_compliance_score": evaluation.get("safety_compliance", 0),
                                "documentation_quality_score": evaluation.get("documentation_quality", 0),
                                "equipment_visibility_score": evaluation.get("equipment_visibility", 0),
                                "issues_detected": evaluation.get("issues", []),
                                "summary": evaluation.get("summary", ""),
                                "detailed_analysis": evaluation.get("analysis", ""),
                                "recommendations": evaluation.get("recommendations", ""),
                                "model_name": "claude-vision-agent",
                                "raw_response": result.get("response", "")
                            }
                except Exception as e:
                    logger.warning(f"Local Claude Vision Agent unavailable: {e}, trying direct API...")

            # Fallback to direct Anthropic API
            if self.anthropic_api_key:
                url = "https://api.anthropic.com/v1/messages"

                headers = {
                    "x-api-key": self.anthropic_api_key,
                    "anthropic-version": "2023-06-01",
                    "Content-Type": "application/json"
                }

                payload = {
                    "model": "claude-sonnet-4-20250514",
                    "max_tokens": 2048,
                    "messages": [
                        {
                            "role": "user",
                            "content": [
                                {
                                    "type": "image",
                                    "source": {
                                        "type": "base64",
                                        "media_type": "image/jpeg",
                                        "data": image_b64
                                    }
                                },
                                {"type": "text", "text": prompt}
                            ]
                        }
                    ]
                }

                async with httpx.AsyncClient(timeout=60.0) as client:
                    response = await client.post(url, headers=headers, json=payload)
                    response.raise_for_status()
                    result = response.json()

                text_response = result["content"][0]["text"]
                evaluation = self._parse_evaluation_response(text_response)

                return {
                    "status": "completed",
                    "overall_score": evaluation.get("score", 0),
                    "overall_status": evaluation.get("status", "needs_review"),
                    "confidence": evaluation.get("confidence", 0.5),
                    "installation_quality_score": evaluation.get("installation_quality", 0),
                    "safety_compliance_score": evaluation.get("safety_compliance", 0),
                    "documentation_quality_score": evaluation.get("documentation_quality", 0),
                    "equipment_visibility_score": evaluation.get("equipment_visibility", 0),
                    "issues_detected": evaluation.get("issues", []),
                    "summary": evaluation.get("summary", ""),
                    "detailed_analysis": evaluation.get("analysis", ""),
                    "recommendations": evaluation.get("recommendations", ""),
                    "model_name": "claude-sonnet-4",
                    "raw_response": text_response
                }

            return {"status": "failed", "error": "No Claude credentials available", "confidence": 0}

        except Exception as e:
            logger.error(f"Claude evaluation failed: {e}")
            return {"status": "failed", "error": str(e), "confidence": 0}

    def _get_evaluation_prompt(self, photo_type: str) -> str:
        """Get step-specific evaluation prompt based on photo type.

        v1.2.20: Complete rewrite - each step now has prompts matching SKILL.md requirements.
        Previous bug: Generic 'fiber optic installation' prompt was wrong for Step 1 (House Photo).
        """

        # Step-specific prompts that match the SKILL.md requirements exactly
        step_prompts = {
            # Step 1: House Photo - Property identification ONLY
            "ph_prop": """Analyze this PROPERTY IDENTIFICATION photo.

This is Step 1 - we are verifying we are at the correct location. This is NOT an installation photo.

Check ONLY for:
1. House/building exterior clearly visible
2. Property address/unit number visible (if applicable)
3. Good lighting and proper framing
4. Photo shows the correct property

Rate on a scale of 0-100 based on:
- Property clearly identifiable (40 points)
- Good framing and lighting (30 points)
- Address/number visible if present (30 points)

Provide your response in this exact JSON format:
{
    "score": <overall score 0-100>,
    "status": "<pass|fail|needs_review>",
    "confidence": <0.0-1.0>,
    "property_visible": <true|false>,
    "address_visible": <true|false>,
    "lighting_quality": "<good|fair|poor>",
    "issues": ["issue1", "issue2"],
    "summary": "<one sentence summary>",
    "recommendations": "<what could be improved>"
}

IMPORTANT: This is a house photo, NOT an installation photo. Do NOT check for cables, fiber, equipment, or installation quality.""",

            # Step 2A/B: Cable from Pole - Aerial fiber
            "ph_pole": """Analyze this AERIAL FIBER DROP photo (Step 2).

Check for:
1. Utility pole visible
2. Dome joint/fiber splice enclosure on pole
3. Cable running from pole toward house
4. Connection point to house visible

Rate on 0-100 based on visibility of these elements.

Provide JSON response:
{
    "score": <0-100>,
    "status": "<pass|fail|needs_review>",
    "confidence": <0.0-1.0>,
    "pole_visible": <true|false>,
    "dome_joint_visible": <true|false>,
    "cable_visible": <true|false>,
    "issues": [],
    "summary": "<summary>",
    "recommendations": "<improvements>"
}""",

            # Step 3: Cable Entry Outside - Critical step
            "ph_hm_en": """Analyze this CABLE ENTRY INSIDE photo (Step 4).

This shows the INTERNAL cable routing from entry point toward ONT area.
We are looking at the INSIDE of the building where the cable comes through.

Check for:
1. Where cable comes through wall from INSIDE view
2. Cable routing toward ONT mounting area
3. Cable properly secured/managed
4. Interior wall visible

Rate on 0-100 based on cable visibility and routing quality.

Provide JSON response:
{
    "score": <0-100>,
    "status": "<pass|fail|needs_review>",
    "confidence": <0.0-1.0>,
    "entry_inside_visible": <true|false>,
    "cable_routing_visible": <true|false>,
    "cable_managed": <true|false>,
    "issues": [],
    "summary": "<summary>",
    "recommendations": "<improvements>"
}""",

            # Step 4: Cable Entry Inside
            "ph_hm_ln": """Analyze this CABLE ENTRY OUTSIDE photo (Step 3 - CRITICAL).

This photo must show WHERE the fiber cable enters the building EXTERIOR.
We are looking at the OUTSIDE of the building.

Required Elements (ALL must be visible):
1. Cable entry point (conduit/hole/pipe) as MAIN FOCUS
2. Close-up shot (not distant/wide shot)
3. Entry hardware clearly visible
4. Exterior wall surface visible

Rate on 0-100:
- Entry point clearly visible and focused (50 points)
- Close-up shot not distant (25 points)
- Hardware/conduit visible (25 points)

Provide JSON response:
{
    "score": <0-100>,
    "status": "<pass|fail|needs_review>",
    "confidence": <0.0-1.0>,
    "entry_point_visible": <true|false>,
    "is_closeup": <true|false>,
    "hardware_visible": <true|false>,
    "issues": [],
    "summary": "<summary>",
    "recommendations": "<improvements>"
}

NOTE: This is a 70% field failure rate step. Be strict about close-up requirement.""",

            # Step 5: Wall for Installation
            "ph_wall": """Analyze this WALL FOR INSTALLATION photo (Step 5).

This shows the prepared installation area BEFORE ONT installation.

Required Elements:
1. Mounting bracket (plastic bracket, wooden board, metal plate, or prepared surface)
2. Wall plug (electrical socket, power outlet, extension cord, or power strip)

Rate on 0-100:
- Mounting area prepared (50 points)
- Power outlet visible (50 points)

Provide JSON response:
{
    "score": <0-100>,
    "status": "<pass|fail|needs_review>",
    "confidence": <0.0-1.0>,
    "mounting_bracket_visible": <true|false>,
    "wall_plug_visible": <true|false>,
    "issues": [],
    "summary": "<summary>",
    "recommendations": "<improvements>"
}""",

            # Step 6: ONT Back After Install
            "ph_cbl_r": """Analyze this CABLE ROUTE photo (Step 2).

This shows the fiber cable path from pole to house.

Check for:
1. Cable clearly visible running from pole toward house
2. Cable properly supported (not sagging)
3. No visible damage to cable
4. Clear path without obstructions

Rate on 0-100 based on cable visibility and installation quality.

Provide JSON response:
{
    "score": <0-100>,
    "status": "<pass|fail|needs_review>",
    "confidence": <0.0-1.0>,
    "cable_visible": <true|false>,
    "cable_supported": <true|false>,
    "issues": [],
    "summary": "<summary>",
    "recommendations": "<improvements>"
}""",

            # Step 7: Power Meter Reading - Critical
            "ph_powm1": """Analyze this POWER METER READING photo (Step 7 - CRITICAL).

This shows the optical power meter display with dBm reading.

Required:
1. Power meter display clearly visible
2. dBm reading readable
3. Wavelength should be 1490nm
4. Reading should be UNDER -24 dBm (e.g., -23, -20, -18 are GOOD)

Rate on 0-100:
- Reading clearly visible (40 points)
- Reading within range (60 points) - FAIL if worse than -24 dBm

Extract the dBm reading if visible.

Provide JSON response:
{
    "score": <0-100>,
    "status": "<pass|fail|needs_review>",
    "confidence": <0.0-1.0>,
    "display_visible": <true|false>,
    "dbm_reading": "<extracted reading like -18.5>",
    "reading_acceptable": <true|false>,
    "wavelength": "<1490nm or unknown>",
    "issues": [],
    "summary": "<summary>",
    "recommendations": "<improvements>"
}""",

            "ph_powm2": """Analyze this POWER METER READING photo (Step 7B - verification).

Same as Step 7A - verify the reading.

Provide JSON response:
{
    "score": <0-100>,
    "status": "<pass|fail|needs_review>",
    "confidence": <0.0-1.0>,
    "display_visible": <true|false>,
    "dbm_reading": "<extracted reading>",
    "reading_acceptable": <true|false>,
    "issues": [],
    "summary": "<summary>"
}""",

            # NOTE: ONT Barcode (ph_bl) and UPS Serial (ph_ups) are NO LONGER photo steps
            # They are scanned barcodes stored directly in ont_serial_scanned and ups_serial_scanned fields
            # If these photo types are received, map them to Step 6 (ONT Back) evaluation
            "ph_bl": """Analyze this ONT BACK/BARCODE photo (Step 6 - supplementary).

This shows the back of the ONT device, possibly including the serial label.

Check for:
1. ONT back panel visible
2. Fiber cable connection visible
3. Power cable connection visible
4. If barcode/serial visible, note it (not required for pass)

Rate on 0-100 based on ONT back panel visibility.

Provide JSON response:
{
    "score": <0-100>,
    "status": "<pass|fail|needs_review>",
    "confidence": <0.0-1.0>,
    "ont_back_visible": <true|false>,
    "fiber_connection_visible": <true|false>,
    "power_connection_visible": <true|false>,
    "serial_number": "<extracted if visible, else null>",
    "issues": [],
    "summary": "<summary>"
}""",

            # Step 8: Final Installation - Critical (was Step 10)
            "ph_after": """Analyze this FINAL INSTALLATION photo (Step 8 - CRITICAL).

This is a wide shot of the COMPLETE installation with ALL equipment.

Required Elements (v1.2.10 - ONLY these 3 are required):
1. ONT mounted on wall - REQUIRED (reject if missing)
2. GIZZU/Router device connected - REQUIRED (reject if missing)
   NOTE: GIZZU IS a UPS - it is a Mini DC UPS with built-in router
3. Cable management functional - REQUIRED (reject if messy)

DOCUMENTATION ONLY (do NOT reject for this):
4. Drop label - Report if visible, but NEVER reject based on this

Rate on 0-100:
- ONT visible and mounted (35 points)
- GIZZU/UPS visible (35 points)
- Cable management neat (30 points)

Provide JSON response:
{
    "score": <0-100>,
    "status": "<pass|fail|needs_review>",
    "confidence": <0.0-1.0>,
    "ont_visible": <true|false>,
    "ont_mounted": <true|false>,
    "gizzu_visible": <true|false>,
    "cable_management": "<neat|messy|acceptable>",
    "drop_label_visible": <true|false>,
    "issues": [],
    "summary": "<summary>",
    "recommendations": "<improvements>"
}

EXCEPTION: drop_label is NOT a required element - set status=pass even if drop_label_visible=false.
Drop label is checked in Step 9 (Green Lights) instead.""",

            # Step 9: Green Lights - Critical (was Step 11)
            "ph_lights": """Analyze this GREEN LIGHTS photo (Step 9 - CRITICAL).

This shows the ONT/Router front panel with indicator lights.

Required:
1. Front panel with LED indicators visible
2. At least 4 lights must be ON (illuminated)
3. Count ONLY lights that are glowing/lit, not all indicator positions

The Nokia ONT has 7 indicator POSITIONS: POWER, LINK, LAN, WPS, 2.4GHz, 5GHz, INTERNET
Count how many are actually ILLUMINATED (glowing green, blue, or yellow).

Rate on 0-100:
- 4+ lights ON = PASS (80-100 points)
- 3 lights ON = NEEDS REVIEW (50-79 points)
- Less than 3 = FAIL (below 50)

Provide JSON response:
{
    "score": <0-100>,
    "status": "<pass|fail|needs_review>",
    "confidence": <0.0-1.0>,
    "front_panel_visible": <true|false>,
    "lights_on_count": <number>,
    "lights_on_list": ["POWER", "LINK", ...],
    "issues": [],
    "summary": "<X lights are ON: POWER, LINK, etc.>"
}

IMPORTANT: Count only ILLUMINATED lights, not all positions on the device.""",

            # Step 10: Signature - Customer sign-off
            "ph_sign2": """Analyze this CUSTOMER SIGNATURE photo (Step 10 - FINAL).

This shows the customer's signature confirming installation completion.

Required:
1. Signature clearly visible on form/document
2. Signature appears to be handwritten (not printed)
3. Form/document is legible

Rate on 0-100:
- Signature visible (50 points)
- Form legible (30 points)
- Signature appears genuine/handwritten (20 points)

Provide JSON response:
{
    "score": <0-100>,
    "status": "<pass|fail|needs_review>",
    "confidence": <0.0-1.0>,
    "signature_visible": <true|false>,
    "form_legible": <true|false>,
    "signature_handwritten": <true|false>,
    "issues": [],
    "summary": "<summary>",
    "recommendations": "<improvements>"
}

NOTE: This is the final step confirming customer acceptance of the installation.""",

            # Map ph_signature to the same prompt as ph_sign2
            "ph_signature": """Analyze this CUSTOMER SIGNATURE photo (Step 10 - FINAL).

This shows the customer's signature confirming installation completion.

Required:
1. Signature clearly visible on form/document
2. Signature appears to be handwritten (not printed)
3. Form/document is legible

Rate on 0-100:
- Signature visible (50 points)
- Form legible (30 points)
- Signature appears genuine/handwritten (20 points)

Provide JSON response:
{
    "score": <0-100>,
    "status": "<pass|fail|needs_review>",
    "confidence": <0.0-1.0>,
    "signature_visible": <true|false>,
    "form_legible": <true|false>,
    "signature_handwritten": <true|false>,
    "issues": [],
    "summary": "<summary>",
    "recommendations": "<improvements>"
}

NOTE: This is the final step confirming customer acceptance of the installation."""
        }

        # Map photo types to prompts with fallbacks
        photo_type_clean = photo_type.replace('_2', '').replace('_3', '')  # Handle ph_prop_2, ph_prop_3, etc.

        if photo_type_clean in step_prompts:
            return step_prompts[photo_type_clean]

        # Fallback prompts for unmapped types
        fallback_prompts = {
            "ph_sign1": "Analyze this CUSTOMER SIGNATURE photo. Check for legible signature and completed form.",
            "ph_sign2": "Analyze this second CUSTOMER SIGNATURE photo.",
            "ph_sign3": "Analyze this third CUSTOMER SIGNATURE photo.",
            "ph_drop": "Analyze this DROP CABLE photo. Check for proper cable routing and protection from elements.",
            "ph_outs": "Analyze this OUTSIDE INSTALLATION overview photo. Check for overall installation quality and weatherproofing.",
            "ph_conn1": "Analyze this CONNECTION photo. Check for proper fiber connectors and secure connections.",
            "ph_hh1": "Analyze this HOUSE photo. Check for property visibility and address identification.",
            "ph_hh2": "Analyze this second HOUSE photo.",
            "ph_ont": "Analyze this ONT BACK PANEL photo. Check for fiber and power connections visible.",
            "ph_ont_back": "Analyze this ONT BACK PANEL photo. Check for fiber and power cable connections.",
            "ph_entry_out": "Analyze this CABLE ENTRY OUTSIDE photo. Check for cable entry point visible from exterior.",
            "ph_entry_in": "Analyze this CABLE ENTRY INSIDE photo. Check for cable entry point visible from interior.",
            "ph_cbl": "Analyze this CABLE photo. Check for proper cable routing and support.",
            "ph_powm": "Analyze this POWER METER photo. Check for dBm reading visibility (should be under -24 dBm).",
            "ph_power": "Analyze this POWER METER photo. Check for dBm reading.",
            "ph_barcode": "Analyze this BARCODE/SERIAL photo. Extract serial number if visible.",
            "ph_label": "Analyze this LABEL photo. Extract any serial numbers or identification.",
            "ph_final": "Analyze this FINAL INSTALLATION photo. Check for ONT, UPS/GIZZU, and cable management.",
            "ph_led": "Analyze this LED INDICATOR photo. Count illuminated lights (need 4+ for PASS).",
            "ph_ont_led": "Analyze this ONT LED INDICATOR photo. Count illuminated lights."
        }

        if photo_type_clean in fallback_prompts:
            return fallback_prompts[photo_type_clean] + """

Provide JSON response:
{
    "score": <0-100>,
    "status": "<pass|fail|needs_review>",
    "confidence": <0.0-1.0>,
    "issues": [],
    "summary": "<summary>"
}"""

        # Ultimate fallback - generic but NOT installation-focused
        return f"""Analyze this {photo_type} photo.

Evaluate the photo quality and content visibility.

Provide JSON response:
{{
    "score": <0-100>,
    "status": "<pass|fail|needs_review>",
    "confidence": <0.0-1.0>,
    "issues": [],
    "summary": "<summary>"
}}"""
    def _parse_evaluation_response(self, text: str) -> Dict[str, Any]:
        """Parse AI text response into structured data."""
        try:
            # Try to extract JSON from the response
            json_start = text.find("{")
            json_end = text.rfind("}") + 1

            if json_start >= 0 and json_end > json_start:
                json_str = text[json_start:json_end]
                return json.loads(json_str)
            else:
                # Fallback: create basic response from text
                return {
                    "score": 50,
                    "status": "needs_review",
                    "confidence": 0.5,
                    "summary": text[:200] if text else "Unable to parse response",
                    "analysis": text,
                    "issues": []
                }
        except json.JSONDecodeError:
            return {
                "score": 50,
                "status": "needs_review",
                "confidence": 0.5,
                "summary": "JSON parse error",
                "analysis": text,
                "issues": ["Could not parse AI response"]
            }

    async def evaluate_dr_photos(
        self,
        dr_number: str,
        photos_path: Path
    ) -> Dict[str, Any]:
        """Evaluate all photos for a DR number using cascade.

        Args:
            dr_number: The DR number
            photos_path: Path to the directory containing photos

        Returns:
            Dict with overall evaluation and per-photo results
        """
        if not photos_path.exists():
            return {
                "dr_number": dr_number,
                "status": "error",
                "error": f"No photos found at {photos_path}"
            }

        photo_files = list(photos_path.glob("*.jpg")) + list(photos_path.glob("*.jpeg")) + list(photos_path.glob("*.png"))

        if not photo_files:
            return {
                "dr_number": dr_number,
                "status": "error",
                "error": "No photo files found"
            }

        results = []
        total_score = 0
        evaluated_count = 0
        total_cost = 0.0
        providers_used = {"gemini": 0, "openai": 0, "claude": 0}

        for photo_file in photo_files:
            # Extract photo type from filename
            parts = photo_file.stem.split("_")
            photo_type = "_".join(parts[1:-1]) if len(parts) > 2 else "unknown"

            eval_result = await self.evaluate_photo(photo_file, photo_type)
            eval_result["filename"] = photo_file.name
            eval_result["photo_type"] = photo_type
            results.append(eval_result)

            if eval_result.get("overall_score") is not None:
                total_score += eval_result["overall_score"]
                evaluated_count += 1

            # Track cost and providers
            total_cost += eval_result.get("total_cost", 0.0)
            provider = eval_result.get("provider")
            if provider and provider in providers_used:
                providers_used[provider] += 1

        # Calculate overall DR evaluation
        avg_score = total_score / evaluated_count if evaluated_count > 0 else 0
        passed_count = sum(1 for r in results if r.get("overall_status") == "pass")
        failed_count = sum(1 for r in results if r.get("overall_status") == "fail")

        if avg_score >= 80 and failed_count == 0:
            overall_status = "pass"
        elif avg_score < 50 or failed_count > len(results) / 2:
            overall_status = "fail"
        else:
            overall_status = "needs_review"

        return {
            "dr_number": dr_number,
            "status": "completed",
            "total_photos": len(photo_files),
            "evaluated_photos": evaluated_count,
            "average_score": round(avg_score, 1),
            "overall_status": overall_status,
            "passed_count": passed_count,
            "failed_count": failed_count,
            "needs_review_count": len(results) - passed_count - failed_count,
            "total_cost": round(total_cost, 4),
            "providers_used": providers_used,
            "evaluations": results,
            "evaluated_at": datetime.utcnow().isoformat()
        }


# Initialize cascade evaluator (supports Gemini → OpenAI → Claude)
cascade_evaluator = CascadeVisionEvaluator(
    gemini_api_key=GEMINI_API_KEY,
    openai_api_key=OPENAI_API_KEY,
    anthropic_api_key=ANTHROPIC_API_KEY,
    claude_vision_url=CLAUDE_VISION_URL
)

# Backward compatibility alias
gemini_evaluator = cascade_evaluator


# =============================================================================
# RESPONSE MODELS
# =============================================================================

class DRRecordResponse(BaseModel):
    dr_number: str
    site: str
    site_name: str
    status: Optional[str]
    address: Optional[str]
    photo_count: int
    photos: dict
    coordinates: Optional[dict]
    local_photos: List[dict] = []
    # Serial fields from 1Map (extracted from ALL property records)
    ont_barcode: Optional[str] = None  # ph_ont field from 1Map - ONT Barcode
    ups_serial: Optional[str] = None   # br_ser field from 1Map - Mini-UPS/Gizzu serial


class DownloadResponse(BaseModel):
    dr_number: str
    photos_downloaded: int
    output_path: str
    files: List[str]


class VerificationResponse(BaseModel):
    dr_number: str
    site: str
    status: Optional[str]
    verified: bool
    required_photos: List[str]
    available_photos: List[str]
    missing_photos: List[str]
    photo_count: int
    address: Optional[str]


class PhotoEvaluationRequest(BaseModel):
    dr_number: str
    evaluate_all: bool = True
    photo_types: Optional[List[str]] = None


class PhotoEvaluationResponse(BaseModel):
    dr_number: str
    status: str
    total_photos: int
    evaluated_photos: int
    average_score: Optional[float]
    overall_status: str
    passed_count: int
    failed_count: int
    needs_review_count: int
    evaluations: List[Dict[str, Any]]
    evaluated_at: str


class PhotoListResponse(BaseModel):
    dr_number: str
    total_photos: int
    photos: List[Dict[str, Any]]


class AllPhotosResponse(BaseModel):
    total_drs: int
    total_photos: int
    drs: List[Dict[str, Any]]


# =============================================================================
# APPLICATION SETUP
# =============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan."""
    logger.info("🚀 DR Photo Verification API starting...")
    logger.info(f"📁 Photos directory: {PHOTOS_BASE_PATH}")
    # Initialize database connection
    await db.connect()
    yield
    # Cleanup database connection
    await db.disconnect()
    logger.info("🛑 DR Photo Verification API shutting down...")


app = FastAPI(
    title="DR Photo Verification API",
    description="REST API for DR installation photo verification workflow",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =============================================================================
# WEB UI
# =============================================================================

@app.get("/", response_class=HTMLResponse)
async def home():
    """Serve the DR Photos web interface."""
    return """
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>DR Photo Verification</title>
        <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #1a1a2e; color: #eee; min-height: 100vh; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; text-align: center; }
            .header h1 { font-size: 24px; margin-bottom: 5px; }
            .header p { opacity: 0.9; font-size: 14px; }
            .container { max-width: 1400px; margin: 0 auto; padding: 20px; }
            .search-box { background: #16213e; padding: 20px; border-radius: 12px; margin-bottom: 20px; display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
            .search-box input { flex: 1; min-width: 200px; padding: 14px 18px; font-size: 16px; border: 2px solid #334155; border-radius: 8px; background: #0f172a; color: #fff; }
            .search-box input:focus { border-color: #667eea; outline: none; }
            .search-box button { padding: 14px 28px; font-size: 16px; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; transition: all 0.2s; }
            .btn-search { background: #667eea; color: white; }
            .btn-search:hover { background: #5a67d8; transform: translateY(-1px); }
            .btn-download { background: #10b981; color: white; }
            .btn-download:hover { background: #059669; transform: translateY(-1px); }
            .result { background: #16213e; padding: 25px; border-radius: 12px; margin-bottom: 20px; }
            .result h2 { color: #fff; margin-bottom: 20px; display: flex; align-items: center; gap: 15px; flex-wrap: wrap; }
            .info-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 15px; }
            .serial-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 25px; }
            .info-item { background: #0f172a; padding: 15px; border-radius: 8px; border-left: 3px solid #667eea; transition: all 0.2s; position: relative; }
            .info-item:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
            .info-item label { font-size: 11px; color: #94a3b8; display: block; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 5px; }
            .info-item span { font-size: 16px; font-weight: 500; color: #fff; word-break: break-all; }
            .info-item.serial { cursor: pointer; }
            .info-item.serial:active { transform: translateY(0); }
            .info-item.serial .copy-hint { position: absolute; top: 10px; right: 10px; font-size: 10px; color: #64748b; opacity: 0; transition: opacity 0.2s; }
            .info-item.serial:hover .copy-hint { opacity: 1; }
            .serial-value { font-family: 'Courier New', monospace; letter-spacing: 0.5px; }
            .photos-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 20px; }
            .photo-card { background: #0f172a; border-radius: 12px; overflow: hidden; transition: transform 0.2s; }
            .photo-card:hover { transform: translateY(-4px); }
            .photo-card img { width: 100%; height: 220px; object-fit: cover; cursor: pointer; }
            .photo-card .caption { padding: 12px 15px; font-size: 13px; color: #94a3b8; background: #1e293b; }
            .photo-card .caption strong { color: #fff; display: block; margin-bottom: 3px; }
            .status-badge { display: inline-block; padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: 600; }
            .status-badge.success { background: #065f46; color: #34d399; }
            .status-badge.warning { background: #78350f; color: #fbbf24; }
            .loading { text-align: center; padding: 60px; color: #94a3b8; }
            .loading::after { content: ''; display: block; width: 40px; height: 40px; margin: 20px auto; border: 3px solid #334155; border-top-color: #667eea; border-radius: 50%; animation: spin 1s linear infinite; }
            @keyframes spin { to { transform: rotate(360deg); } }
            @keyframes slideIn { from { transform: translateX(400px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
            @keyframes slideOut { from { transform: translateX(0); opacity: 1; } to { transform: translateX(400px); opacity: 0; } }
            .error { background: #7f1d1d; color: #fca5a5; padding: 20px; border-radius: 8px; }
            .empty-state { text-align: center; padding: 40px; background: #1e293b; border-radius: 8px; margin-top: 20px; }
            .empty-state p { color: #94a3b8; margin-bottom: 15px; }
            .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.95); z-index: 1000; justify-content: center; align-items: center; }
            .modal img { max-width: 95%; max-height: 95%; border-radius: 8px; }
            .modal.active { display: flex; }
            .close-modal { position: absolute; top: 20px; right: 30px; color: white; font-size: 40px; cursor: pointer; opacity: 0.8; }
            .close-modal:hover { opacity: 1; }
            .quick-links { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 15px; }
            .quick-links button { padding: 8px 16px; font-size: 13px; background: #334155; color: #94a3b8; border: none; border-radius: 6px; cursor: pointer; }
            .quick-links button:hover { background: #475569; color: #fff; }
            .btn-zip { background: #f59e0b; color: white; margin-left: auto; }
            .btn-zip:hover { background: #d97706; transform: translateY(-1px); }
            .photo-actions { display: flex; justify-content: space-between; align-items: center; }
            .save-link { padding: 4px 10px; font-size: 12px; background: #334155; color: #94a3b8; border-radius: 4px; text-decoration: none; }
            .save-link:hover { background: #475569; color: #fff; }
            .photos-header { display: flex; align-items: center; gap: 15px; margin: 25px 0 20px; }
            .photos-header h3 { color: #94a3b8; margin: 0; }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>🔍 DR Photo Verification</h1>
            <p>Quality assurance for Fibertime installations</p>
        </div>

        <div class="container">
            <div class="search-box">
                <input type="text" id="drInput" placeholder="Enter DR number (e.g., DR1733592)" onkeypress="if(event.key==='Enter')searchDR()">
                <button class="btn-search" onclick="searchDR()">🔍 Search</button>
                <button class="btn-download" onclick="downloadPhotos()">📥 Download Photos</button>
            </div>

            <div class="quick-links">
                <span style="color: #94a3b8; padding: 8px 0;">Quick search:</span>
                <button onclick="quickSearch('DR1733592')">DR1733592</button>
                <button onclick="quickSearch('DR1733806')">DR1733806</button>
                <button onclick="quickSearch('DR1855312')">DR1855312</button>
                <button onclick="quickSearch('DR1733668')">DR1733668</button>
            </div>

            <div id="result"></div>
        </div>

        <div class="modal" id="imageModal" onclick="closeModal()">
            <span class="close-modal">&times;</span>
            <img id="modalImage" src="">
        </div>

        <script>
            function copyToClipboard(text, label) {
                navigator.clipboard.writeText(text).then(() => {
                    // Show temporary success message
                    const msg = document.createElement('div');
                    msg.textContent = `✅ ${label} copied: ${text}`;
                    msg.style.cssText = 'position: fixed; top: 20px; right: 20px; background: #10b981; color: white; padding: 12px 20px; border-radius: 8px; font-size: 14px; z-index: 9999; animation: slideIn 0.3s ease-out;';
                    document.body.appendChild(msg);
                    setTimeout(() => {
                        msg.style.animation = 'slideOut 0.3s ease-out';
                        setTimeout(() => msg.remove(), 300);
                    }, 2000);
                }).catch(err => {
                    console.error('Failed to copy:', err);
                });
            }

            function quickSearch(dr) {
                document.getElementById('drInput').value = dr;
                searchDR();
            }

            async function searchDR() {
                const dr = document.getElementById('drInput').value.trim();
                if (!dr) return;

                const resultDiv = document.getElementById('result');
                resultDiv.innerHTML = '<div class="loading">Searching 1Map...</div>';

                try {
                    const response = await fetch(`/api/record/${dr}`);
                    if (!response.ok) {
                        const error = await response.json();
                        throw new Error(error.detail || 'DR not found');
                    }
                    const data = await response.json();
                    displayResult(data);
                } catch (error) {
                    resultDiv.innerHTML = `<div class="error">❌ ${error.message}</div>`;
                }
            }

            async function downloadPhotos() {
                const dr = document.getElementById('drInput').value.trim();
                if (!dr) return;

                const resultDiv = document.getElementById('result');
                resultDiv.innerHTML = '<div class="loading">Downloading photos from 1Map...</div>';

                try {
                    const response = await fetch(`/api/download/${dr}`, { method: 'POST' });
                    if (!response.ok) {
                        const error = await response.json();
                        throw new Error(error.detail || 'Download failed');
                    }
                    const data = await response.json();
                    resultDiv.innerHTML = `
                        <div class="result">
                            <h2>✅ Download Complete</h2>
                            <p style="color: #94a3b8; margin-bottom: 15px;">Downloaded ${data.photos_downloaded} photos</p>
                            <p style="color: #64748b; font-size: 13px;">Path: ${data.output_path}</p>
                        </div>
                    `;
                    setTimeout(searchDR, 1500);
                } catch (error) {
                    resultDiv.innerHTML = `<div class="error">❌ ${error.message}</div>`;
                }
            }

            function displayResult(data) {
                const resultDiv = document.getElementById('result');
                const hasPhotos = data.local_photos && data.local_photos.length > 0;

                let photosHTML = '';
                if (hasPhotos) {
                    const photoTypes = {
                        'ph_prop': '🏠 Property',
                        'ph_sign1': '✍️ Signature 1',
                        'ph_sign2': '✍️ Signature 2',
                        'ph_powm1': '⚡ Power Meter 1',
                        'ph_powm2': '⚡ Power Meter 2',
                        'ph_drop': '📡 Drop Cable',
                        'ph_wall': '🧱 Wall Mount',
                        'ph_hm_ln': '🔌 Home Line',
                        'ph_hm_en': '🚪 Home Entry',
                        'ph_outs': '🌳 Outside',
                        'ph_after': '✅ After',
                        'ph_bl': '📦 Box Label',
                        'ph_cbl_r': '🔗 Cable Route',
                        'ph_hh1': '🏠 Household 1',
                        'ph_hh2': '🏠 Household 2',
                        'ph_conn1': '🔌 Connection'
                    };

                    photosHTML = `
                        <div style="display: flex; justify-content: space-between; align-items: center; margin: 25px 0 20px;">
                            <h3 style="margin: 0; color: #94a3b8;">📷 Photos (${data.local_photos.length})</h3>
                            <button class="btn-zip" onclick="downloadZip('${data.dr_number}')">📦 Download ZIP</button>
                        </div>
                        <div class="photos-grid">
                            ${data.local_photos.map(p => {
                                const typeName = photoTypes[p.type] || p.type;
                                const sizeKB = Math.round(p.size / 1024);
                                return `
                                <div class="photo-card">
                                    <img src="/api/photo/${data.dr_number}/${p.filename}"
                                         alt="${typeName}"
                                         onclick="openModal(this.src)"
                                         loading="lazy">
                                    <div class="caption">
                                        <strong>${typeName}</strong>
                                        ${sizeKB} KB
                                    </div>
                                </div>
                            `}).join('')}
                        </div>
                    `;
                } else {
                    photosHTML = `
                        <div class="empty-state">
                            <p>📥 No photos downloaded yet</p>
                            <button class="btn-download" onclick="downloadPhotos()">Download Photos from 1Map</button>
                        </div>
                    `;
                }

                const statusBadge = data.photo_count >= 10
                    ? '<span class="status-badge success">✓ Complete</span>'
                    : '<span class="status-badge warning">⚠ Incomplete</span>';

                resultDiv.innerHTML = `
                    <div class="result">
                        <h2>${data.dr_number} ${statusBadge}</h2>

                        <div class="info-grid">
                            <div class="info-item">
                                <label>Site</label>
                                <span>${data.site} (${data.site_name})</span>
                            </div>
                            <div class="info-item">
                                <label>Status</label>
                                <span>${data.status || 'N/A'}</span>
                            </div>
                            <div class="info-item">
                                <label>Address</label>
                                <span>${data.address || 'N/A'}</span>
                            </div>
                            <div class="info-item">
                                <label>Photos in 1Map</label>
                                <span>${data.photo_count}</span>
                            </div>
                            <div class="info-item">
                                <label>Downloaded</label>
                                <span>${data.local_photos ? data.local_photos.length : 0}</span>
                            </div>
                        </div>

                        <div class="serial-grid">
                            <div class="info-item serial ${data.ont_barcode ? '' : 'missing'}"
                                 style="${data.ont_barcode ? 'border-left-color: #10b981;' : 'border-left-color: #f59e0b;'}"
                                 onclick="${data.ont_barcode ? `copyToClipboard('${data.ont_barcode}', 'ONT Serial')` : ''}">
                                <label>📦 ONT Serial</label>
                                <span class="serial-value">${data.ont_barcode || 'Not synced'}</span>
                                ${data.ont_barcode ? '<span class="copy-hint">Click to copy</span>' : ''}
                            </div>
                            <div class="info-item serial ${data.ups_serial ? '' : 'missing'}"
                                 style="${data.ups_serial ? 'border-left-color: #10b981;' : 'border-left-color: #f59e0b;'}"
                                 onclick="${data.ups_serial ? `copyToClipboard('${data.ups_serial}', 'UPS Serial')` : ''}">
                                <label>🔋 UPS Serial</label>
                                <span class="serial-value">${data.ups_serial || 'Not synced'}</span>
                                ${data.ups_serial ? '<span class="copy-hint">Click to copy</span>' : ''}
                            </div>
                        </div>

                        ${photosHTML}
                    </div>
                `;
            }

            function openModal(src) {
                document.getElementById('modalImage').src = src;
                document.getElementById('imageModal').classList.add('active');
            }

            function downloadZip(drNumber) {
                window.location.href = '/api/download-zip/' + drNumber;
            }

            function closeModal() {
                document.getElementById('imageModal').classList.remove('active');
            }

            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') closeModal();
            });
        </script>
    </body>
    </html>
    """


# =============================================================================
# API ENDPOINTS
# =============================================================================

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "DR Photo Verification API",
        "photos_path": str(PHOTOS_BASE_PATH)
    }


@app.get("/api/record/{dr_number}", response_model=DRRecordResponse)
async def get_dr_record(dr_number: str):
    """Get DR record details from 1Map."""
    try:
        async with OneMapSpecialistAgent() as agent:
            record = await agent.get_dr(dr_number)

            if not record:
                raise HTTPException(status_code=404, detail=f"DR {dr_number} not found in 1Map")

            # Check for local photos
            local_photos = []
            dr_path = PHOTOS_BASE_PATH / dr_number
            if dr_path.exists():
                for photo_file in sorted(dr_path.glob("*.jpg")):
                    parts = photo_file.stem.split("_")
                    photo_type = "_".join(parts[1:-1]) if len(parts) > 2 else "unknown"
                    local_photos.append({
                        "filename": photo_file.name,
                        "type": photo_type,
                        "size": photo_file.stat().st_size
                    })

            # Extract ONT barcode (ph_ont) and UPS serial (br_ser) from ALL property records
            # Each DR can have multiple property records (like transactions)
            ont_barcode = None
            ups_serial = None
            
            property_records = getattr(record, 'property_records', []) or []
            for prop_record in property_records:
                raw_data = getattr(prop_record, 'raw_data', {}) or {}
                # Get first non-empty value found
                if not ont_barcode and raw_data.get('ph_ont'):
                    ont_barcode = raw_data.get('ph_ont')
                if not ups_serial and raw_data.get('br_ser'):
                    ups_serial = raw_data.get('br_ser')
                # Stop searching if we found both
                if ont_barcode and ups_serial:
                    break
            
            # Fallback: check main record raw_data if not found in property records
            if not ont_barcode or not ups_serial:
                main_raw_data = getattr(record, 'raw_data', {}) or {}
                if not ont_barcode:
                    ont_barcode = main_raw_data.get('ph_ont')
                if not ups_serial:
                    ups_serial = main_raw_data.get('br_ser')

            return {
                "dr_number": record.dr_number,
                "site": record.site,
                "site_name": agent.get_site_name(record.site),
                "status": record.status,
                "address": record.address,
                "photo_count": len(record.photos),
                "photos": record.photos,
                "coordinates": record.coordinates,
                "local_photos": local_photos,
                "ont_barcode": ont_barcode,
                "ups_serial": ups_serial
            }

    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching DR {dr_number}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/download/{dr_number}", response_model=DownloadResponse)
async def download_dr_photos(dr_number: str):
    """
    Download all photos for a DR from 1Map and store metadata in database.

    Phase 2.4: Enhanced with GPS extraction and validation.
    """
    try:
        async with OneMapSpecialistAgent() as agent:
            record = await agent.get_dr(dr_number)

            if not record:
                raise HTTPException(status_code=404, detail=f"DR {dr_number} not found")

            output_dir = PHOTOS_BASE_PATH / dr_number
            photos = await agent.download_all_photos(record, str(output_dir))

            # Get DR site coordinates for GPS validation
            site_coords = None
            if record.coordinates:
                site_coords = (
                    record.coordinates["lat"],
                    record.coordinates["lng"]
                )
                logger.info(f"DR {dr_number} site coordinates: {site_coords}")

            # Initialize GPS validator
            gps_validator = GPSValidator()

            files = []
            gps_summary = {
                "total": 0,
                "approved": 0,
                "needs_review": 0,
                "rejected": 0,
                "missing_gps": 0
            }

            # Store metadata for each downloaded photo (with GPS extraction)
            for p in photos:
                filename = f"{record.dr_number}_{p.photo_type}_{p.attachment_id}.jpg"
                files.append(filename)

                # Get file info for database storage
                file_path = output_dir / filename
                if file_path.exists():
                    file_size = file_path.stat().st_size
                    # Calculate file hash
                    with open(file_path, 'rb') as f:
                        file_hash = hashlib.md5(f.read()).hexdigest()

                    # Phase 2.4: Extract GPS/EXIF metadata
                    gps_metadata = extract_gps_metadata(file_path)

                    # Validate GPS location if available
                    gps_validation_status = None
                    gps_distance_km = None

                    if gps_metadata["has_gps"] and site_coords:
                        photo_coords = (
                            gps_metadata["latitude"],
                            gps_metadata["longitude"]
                        )

                        validation = gps_validator.validate_photo_location(
                            photo_coords=photo_coords,
                            site_coords=site_coords,
                            require_gps=False  # GPS optional for now
                        )

                        gps_validation_status = validation["status"].value
                        gps_distance_km = validation["distance_m"] / 1000 if validation["distance_m"] else None

                        # Update summary counts
                        if validation["status"] == GPSValidationStatus.APPROVED:
                            gps_summary["approved"] += 1
                        elif validation["status"] == GPSValidationStatus.NEEDS_LOCATION_REVIEW:
                            gps_summary["needs_review"] += 1
                        elif validation["status"] == GPSValidationStatus.WRONG_LOCATION:
                            gps_summary["rejected"] += 1
                        elif validation["status"] == GPSValidationStatus.MISSING_GPS:
                            gps_summary["missing_gps"] += 1

                        logger.info(
                            f"Photo {filename}: GPS {validation['status'].value}, "
                            f"distance={gps_distance_km:.3f}km" if gps_distance_km else "GPS missing"
                        )
                    else:
                        gps_validation_status = GPSValidationStatus.MISSING_GPS.value
                        gps_summary["missing_gps"] += 1
                        logger.warning(f"Photo {filename}: No GPS data available")

                    gps_summary["total"] += 1

                    # Store in database (with GPS metadata)
                    await db.store_photo_metadata(
                        dr_number=record.dr_number,
                        project=agent.get_site_name(record.site) or record.site,
                        filename=filename,
                        file_path=str(file_path),
                        file_size=file_size,
                        file_hash=file_hash,
                        photo_type=p.photo_type,
                        onemap_layer_id=str(p.layer_id) if hasattr(p, 'layer_id') and p.layer_id else None,
                        onemap_attachment_id=str(p.attachment_id) if p.attachment_id else None,
                        gps_metadata=gps_metadata,
                        gps_validation_status=gps_validation_status,
                        gps_distance_km=gps_distance_km
                    )

            return {
                "dr_number": dr_number,
                "photos_downloaded": len(photos),
                "output_path": str(output_dir),
                "files": files,
                "gps_summary": gps_summary  # Phase 2.4: Include GPS validation summary
            }

    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error downloading photos for DR {dr_number}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/photo/{dr_number}/{filename}")
async def serve_photo(
    dr_number: str, 
    filename: str, 
    download: Optional[int] = Query(None),
    project: str = Query("LAW")
):
    """Serve a photo file. Fetches from 1Map if not on disk."""
    import re
    from fastapi.responses import Response

    photo_path = PHOTOS_BASE_PATH / dr_number / filename

    # If file exists on disk and is a valid image (>1KB), serve it
    if photo_path.exists() and photo_path.stat().st_size > 0:
        if download:
            return FileResponse(
                photo_path,
                media_type="image/jpeg",
                filename=filename,
                headers={"Content-Disposition": f"attachment; filename={filename}"}
            )
        return FileResponse(
            photo_path,
            media_type="image/jpeg",
            filename=filename
        )

    # Try to extract photo_type and attachment_id from filename
    match = re.match(r"(ph_[a-z0-9_]+)_(\d+)\.jpg$", filename, re.IGNORECASE)
    if match:
        photo_type = match.group(1)
        attachment_id = int(match.group(2))
        logger.info(f"Fetching 1Map photo: {filename} (type={photo_type}, id={attachment_id})")

        # First try to get primary_id from session file
        primary_id = None
        session_file = DR_SESSIONS_DIR / project / f"session_{dr_number}.json"
        if session_file.exists():
            try:
                with open(session_file, 'r') as f:
                    session = json.load(f)
                for photo in session.get('photos', []):
                    if isinstance(photo, dict) and photo.get('photo_id') == attachment_id:
                        primary_id = photo.get('primary_id')
                        break
            except Exception as e:
                logger.warning(f"Could not read session file: {e}")

        try:
            async with OneMapSpecialistAgent() as agent:
                if not primary_id:
                    record = await agent.get_dr(dr_number)
                    if record:
                        property_records = getattr(record, 'property_records', []) or []
                        for prop_record in property_records:
                            prop_photos = getattr(prop_record, 'photos', {}) or {}
                            if attachment_id in prop_photos.values():
                                primary_id = str(prop_record.primary_id)
                                break
                        if not primary_id:
                            primary_id = str(record.primary_id) if record.primary_id else None
                
                if primary_id:
                    photo_result = await agent.download_photo(primary_id, attachment_id, photo_type)
                    if photo_result and photo_result.content and len(photo_result.content) > 1000:
                        photo_path.parent.mkdir(parents=True, exist_ok=True)
                        with open(photo_path, 'wb') as f:
                            f.write(photo_result.content)
                        logger.info(f"Cached 1Map photo: {photo_path} ({len(photo_result.content)} bytes)")

                        headers = {}
                        if download:
                            headers["Content-Disposition"] = f"attachment; filename={filename}"
                        return Response(
                            content=photo_result.content,
                            media_type="image/jpeg",
                            headers=headers
                        )
                    else:
                        logger.warning(f"1Map returned empty/small response for photo {attachment_id}")
                else:
                    logger.warning(f"Could not find primary_id for photo {attachment_id}")
        except Exception as e:
            logger.error(f"Error fetching 1Map photo {attachment_id}: {e}")
            import traceback
            logger.error(traceback.format_exc())

    raise HTTPException(status_code=404, detail="Photo not found")


@app.get("/api/download-zip/{dr_number}")
async def download_photos_zip(dr_number: str):
    """Download all photos for a DR as a ZIP file to user's local PC."""
    dr_path = PHOTOS_BASE_PATH / dr_number

    if not dr_path.exists():
        raise HTTPException(status_code=404, detail=f"No photos found for {dr_number}. Please download from 1Map first.")

    # Get all photo files
    photo_files = list(dr_path.glob("*.jpg")) + list(dr_path.glob("*.jpeg")) + list(dr_path.glob("*.png"))

    if not photo_files:
        raise HTTPException(status_code=404, detail=f"No photos found for {dr_number}")

    # Create ZIP in memory
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
        for photo_file in photo_files:
            zip_file.write(photo_file, photo_file.name)

    zip_buffer.seek(0)

    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={
            "Content-Disposition": f"attachment; filename={dr_number}_photos.zip"
        }
    )


@app.get("/api/verify/{dr_number}", response_model=VerificationResponse)
async def verify_dr_photos(
    dr_number: str,
    required: Optional[str] = Query(None, description="Comma-separated required photo types")
):
    """Verify that a DR has required photos."""
    try:
        required_photos = None
        if required:
            required_photos = [p.strip() for p in required.split(",")]

        async with OneMapSpecialistAgent() as agent:
            result = await agent.verify_dr_photos(dr_number, required_photos)

            if "error" in result:
                raise HTTPException(status_code=404, detail=result["error"])

            return result

    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error verifying DR {dr_number}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/sites")
async def list_sites():
    """List all known project sites."""
    async with OneMapSpecialistAgent() as agent:
        return {"sites": agent.list_known_sites()}


@app.get("/api/search")
async def search_records(
    site: Optional[str] = Query(None, description="Site code"),
    dr_pattern: Optional[str] = Query(None, description="DR pattern with wildcards"),
    limit: int = Query(50, description="Maximum results")
):
    """Search DR records."""
    try:
        async with OneMapSpecialistAgent() as agent:
            if site:
                records = await agent.search_by_project(site, limit=limit)
            elif dr_pattern:
                records = await agent.search_dr(dr_pattern, limit=limit)
            else:
                raise HTTPException(status_code=400, detail="Provide site or dr_pattern parameter")

            return {
                "count": len(records),
                "records": [
                    {
                        "dr_number": r.dr_number,
                        "site": r.site,
                        "status": r.status,
                        "photo_count": len(r.photos)
                    }
                    for r in records
                ]
            }

    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error searching records: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# PHOTO MANAGEMENT API ENDPOINTS
# =============================================================================

@app.get("/api/photos", response_model=AllPhotosResponse)
async def list_all_photos():
    """List all downloaded photos across all DRs.

    Returns a summary of all DRs with downloaded photos, including
    photo counts and file details.
    """
    drs = []
    total_photos = 0

    if PHOTOS_BASE_PATH.exists():
        for dr_dir in sorted(PHOTOS_BASE_PATH.iterdir()):
            if dr_dir.is_dir() and dr_dir.name.startswith("DR"):
                photo_files = list(dr_dir.glob("*.jpg")) + list(dr_dir.glob("*.jpeg")) + list(dr_dir.glob("*.png"))

                if photo_files:
                    photos_info = []
                    total_size = 0

                    for photo_file in sorted(photo_files):
                        parts = photo_file.stem.split("_")
                        photo_type = "_".join(parts[1:-1]) if len(parts) > 2 else "unknown"
                        file_size = photo_file.stat().st_size
                        total_size += file_size

                        photos_info.append({
                            "filename": photo_file.name,
                            "type": photo_type,
                            "size": file_size,
                            "modified": datetime.fromtimestamp(photo_file.stat().st_mtime).isoformat()
                        })

                    drs.append({
                        "dr_number": dr_dir.name,
                        "photo_count": len(photo_files),
                        "total_size": total_size,
                        "photos": photos_info
                    })
                    total_photos += len(photo_files)

    return {
        "total_drs": len(drs),
        "total_photos": total_photos,
        "drs": drs
    }


@app.get("/api/photos/{dr_number}", response_model=PhotoListResponse)
async def list_dr_photos(dr_number: str):
    """List all downloaded photos for a specific DR.

    Returns detailed information about each photo including
    file metadata and photo type classification.
    """
    dr_path = PHOTOS_BASE_PATH / dr_number

    if not dr_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"No photos found for {dr_number}. Use POST /api/download/{dr_number} to download photos first."
        )

    photo_files = list(dr_path.glob("*.jpg")) + list(dr_path.glob("*.jpeg")) + list(dr_path.glob("*.png"))

    if not photo_files:
        raise HTTPException(status_code=404, detail=f"No photo files found for {dr_number}")

    photos = []
    for photo_file in sorted(photo_files):
        parts = photo_file.stem.split("_")
        photo_type = "_".join(parts[1:-1]) if len(parts) > 2 else "unknown"
        stat = photo_file.stat()

        # Calculate file hash for deduplication/verification
        with open(photo_file, "rb") as f:
            file_hash = hashlib.md5(f.read()).hexdigest()

        photos.append({
            "filename": photo_file.name,
            "type": photo_type,
            "size": stat.st_size,
            "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            "hash": file_hash,
            "url": f"/api/photo/{dr_number}/{photo_file.name}"
        })

    return {
        "dr_number": dr_number,
        "total_photos": len(photos),
        "photos": photos
    }


# =============================================================================
# AI PHOTO EVALUATION API ENDPOINTS
# =============================================================================

@app.post("/api/evaluate/{dr_number}", response_model=PhotoEvaluationResponse)
async def evaluate_dr_photos_endpoint(
    dr_number: str,
    background_tasks: BackgroundTasks,
    force: bool = Query(False, description="Force re-evaluation even if already evaluated")
):
    """Trigger AI evaluation of all photos for a DR.

    Uses Gemini Vision API to analyze each photo and provide:
    - Installation quality score (0-100)
    - Safety compliance score (0-100)
    - Documentation quality score (0-100)
    - Equipment visibility score (0-100)
    - Overall pass/fail/needs_review status
    - Detailed analysis and recommendations

    Requires GEMINI_API_KEY environment variable to be set.
    """
    if not gemini_evaluator:
        raise HTTPException(
            status_code=503,
            detail="AI evaluation not available. GEMINI_API_KEY not configured."
        )

    dr_path = PHOTOS_BASE_PATH / dr_number

    if not dr_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"No photos found for {dr_number}. Download photos first using POST /api/download/{dr_number}"
        )

    # Run evaluation
    logger.info(f"Starting AI evaluation for {dr_number}")
    result = await gemini_evaluator.evaluate_dr_photos(dr_number, dr_path)

    if result.get("status") == "error":
        raise HTTPException(status_code=500, detail=result.get("error", "Evaluation failed"))

    logger.info(f"AI evaluation complete for {dr_number}: {result.get('overall_status')}")

    # Store evaluation results in database for each photo
    if db.enabled:
        evaluations = result.get("evaluations", [])
        for photo_eval in evaluations:
            await db.store_evaluation_result(
                dr_number=dr_number,
                project=result.get("project", ""),
                photo_filename=photo_eval.get("filename", ""),
                evaluation=photo_eval
            )
        logger.info(f"Stored evaluation results for {len(evaluations)} photos to database")

    return result


@app.get("/api/evaluate/{dr_number}/status")
async def get_evaluation_status(dr_number: str):
    """Get the current evaluation status for a DR.

    Returns whether the DR has been evaluated and basic status info.
    For full results, use GET /api/evaluations/{dr_number}.
    """
    dr_path = PHOTOS_BASE_PATH / dr_number

    if not dr_path.exists():
        return {
            "dr_number": dr_number,
            "photos_exist": False,
            "evaluated": False,
            "message": "No photos downloaded yet"
        }

    photo_count = len(list(dr_path.glob("*.jpg")) + list(dr_path.glob("*.jpeg")) + list(dr_path.glob("*.png")))

    # Check for cached evaluation results
    eval_file = dr_path / "evaluation_results.json"
    if eval_file.exists():
        with open(eval_file, "r") as f:
            eval_data = json.load(f)
        return {
            "dr_number": dr_number,
            "photos_exist": True,
            "photo_count": photo_count,
            "evaluated": True,
            "overall_status": eval_data.get("overall_status"),
            "average_score": eval_data.get("average_score"),
            "evaluated_at": eval_data.get("evaluated_at"),
            "message": "Evaluation complete"
        }

    return {
        "dr_number": dr_number,
        "photos_exist": True,
        "photo_count": photo_count,
        "evaluated": False,
        "message": "Photos available but not yet evaluated. Use POST /api/evaluate/{dr_number} to run evaluation."
    }


@app.post("/api/evaluate/{dr_number}/save")
async def save_evaluation_results(dr_number: str):
    """Run evaluation and save results to disk for later retrieval.

    This endpoint evaluates all photos and caches the results
    to evaluation_results.json in the DR's photo directory.
    """
    if not gemini_evaluator:
        raise HTTPException(
            status_code=503,
            detail="AI evaluation not available. GEMINI_API_KEY not configured."
        )

    dr_path = PHOTOS_BASE_PATH / dr_number

    if not dr_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"No photos found for {dr_number}"
        )

    # Run evaluation
    result = await gemini_evaluator.evaluate_dr_photos(dr_number, dr_path)

    if result.get("status") == "error":
        raise HTTPException(status_code=500, detail=result.get("error", "Evaluation failed"))

    # Save results to disk
    eval_file = dr_path / "evaluation_results.json"
    with open(eval_file, "w") as f:
        json.dump(result, f, indent=2)

    logger.info(f"Saved evaluation results to {eval_file}")

    return {
        "dr_number": dr_number,
        "status": "saved",
        "file": str(eval_file),
        "overall_status": result.get("overall_status"),
        "average_score": result.get("average_score")
    }


@app.get("/api/evaluations/{dr_number}")
async def get_evaluation_results(dr_number: str):
    """Get saved evaluation results for a DR.

    Returns the full evaluation results if they exist.
    Use POST /api/evaluate/{dr_number}/save to generate and save results first.
    """
    dr_path = PHOTOS_BASE_PATH / dr_number
    eval_file = dr_path / "evaluation_results.json"

    if not eval_file.exists():
        raise HTTPException(
            status_code=404,
            detail=f"No evaluation results found for {dr_number}. Run POST /api/evaluate/{dr_number}/save first."
        )

    with open(eval_file, "r") as f:
        results = json.load(f)

    return results


@app.get("/api/evaluations")
async def list_all_evaluations():
    """List all DRs that have been evaluated.

    Returns a summary of all evaluation results across all DRs.
    """
    evaluations = []

    if PHOTOS_BASE_PATH.exists():
        for dr_dir in sorted(PHOTOS_BASE_PATH.iterdir()):
            if dr_dir.is_dir() and dr_dir.name.startswith("DR"):
                eval_file = dr_dir / "evaluation_results.json"
                if eval_file.exists():
                    with open(eval_file, "r") as f:
                        eval_data = json.load(f)

                    evaluations.append({
                        "dr_number": dr_dir.name,
                        "overall_status": eval_data.get("overall_status"),
                        "average_score": eval_data.get("average_score"),
                        "total_photos": eval_data.get("total_photos"),
                        "passed_count": eval_data.get("passed_count"),
                        "failed_count": eval_data.get("failed_count"),
                        "evaluated_at": eval_data.get("evaluated_at")
                    })

    # Sort by evaluation date (newest first)
    evaluations.sort(key=lambda x: x.get("evaluated_at", ""), reverse=True)

    return {
        "total_evaluated": len(evaluations),
        "summary": {
            "passed": sum(1 for e in evaluations if e.get("overall_status") == "pass"),
            "failed": sum(1 for e in evaluations if e.get("overall_status") == "fail"),
            "needs_review": sum(1 for e in evaluations if e.get("overall_status") == "needs_review")
        },
        "evaluations": evaluations
    }


@app.delete("/api/evaluations/{dr_number}")
async def delete_evaluation_results(dr_number: str):
    """Delete saved evaluation results for a DR.

    This allows re-evaluation of photos if needed.
    """
    dr_path = PHOTOS_BASE_PATH / dr_number
    eval_file = dr_path / "evaluation_results.json"

    if not eval_file.exists():
        raise HTTPException(
            status_code=404,
            detail=f"No evaluation results found for {dr_number}"
        )

    eval_file.unlink()
    logger.info(f"Deleted evaluation results for {dr_number}")

    return {
        "dr_number": dr_number,
        "status": "deleted",
        "message": "Evaluation results deleted. You can now re-run evaluation."
    }


# =============================================================================
# QA TRIGGER AND STATUS ENDPOINTS (Per Plan Phase 1)
# =============================================================================

class QAStatus(str):
    """QA status enum values."""
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    PASSED = "passed"
    FAILED = "failed"
    NEEDS_REVIEW = "needs_review"
    ERROR = "error"


# In-memory QA job tracking (for progress updates)
qa_jobs: Dict[str, Dict[str, Any]] = {}


@app.post("/api/qa/trigger/{dr_number}")
async def trigger_qa_evaluation(
    dr_number: str,
    background_tasks: BackgroundTasks,
    project: str = Query("LAW", description="Project code (LAW, MOH, MAM, etc.)"),
    force: bool = Query(False, description="Force re-evaluation even if already done")
):
    """Trigger AI QA evaluation for a DR's photos using 3-model cascade.

    Uses cascade: Gemini (cheapest) → OpenAI GPT-4o → Claude Vision

    Returns immediately with job_id for status tracking.
    Use GET /api/qa/status/{dr_number} to check progress.
    """
    if not cascade_evaluator:
        raise HTTPException(
            status_code=503,
            detail="AI QA not available. Check API key configuration (GEMINI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY)"
        )

    # Check if photos exist
    dr_path = PHOTOS_BASE_PATH / project / dr_number
    if not dr_path.exists():
        # Try without project prefix (old structure)
        dr_path = PHOTOS_BASE_PATH / dr_number

    if not dr_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"No photos found for {dr_number} in project {project}. Download photos first."
        )

    photo_files = list(dr_path.glob("*.jpg")) + list(dr_path.glob("*.jpeg")) + list(dr_path.glob("*.png"))
    if not photo_files:
        raise HTTPException(
            status_code=404,
            detail=f"No photo files found for {dr_number}"
        )

    # Check if already evaluated (unless force=True)
    if not force and db.enabled:
        existing = await db.get_qa_status(dr_number, project)
        if existing and existing.get("status") in [QAStatus.PASSED, QAStatus.FAILED]:
            return {
                "dr_number": dr_number,
                "project": project,
                "status": "already_evaluated",
                "qa_status": existing.get("status"),
                "evaluated_at": existing.get("analyzed_at"),
                "message": "Already evaluated. Use force=true to re-evaluate."
            }

    # Generate job ID and start background task
    job_id = f"{dr_number}_{project}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"

    qa_jobs[job_id] = {
        "dr_number": dr_number,
        "project": project,
        "status": QAStatus.IN_PROGRESS,
        "started_at": datetime.now().isoformat(),
        "total_photos": len(photo_files),
        "processed_photos": 0,
        "results": []
    }

    # Run QA in background
    background_tasks.add_task(
        run_qa_evaluation_task,
        job_id=job_id,
        dr_number=dr_number,
        project=project,
        dr_path=dr_path,
        photo_files=photo_files
    )

    return {
        "dr_number": dr_number,
        "project": project,
        "job_id": job_id,
        "status": "started",
        "total_photos": len(photo_files),
        "message": f"QA evaluation started for {len(photo_files)} photos. Check /api/qa/status/{dr_number}?project={project}"
    }


async def run_qa_evaluation_task(
    job_id: str,
    dr_number: str,
    project: str,
    dr_path: Path,
    photo_files: List[Path]
):
    """Background task to run QA evaluation on all photos."""
    try:
        total_cost = 0.0
        passed_count = 0
        failed_count = 0
        needs_review_count = 0
        results = []

        for i, photo_file in enumerate(photo_files):
            try:
                # Extract photo type from filename
                parts = photo_file.stem.split("_")
                photo_type = "_".join(parts[1:-1]) if len(parts) > 2 else "installation"

                # Run cascade evaluation
                start_time = datetime.now()
                eval_result = await cascade_evaluator.evaluate_photo(
                    image_path=photo_file,
                    photo_type=photo_type,
                    min_confidence=0.7
                )
                latency_ms = int((datetime.now() - start_time).total_seconds() * 1000)

                # Track cost
                total_cost += eval_result.get("cost", 0)

                # Count results based on score (not status field)
                overall_score = eval_result.get("overall_score", 0) or 0
                if overall_score >= 80:
                    classification = "pass"
                    passed_count += 1
                elif overall_score >= 50:
                    classification = "needs_review"
                    needs_review_count += 1
                else:
                    classification = "fail"
                    failed_count += 1
                
                # Use classification for the result status
                status = classification

                # Store result with full AI feedback
                photo_result = {
                    "filename": photo_file.name,
                    "photo_type": photo_type,
                    "status": status,
                    "confidence": eval_result.get("confidence", 0),
                    "provider": eval_result.get("provider", "unknown"),
                    "cost": eval_result.get("total_cost", 0),
                    "latency_ms": latency_ms,
                    # AI evaluation feedback
                    "summary": eval_result.get("summary", ""),
                    "detailed_analysis": eval_result.get("detailed_analysis", ""),
                    "issues": eval_result.get("issues_detected", []),
                    "recommendations": eval_result.get("recommendations", ""),
                    # Scores breakdown
                    "scores": {
                        "overall": eval_result.get("overall_score", 0),
                        "installation_quality": eval_result.get("installation_quality_score", 0),
                        "safety_compliance": eval_result.get("safety_compliance_score", 0),
                        "documentation_quality": eval_result.get("documentation_quality_score", 0),
                        "equipment_visibility": eval_result.get("equipment_visibility_score", 0)
                    }
                }
                results.append(photo_result)

                # Store to database
                if db.enabled:
                    await db.store_qa_result(
                        dr_number=dr_number,
                        project=project,
                        photo_filename=photo_file.name,
                        qa_result=photo_result
                    )

                # Update job progress
                qa_jobs[job_id]["processed_photos"] = i + 1
                qa_jobs[job_id]["results"] = results

            except Exception as e:
                logger.error(f"Error evaluating {photo_file.name}: {e}")
                results.append({
                    "filename": photo_file.name,
                    "status": "error",
                    "error": str(e)
                })

        # Determine overall status
        if failed_count > 0:
            overall_status = QAStatus.FAILED
        elif needs_review_count > 0:
            overall_status = QAStatus.NEEDS_REVIEW
        elif passed_count == len(photo_files):
            overall_status = QAStatus.PASSED
        else:
            overall_status = QAStatus.NEEDS_REVIEW

        # Update job with final results
        qa_jobs[job_id].update({
            "status": overall_status,
            "completed_at": datetime.now().isoformat(),
            "passed_count": passed_count,
            "failed_count": failed_count,
            "needs_review_count": needs_review_count,
            "total_cost": total_cost,
            "results": results
        })

        # Store DR-level summary in database
        if db.enabled:
            await db.store_qa_summary(
                dr_number=dr_number,
                project=project,
                summary={
                    "overall_status": overall_status,
                    "total_photos": len(photo_files),
                    "passed_count": passed_count,
                    "failed_count": failed_count,
                    "needs_review_count": needs_review_count,
                    "total_cost": total_cost,
                    "completed_at": datetime.now().isoformat()
                }
            )

        # Save results to disk as well
        eval_file = dr_path / "qa_results.json"
        with open(eval_file, "w") as f:
            json.dump(qa_jobs[job_id], f, indent=2)

        logger.info(f"QA evaluation complete for {dr_number}: {overall_status} ({passed_count}/{len(photo_files)} passed, cost: ${total_cost:.4f})")

    except Exception as e:
        logger.error(f"QA evaluation task failed for {dr_number}: {e}")
        qa_jobs[job_id]["status"] = QAStatus.ERROR
        qa_jobs[job_id]["error"] = str(e)



def _classify_qa_result(result: dict) -> str:
    """Classify a QA result as pass/fail/needs_review based on overall score.

    Score thresholds:
    - >= 80: pass
    - >= 50: needs_review
    - < 50: fail
    """
    # Try multiple places where score might be stored
    scores = result.get("scores", {})
    overall = scores.get("overall", 0) if isinstance(scores, dict) else 0

    # Fallback to other score fields
    if not overall:
        overall = result.get("overall_score", 0) or 0

    # Also check ai_verification_result which may contain scores
    ai_result = result.get("ai_verification_result")
    if ai_result and isinstance(ai_result, dict) and not overall:
        overall = ai_result.get("overall_score", 0) or ai_result.get("scores", {}).get("overall", 0) or 0

    if overall >= 80:
        return "pass"
    elif overall >= 50:
        return "needs_review"
    else:
        return "fail"


def _recalculate_qa_summary(results: list) -> dict:
    """Recalculate QA summary counts from individual result scores.

    This fixes the bug where status='completed' causes all photos
    to be counted as needs_review.
    """
    if not results:
        return {
            "passed_count": 0,
            "failed_count": 0,
            "needs_review_count": 0,
            "total_cost": 0.0
        }

    passed = 0
    failed = 0
    needs_review = 0
    total_cost = 0.0

    for result in results:
        classification = _classify_qa_result(result)
        if classification == "pass":
            passed += 1
        elif classification == "fail":
            failed += 1
        else:
            needs_review += 1

        # Sum up costs from multiple possible fields
        cost = result.get("cost", 0) or result.get("total_cost", 0) or result.get("qa_cost", 0) or 0
        total_cost += float(cost) if cost else 0.0

    return {
        "passed_count": passed,
        "failed_count": failed,
        "needs_review_count": needs_review,
        "total_cost": total_cost
    }



@app.get("/api/qa/status/{dr_number}")
async def get_qa_status(
    dr_number: str,
    project: str = Query("LAW", description="Project code")
):
    """Get QA evaluation status for a DR.

    Returns current status, progress (if running), and results (if complete).
    """
    # Check in-memory jobs first (for in-progress evaluations)
    for job_id, job in qa_jobs.items():
        if job["dr_number"] == dr_number and job["project"] == project:
            # Recalculate summary from scores (for completed jobs)
            results = job.get("results", [])
            if job["status"] not in [QAStatus.PENDING, QAStatus.IN_PROGRESS] and results:
                recalc_summary = _recalculate_qa_summary(results)
                # Determine overall status from recalculated counts
                if recalc_summary["failed_count"] > 0:
                    recalc_status = "failed"
                elif recalc_summary["needs_review_count"] > 0:
                    recalc_status = "needs_review"
                elif recalc_summary["passed_count"] > 0:
                    recalc_status = "passed"
                else:
                    recalc_status = job["status"]
            else:
                recalc_summary = None
                recalc_status = job["status"]
            
            return {
                "dr_number": dr_number,
                "project": project,
                "job_id": job_id,
                "status": recalc_status,
                "started_at": job.get("started_at"),
                "completed_at": job.get("completed_at"),
                "progress": {
                    "total_photos": job.get("total_photos", 0),
                    "processed_photos": job.get("processed_photos", 0),
                    "percentage": int((job.get("processed_photos", 0) / max(job.get("total_photos", 1), 1)) * 100)
                },
                "summary": recalc_summary,
                "results": results if job["status"] not in [QAStatus.PENDING, QAStatus.IN_PROGRESS] else None
            }

    # Check database for historical results
    if db.enabled:
        db_status = await db.get_qa_status(dr_number, project)
        if db_status:
            # Recalculate summary from scores (fixes status='completed' bug)
            results = db_status.get("results", [])
            recalc_summary = _recalculate_qa_summary(results)

            # Determine overall status from recalculated counts
            if recalc_summary["failed_count"] > 0:
                recalc_status = "failed"
            elif recalc_summary["needs_review_count"] > 0:
                recalc_status = "needs_review"
            elif recalc_summary["passed_count"] > 0:
                recalc_status = "passed"
            else:
                recalc_status = db_status.get("status", "unknown")

            return {
                "dr_number": dr_number,
                "project": project,
                "status": recalc_status,
                "completed_at": db_status.get("analyzed_at"),
                "summary": recalc_summary,
                "results": results,
                "source": "database"
            }

    # Check for saved file
    dr_path = PHOTOS_BASE_PATH / project / dr_number
    if not dr_path.exists():
        dr_path = PHOTOS_BASE_PATH / dr_number

    qa_file = dr_path / "qa_results.json" if dr_path.exists() else None
    if qa_file and qa_file.exists():
        with open(qa_file, "r") as f:
            saved_results = json.load(f)
        # Recalculate summary from scores (fixes status='completed' bug)
        file_results = saved_results.get("results", [])
        recalc_summary = _recalculate_qa_summary(file_results)

        # Determine overall status from recalculated counts
        if recalc_summary["failed_count"] > 0:
            recalc_file_status = "failed"
        elif recalc_summary["needs_review_count"] > 0:
            recalc_file_status = "needs_review"
        elif recalc_summary["passed_count"] > 0:
            recalc_file_status = "passed"
        else:
            recalc_file_status = saved_results.get("status", "unknown")

        return {
            "dr_number": dr_number,
            "project": project,
            "status": recalc_file_status,
            "completed_at": saved_results.get("completed_at"),
            "summary": recalc_summary,
            "results": file_results,
            "source": "file"
        }

    # Not found
    return {
        "dr_number": dr_number,
        "project": project,
        "status": QAStatus.PENDING,
        "message": "No QA evaluation found. Use POST /api/qa/trigger/{dr_number} to start."
    }


@app.get("/api/qa/summary")
async def get_qa_summary(
    project: Optional[str] = Query(None, description="Filter by project"),
    status: Optional[str] = Query(None, description="Filter by status (passed, failed, needs_review)"),
    limit: int = Query(100, description="Max results")
):
    """Get summary of all QA evaluations across DRs.

    Returns aggregate stats and list of evaluated DRs.
    """
    if db.enabled:
        summary = await db.get_qa_summary(project=project, status=status, limit=limit)
        return summary

    # Fallback to file-based summary
    all_results = []

    search_paths = [PHOTOS_BASE_PATH]
    if project:
        project_path = PHOTOS_BASE_PATH / project
        if project_path.exists():
            search_paths = [project_path]

    for search_path in search_paths:
        if not search_path.exists():
            continue
        for dr_dir in search_path.iterdir():
            if dr_dir.is_dir():
                qa_file = dr_dir / "qa_results.json"
                if qa_file.exists():
                    with open(qa_file, "r") as f:
                        data = json.load(f)
                    if status and data.get("status") != status:
                        continue
                    all_results.append({
                        "dr_number": data.get("dr_number", dr_dir.name),
                        "project": data.get("project", project or "unknown"),
                        "status": data.get("status"),
                        "passed_count": data.get("passed_count", 0),
                        "failed_count": data.get("failed_count", 0),
                        "total_photos": data.get("total_photos", 0),
                        "total_cost": data.get("total_cost", 0),
                        "completed_at": data.get("completed_at")
                    })

    # Sort by completion date
    all_results.sort(key=lambda x: x.get("completed_at", ""), reverse=True)
    all_results = all_results[:limit]

    # Calculate aggregates
    total_drs = len(all_results)
    total_passed = sum(1 for r in all_results if r.get("status") == QAStatus.PASSED)
    total_failed = sum(1 for r in all_results if r.get("status") == QAStatus.FAILED)
    total_review = sum(1 for r in all_results if r.get("status") == QAStatus.NEEDS_REVIEW)
    total_cost = sum(r.get("total_cost", 0) for r in all_results)

    return {
        "aggregate": {
            "total_drs": total_drs,
            "passed": total_passed,
            "failed": total_failed,
            "needs_review": total_review,
            "total_cost": round(total_cost, 4),
            "pass_rate": round(total_passed / max(total_drs, 1) * 100, 1)
        },
        "evaluations": all_results
    }


# =============================================================================
# SHAREPOINT SYNC ENDPOINTS
# =============================================================================

@app.post("/api/sync/sharepoint/{dr_number}")
async def sync_to_sharepoint(
    dr_number: str,
    project: str = Query("LAW", description="Project code"),
    background_tasks: BackgroundTasks = None
):
    """Sync DR photos and QA results to SharePoint.

    Uploads photos to the project's SharePoint folder structure:
    /DR Photos/{project}/{dr_number}/

    Also uploads qa_results.json if available.
    """
    # Check if photos exist
    dr_path = PHOTOS_BASE_PATH / project / dr_number
    if not dr_path.exists():
        dr_path = PHOTOS_BASE_PATH / dr_number

    if not dr_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"No photos found for {dr_number} in project {project}"
        )

    photo_files = list(dr_path.glob("*.jpg")) + list(dr_path.glob("*.jpeg")) + list(dr_path.glob("*.png"))
    qa_file = dr_path / "qa_results.json"

    files_to_sync = photo_files.copy()
    if qa_file.exists():
        files_to_sync.append(qa_file)

    if not files_to_sync:
        return {
            "dr_number": dr_number,
            "project": project,
            "status": "no_files",
            "message": "No files to sync"
        }

    # Check SharePoint configuration
    sharepoint_enabled = os.getenv("SHAREPOINT_SITE_URL") and os.getenv("SHAREPOINT_CLIENT_ID")

    if not sharepoint_enabled:
        return {
            "dr_number": dr_number,
            "project": project,
            "status": "disabled",
            "files_count": len(files_to_sync),
            "message": "SharePoint sync not configured. Set SHAREPOINT_* environment variables."
        }

    # Log sync request (actual sync would be implemented with SharePoint SDK)
    if db.enabled:
        await db.log_sharepoint_sync(
            dr_number=dr_number,
            project=project,
            files_count=len(files_to_sync),
            status="queued"
        )

    logger.info(f"SharePoint sync queued for {dr_number}: {len(files_to_sync)} files")

    return {
        "dr_number": dr_number,
        "project": project,
        "status": "queued",
        "files_count": len(files_to_sync),
        "target_path": f"/DR Photos/{project}/{dr_number}/",
        "message": f"Sync queued for {len(files_to_sync)} files"
    }


# =============================================================================
# COMPREHENSIVE DR LOOKUP AND PROCESS ENDPOINT (Phase 5.2)
# =============================================================================

@app.post("/api/dr/process/{dr_number}")
async def process_dr(
    dr_number: str,
    background_tasks: BackgroundTasks,
    auto_download: bool = Query(True, description="Auto-download photos if not local"),
    auto_qa: bool = Query(True, description="Auto-trigger AI QA after download"),
    force_qa: bool = Query(False, description="Force re-run QA even if already evaluated")
):
    """
    Comprehensive DR lookup and processing endpoint.

    Workflow:
    1. Check local database for existing QA results
    2. If no local photos, validate DR exists in 1Map
    3. If valid, download photos from 1Map
    4. Trigger AI QA evaluation

    This is the recommended endpoint for dashboard search - it handles
    the complete flow from DR number to QA results.

    Returns:
        - DR validation status
        - Photo download status
        - QA evaluation status/results
    """
    result = {
        "dr_number": dr_number,
        "steps": [],
        "status": "processing"
    }

    # Normalize DR number
    if not dr_number.upper().startswith("DR"):
        dr_number = f"DR{dr_number}"
    result["dr_number"] = dr_number

    # Step 1: Check local database for existing results
    local_qa_results = None
    local_photos = []
    dr_path = PHOTOS_BASE_PATH / dr_number
    project = "Unknown"

    if dr_path.exists():
        local_photos = list(dr_path.glob("*.jpg")) + list(dr_path.glob("*.jpeg")) + list(dr_path.glob("*.png"))

    # Also check project subfolders
    if not local_photos:
        for proj_dir in PHOTOS_BASE_PATH.iterdir():
            if proj_dir.is_dir() and not proj_dir.name.startswith("DR"):
                potential_path = proj_dir / dr_number
                if potential_path.exists():
                    dr_path = potential_path
                    project = proj_dir.name
                    local_photos = list(dr_path.glob("*.jpg")) + list(dr_path.glob("*.jpeg")) + list(dr_path.glob("*.png"))
                    break

    if local_photos:
        result["steps"].append({
            "step": "local_check",
            "status": "found",
            "message": f"Found {len(local_photos)} local photos",
            "photo_count": len(local_photos),
            "path": str(dr_path)
        })

        # Check if QA already done
        if db.enabled:
            existing_qa = await db.get_photos_by_dr(dr_number)
            if existing_qa:
                evaluated = [p for p in existing_qa if p.get("ai_evaluation")]
                if evaluated:
                    result["steps"].append({
                        "step": "db_qa_check",
                        "status": "found",
                        "message": f"Found existing QA results for {len(evaluated)} photos",
                        "qa_count": len(evaluated)
                    })
                    local_qa_results = existing_qa
    else:
        result["steps"].append({
            "step": "local_check",
            "status": "not_found",
            "message": "No local photos found"
        })

    # Step 2: Validate DR in 1Map (if no local photos or need more info)
    onemap_record = None
    try:
        async with OneMapSpecialistAgent() as agent:
            onemap_record = await agent.get_dr(dr_number)

            if onemap_record:
                project = onemap_record.site
                result["steps"].append({
                    "step": "onemap_validation",
                    "status": "valid",
                    "message": f"DR found in 1Map - {onemap_record.site}",
                    "site": onemap_record.site,
                    "site_name": agent.get_site_name(onemap_record.site),
                    "status_1map": onemap_record.status,
                    "address": onemap_record.address,
                    "photo_count_1map": len(onemap_record.photos),
                    "coordinates": onemap_record.coordinates
                })
            else:
                result["steps"].append({
                    "step": "onemap_validation",
                    "status": "not_found",
                    "message": f"DR {dr_number} not found in 1Map"
                })

                # If no local photos and not in 1Map, return error
                if not local_photos:
                    result["status"] = "not_found"
                    result["message"] = f"DR {dr_number} not found in 1Map and no local photos exist"
                    return result

    except Exception as e:
        result["steps"].append({
            "step": "onemap_validation",
            "status": "error",
            "message": f"1Map validation error: {str(e)}"
        })

        # If we have local photos, continue anyway
        if not local_photos:
            result["status"] = "error"
            result["message"] = f"Could not validate DR: {str(e)}"
            return result

    # Step 3: Download photos if needed
    if not local_photos and onemap_record and auto_download:
        try:
            async with OneMapSpecialistAgent() as agent:
                output_dir = PHOTOS_BASE_PATH / dr_number
                photos = await agent.download_all_photos(onemap_record, str(output_dir))

                local_photos = list(output_dir.glob("*.jpg"))

                result["steps"].append({
                    "step": "photo_download",
                    "status": "completed",
                    "message": f"Downloaded {len(photos)} photos from 1Map",
                    "photo_count": len(photos),
                    "output_path": str(output_dir)
                })

                dr_path = output_dir

                # Store metadata in database
                if db.enabled:
                    for p in photos:
                        filename = f"{dr_number}_{p.photo_type}_{p.attachment_id}.jpg"
                        file_path = output_dir / filename
                        if file_path.exists():
                            file_hash = hashlib.md5(file_path.read_bytes()).hexdigest()
                            await db.store_photo_metadata(
                                dr_number=dr_number,
                                project=project,
                                filename=filename,
                                file_path=str(file_path),
                                file_size=file_path.stat().st_size,
                                file_hash=file_hash,
                                photo_type=p.photo_type
                            )

        except Exception as e:
            result["steps"].append({
                "step": "photo_download",
                "status": "error",
                "message": f"Download failed: {str(e)}"
            })
    elif not local_photos and onemap_record and not auto_download:
        result["steps"].append({
            "step": "photo_download",
            "status": "skipped",
            "message": "Photos available in 1Map but auto_download=False",
            "available_photos": len(onemap_record.photos) if onemap_record else 0
        })

    # Step 4: Trigger AI QA evaluation
    if local_photos and auto_qa:
        # Check if already evaluated (unless force)
        should_run_qa = True
        if not force_qa and local_qa_results:
            evaluated_count = len([p for p in local_qa_results if p.get("ai_evaluation")])
            if evaluated_count >= len(local_photos):
                should_run_qa = False
                result["steps"].append({
                    "step": "ai_qa",
                    "status": "already_complete",
                    "message": f"QA already completed for {evaluated_count} photos. Use force_qa=true to re-run."
                })

        if should_run_qa and cascade_evaluator:
            job_id = f"{dr_number}_{project}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"

            qa_jobs[job_id] = {
                "dr_number": dr_number,
                "project": project,
                "status": QAStatus.IN_PROGRESS,
                "started_at": datetime.now().isoformat(),
                "total_photos": len(local_photos),
                "processed_photos": 0,
                "results": []
            }

            # Run QA in background
            background_tasks.add_task(
                run_qa_evaluation_task,
                job_id=job_id,
                dr_number=dr_number,
                project=project,
                dr_path=dr_path,
                photo_files=local_photos
            )

            result["steps"].append({
                "step": "ai_qa",
                "status": "started",
                "message": f"AI QA evaluation started for {len(local_photos)} photos",
                "job_id": job_id,
                "status_url": f"/api/qa/status/{dr_number}?project={project}"
            })
        elif not cascade_evaluator:
            result["steps"].append({
                "step": "ai_qa",
                "status": "unavailable",
                "message": "AI QA not configured. Set GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY"
            })
    elif not auto_qa:
        result["steps"].append({
            "step": "ai_qa",
            "status": "skipped",
            "message": "QA not triggered (auto_qa=false)"
        })
    elif not local_photos:
        result["steps"].append({
            "step": "ai_qa",
            "status": "skipped",
            "message": "No photos available for QA"
        })

    # Build final result
    result["status"] = "completed" if any(s["status"] in ["found", "valid", "completed", "started", "already_complete"] for s in result["steps"]) else "partial"
    result["project"] = project
    result["photo_count"] = len(local_photos)
    result["dr_path"] = str(dr_path) if dr_path and dr_path.exists() else None

    # Add summary
    result["summary"] = {
        "has_local_photos": len(local_photos) > 0,
        "in_1map": onemap_record is not None,
        "qa_status": "in_progress" if any(s.get("status") == "started" and s.get("step") == "ai_qa" for s in result["steps"]) else
                    "complete" if any(s.get("status") == "already_complete" for s in result["steps"]) else "pending"
    }

    return result


@app.get("/api/dr/search")
async def search_dr(
    q: str = Query(..., min_length=2, description="DR number or partial search"),
    check_1map: bool = Query(True, description="Also check 1Map if not found locally")
):
    """
    Search for DR across local photos, database, and optionally 1Map.

    Returns list of matching DRs with their status.
    """
    results = []
    q_upper = q.upper()

    # Normalize search query
    if not q_upper.startswith("DR"):
        q_upper = f"DR{q_upper}"

    # Search local photos
    if PHOTOS_BASE_PATH.exists():
        # Direct DR folders
        for dr_dir in PHOTOS_BASE_PATH.iterdir():
            if dr_dir.is_dir() and dr_dir.name.upper().startswith("DR"):
                if q_upper in dr_dir.name.upper():
                    photos = list(dr_dir.glob("*.jpg"))
                    results.append({
                        "dr_number": dr_dir.name,
                        "source": "local",
                        "project": "Unknown",
                        "photo_count": len(photos),
                        "path": str(dr_dir)
                    })

        # Project subfolders
        for proj_dir in PHOTOS_BASE_PATH.iterdir():
            if proj_dir.is_dir() and not proj_dir.name.startswith("DR"):
                for dr_dir in proj_dir.iterdir():
                    if dr_dir.is_dir() and dr_dir.name.upper().startswith("DR"):
                        if q_upper in dr_dir.name.upper():
                            photos = list(dr_dir.glob("*.jpg"))
                            results.append({
                                "dr_number": dr_dir.name,
                                "source": "local",
                                "project": proj_dir.name,
                                "photo_count": len(photos),
                                "path": str(dr_dir)
                            })

    # If exact match requested and not found locally, check 1Map
    if check_1map and (not results or q_upper not in [r["dr_number"].upper() for r in results]):
        try:
            async with OneMapSpecialistAgent() as agent:
                record = await agent.get_dr(q_upper)
                if record:
                    # Check if already in results
                    if record.dr_number.upper() not in [r["dr_number"].upper() for r in results]:
                        results.append({
                            "dr_number": record.dr_number,
                            "source": "1map",
                            "project": record.site,
                            "site_name": agent.get_site_name(record.site),
                            "status": record.status,
                            "address": record.address,
                            "photo_count": len(record.photos),
                            "has_local_photos": False
                        })
        except Exception as e:
            logger.warning(f"1Map search failed: {e}")

    return {
        "query": q,
        "total": len(results),
        "results": results
    }


# ============================================================================
# DASHBOARD ENDPOINTS - For DR Photo Verification Dashboard
# ============================================================================

# Session directory from Telegram bot
DR_SESSIONS_DIR = Path("/mnt/syncthing/photos/sessions")
if not DR_SESSIONS_DIR.exists():
    DR_SESSIONS_DIR = Path("/opt/boss/data/dr_sessions")


@app.get("/api/sessions")
async def get_dashboard_sessions(
    project: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    limit: int = Query(100)
):
    """Get list of DR verification sessions for dashboard."""
    sessions = []

    # Try to load from session files
    search_dir = DR_SESSIONS_DIR
    if project:
        project_dir = DR_SESSIONS_DIR / project
        if project_dir.exists():
            search_dir = project_dir

    if search_dir.exists():
        for session_file in search_dir.glob("**/session_*.json"):
            try:
                with open(session_file, 'r') as f:
                    session = json.load(f)

                # Filter by status if specified
                session_status = session.get("status", "active")
                if status and session_status != status:
                    continue

                sessions.append({
                    "dr_number": session.get("dr_number"),
                    "project": session.get("project", "LAW"),
                    "status": session_status,
                    "current_step": session.get("current_step", 0),
                    "total_steps": session.get("total_steps", 11),
                    "started_at": session.get("started_at"),
                    "completed_at": session.get("completed_at"),
                    "user_name": session.get("user_name"),
                    "qa_status": session.get("qa_status"),
                    "passed_count": session.get("passed_count", 0),
                    "failed_count": session.get("failed_count", 0),
                    "needs_review_count": session.get("needs_review_count", 0)
                })
            except Exception as e:
                logger.warning(f"Error loading session {session_file}: {e}")

    # Sort by most recent first
    sessions.sort(key=lambda x: x.get("started_at") or "", reverse=True)

    return sessions[:limit]


@app.get("/api/sessions/{dr_number}")
async def get_dashboard_session(
    dr_number: str,
    project: str = Query("LAW")
):
    """Get detailed session info for a specific DR."""
    session_file = DR_SESSIONS_DIR / project / f"session_{dr_number}.json"
    if not session_file.exists():
        session_file = DR_SESSIONS_DIR / f"session_{dr_number}.json"

    if not session_file.exists():
        raise HTTPException(status_code=404, detail=f"Session not found for {dr_number}")

    with open(session_file, 'r') as f:
        session = json.load(f)

    # Get QA status if available
    qa_status = None
    try:
        qa_response = await get_qa_status(dr_number, project)
        if isinstance(qa_response, dict):
            qa_status = qa_response
    except:
        pass

    return {
        **session,
        "qa_status": qa_status
    }




@app.post("/api/sessions")
async def create_dashboard_session(
    dr_number: str = Query(..., description="DR number to create session for"),
    project: str = Query("LAW", description="Project code")
):
    """Create a new QA session for manual DR entry.

    - Checks if DR has photos available
    - Prevents duplicate active sessions
    - Creates session file for tracking
    """
    dr_number = dr_number.upper().strip()

    # Validate DR number format
    if not dr_number.startswith("DR"):
        raise HTTPException(status_code=400, detail="Invalid DR number format. Must start with 'DR'")

    # Check for existing active session
    project_dir = DR_SESSIONS_DIR / project
    session_file = project_dir / f"session_{dr_number}.json"

    if session_file.exists():
        with open(session_file, 'r') as f:
            existing = json.load(f)
        if existing.get("status") == "active":
            raise HTTPException(
                status_code=409,
                detail=f"Active session already exists for {dr_number}"
            )

    # Check if DR has photos
    dr_path = PHOTOS_BASE_PATH / dr_number
    photos = []
    
    logger.info(f"Checking for photos for {dr_number}")
    logger.info(f"PHOTOS_BASE_PATH: {PHOTOS_BASE_PATH}")
    logger.info(f"dr_path: {dr_path}, exists: {dr_path.exists()}")

    if dr_path.exists():
        for ext in ['*.jpg', '*.jpeg', '*.png', '*.JPG', '*.JPEG', '*.PNG']:
            photos.extend([f.name for f in dr_path.glob(ext)])
        logger.info(f"Found {len(photos)} photos in local path")

    if not photos:
        logger.info(f"No local photos, will try 1Map")
        # Try to fetch from 1Map API
        try:
            logger.info(f"Fetching photos from 1Map for {dr_number}...")
            onemap_photos = await search_1map_photos(dr_number)
            logger.info(f"1Map returned {len(onemap_photos) if onemap_photos else 0} photos for {dr_number}")
            if onemap_photos:
                photos = onemap_photos  # Keep full photo objects with step_number, photo_type, etc.
                logger.info(f"Created {len(photos)} photo entries from 1Map")
        except Exception as e:
            logger.error(f"Error fetching photos from 1Map for {dr_number}: {type(e).__name__}: {e}")

    if not photos:
        raise HTTPException(
            status_code=404,
            detail=f"No photos found for {dr_number}. Upload photos first or check DR number."
        )

    # Create session
    now = datetime.now().isoformat()
    session = {
        "dr_number": dr_number,
        "project": project,
        "status": "active",
        "current_step": 1,
        "total_steps": 11,
        "started_at": now,
        "completed_at": None,
        "user_name": "Dashboard User",
        "qa_status": "pending",
        "passed_count": 0,
        "failed_count": 0,
        "needs_review_count": 0,
        "photos": photos if isinstance(photos[0], dict) else [{"filename": p} for p in photos],
        "step_status": {},
        "source": "dashboard_manual"
    }

    # Ensure directory exists
    project_dir.mkdir(parents=True, exist_ok=True)

    # Save session file
    with open(session_file, 'w') as f:
        json.dump(session, f, indent=2)

    logger.info(f"Created manual session for {dr_number} with {len(photos)} photos")

    # Broadcast to WebSocket clients
    try:
        await broadcast_dashboard_update("session_created", {
            "dr_number": dr_number,
            "project": project,
            "photo_count": len(photos)
        })
    except:
        pass

    return {
        "status": "created",
        "dr_number": dr_number,
        "project": project,
        "photo_count": len(photos),
        "session": session
    }


@app.put("/api/sessions/{dr_number}/step")
async def update_session_step(
    dr_number: str,
    step_number: int = Query(...),
    status: str = Query(..., description="approved, rejected, or pending"),
    project: str = Query("LAW")
):
    """Update a specific step's status in a session."""
    session_file = DR_SESSIONS_DIR / project / f"session_{dr_number}.json"

    if not session_file.exists():
        raise HTTPException(status_code=404, detail=f"Session not found for {dr_number}")

    with open(session_file, 'r') as f:
        session = json.load(f)

    # Update step status
    if "step_status" not in session:
        session["step_status"] = {}

    session["step_status"][str(step_number)] = {
        "status": status,
        "updated_at": datetime.now().isoformat()
    }

    # Update current step to next if approved/rejected
    if status in ["approved", "rejected"] and step_number == session.get("current_step", 1):
        session["current_step"] = min(step_number + 1, 11)

    # Check if all steps completed
    completed_steps = len([s for s in session.get("step_status", {}).values()
                          if s.get("status") in ["approved", "rejected"]])

    if completed_steps >= 11:
        session["status"] = "completed"
        session["completed_at"] = datetime.now().isoformat()

        # Calculate final counts
        approved = len([s for s in session["step_status"].values() if s.get("status") == "approved"])
        rejected = len([s for s in session["step_status"].values() if s.get("status") == "rejected"])
        session["passed_count"] = approved
        session["failed_count"] = rejected

    # Save updated session
    with open(session_file, 'w') as f:
        json.dump(session, f, indent=2)

    # Broadcast update
    try:
        await broadcast_dashboard_update("step_updated", {
            "dr_number": dr_number,
            "step_number": step_number,
            "status": status
        })
    except:
        pass

    return {
        "status": "updated",
        "dr_number": dr_number,
        "step_number": step_number,
        "step_status": status,
        "session_status": session["status"]
    }


@app.get("/api/stats")
async def get_dashboard_stats(
    project: Optional[str] = Query(None)
):
    """Get aggregate statistics for dashboard."""
    stats = {
        "total_drs": 0,
        "active_sessions": 0,
        "completed_today": 0,
        "qa_passed": 0,
        "qa_failed": 0,
        "qa_pending": 0,
        "total_cost_today": 0.0
    }

    search_dir = DR_SESSIONS_DIR
    if project:
        project_dir = DR_SESSIONS_DIR / project
        if project_dir.exists():
            search_dir = project_dir

    today = datetime.now().strftime("%Y-%m-%d")

    if search_dir.exists():
        for session_file in search_dir.glob("**/session_*.json"):
            try:
                with open(session_file, 'r') as f:
                    session = json.load(f)

                stats["total_drs"] += 1

                status = session.get("status", "active")
                if status == "active":
                    stats["active_sessions"] += 1
                elif status == "completed":
                    completed_at = session.get("completed_at", "")
                    if completed_at.startswith(today):
                        stats["completed_today"] += 1

                qa_status = session.get("qa_status", "pending")
                if qa_status == "passed":
                    stats["qa_passed"] += 1
                elif qa_status == "failed":
                    stats["qa_failed"] += 1
                else:
                    stats["qa_pending"] += 1

                # Sum costs
                stats["total_cost_today"] += session.get("total_cost", 0)

            except Exception as e:
                logger.warning(f"Error processing session {session_file}: {e}")

    return stats


# WebSocket for real-time updates
dashboard_clients: List[WebSocket] = []


@app.websocket("/ws")
async def dashboard_websocket(websocket: WebSocket):
    """WebSocket endpoint for real-time dashboard updates."""
    await websocket.accept()
    dashboard_clients.append(websocket)
    logger.info(f"Dashboard WebSocket connected. Total: {len(dashboard_clients)}")

    try:
        while True:
            # Keep connection alive, wait for messages
            data = await websocket.receive_text()
            # Echo back or process commands
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        dashboard_clients.remove(websocket)
        logger.info(f"Dashboard WebSocket disconnected. Remaining: {len(dashboard_clients)}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        if websocket in dashboard_clients:
            dashboard_clients.remove(websocket)


async def broadcast_dashboard_update(event_type: str, data: dict):
    """Broadcast update to all connected dashboard clients."""
    if not dashboard_clients:
        return

    message = json.dumps({"type": event_type, "data": data})
    disconnected = []

    for client in dashboard_clients:
        try:
            await client.send_text(message)
        except:
            disconnected.append(client)

    for client in disconnected:
        dashboard_clients.remove(client)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
