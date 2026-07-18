"""
DR Dashboard API Routes

Real-time monitoring dashboard for DR photo verification submissions
via Telegram bot (@velo_fibre_bot).

Features:
- List active/completed sessions
- View session details and photos
- Review AI findings
- Approve/reject/comment on steps
- WebSocket for real-time updates
"""

import os
import json
import asyncio
from pathlib import Path
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta
from enum import Enum

from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from loguru import logger

# Database
try:
    import asyncpg
    ASYNCPG_AVAILABLE = True
except ImportError:
    ASYNCPG_AVAILABLE = False
    logger.warning("asyncpg not available - using file-based fallback")

# Redis for pub/sub
try:
    import redis.asyncio as redis
    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False


router = APIRouter(prefix="/dr-dashboard", tags=["DR Dashboard"])

# Configuration
PROJECT_ROOT = Path(__file__).parent.parent.parent.parent
DR_PHOTOS_DIR = PROJECT_ROOT / "data" / "dr_photos"
DR_SESSIONS_DIR = PROJECT_ROOT / "data" / "dr_sessions"

DATABASE_URL = os.getenv("DATABASE_URL", "")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")

# Photo code to step mapping (from 1Map naming convention)
PHOTO_CODE_TO_STEP = {
    "ph_prop": 1,      # Property/House Photo
    "ph_hh1": 2,       # High Hook 1 - Cable from Pole
    "ph_hh2": 2,       # High Hook 2 - Cable from Pole
    "ph_conn1": 2,     # Connection - Cable from Pole
    "ph_outs": 3,      # Outside - Cable Entry Outside
    "ph_hm_ln": 3,     # Home Line - Cable Entry Outside
    "ph_hm_en": 4,     # Home Entry - Cable Entry Inside
    "ph_wall": 5,      # Wall for Installation
    "ph_cbl_r": 6,     # Cable Router - ONT Back
    "ph_powm1": 7,     # Power Meter 1
    "ph_powm2": 7,     # Power Meter 2
    "ph_drop": 8,      # Drop - ONT Barcode/Serial
    "ph_ups": 9,       # UPS Serial Number
    "ph_after": 10,    # After - Final Installation
    "ph_bl": 11,       # Blink Lights - Green Lights
    "ph_sign1": 11,    # Signature 1
    "ph_sign2": 11,    # Signature 2
}


# ============================================================================
# PYDANTIC MODELS
# ============================================================================

class SessionStatus(str, Enum):
    ACTIVE = "active"
    COMPLETED = "completed"
    NEEDS_REVIEW = "needs_review"
    FAILED = "failed"


class StepStatus(str, Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    PASSED = "passed"
    FAILED = "failed"
    AUTO_ADVANCED = "auto_advanced"


class SessionSummary(BaseModel):
    """Summary of a DR verification session."""
    dr_number: str
    project: str
    status: SessionStatus
    current_step: int
    total_steps: int = 11
    started_at: datetime
    last_activity: datetime
    duration_minutes: int
    steps_completed: int
    steps_failed: int
    needs_review: bool
    technician_phone: Optional[str] = None
    technician_name: Optional[str] = None
    technician_username: Optional[str] = None


class StepDetail(BaseModel):
    """Detail of a single verification step."""
    step_number: int
    step_name: str
    status: StepStatus
    is_critical: bool
    attempts: int
    max_attempts: int = 3
    ai_result: Optional[Dict[str, Any]] = None
    ai_confidence: Optional[float] = None
    photo_path: Optional[str] = None
    photo_count: int = 0
    sub_steps: Optional[List[Dict[str, Any]]] = None
    verified_at: Optional[datetime] = None
    notes: Optional[str] = None


class SessionDetail(BaseModel):
    """Full detail of a DR verification session."""
    dr_number: str
    project: str
    status: SessionStatus
    current_step: int
    total_steps: int = 11
    started_at: datetime
    last_activity: datetime
    duration_minutes: int
    technician_phone: Optional[str] = None
    technician_name: Optional[str] = None
    technician_username: Optional[str] = None
    gps_latitude: Optional[float] = None
    gps_longitude: Optional[float] = None
    gps_address: Optional[str] = None
    steps: List[StepDetail]
    auto_advanced_steps: List[int] = []


class ReviewAction(BaseModel):
    """Review action for a step."""
    action: str  # approve, reject, comment
    comment: Optional[str] = None
    send_to_user: bool = True


class PhotoInfo(BaseModel):
    """Photo information."""
    filename: str
    path: str
    step_number: int
    sub_step: Optional[str] = None
    timestamp: datetime
    ai_result: Optional[Dict[str, Any]] = None


# ============================================================================
# VERIFICATION STEPS DEFINITION (mirrored from dr_qa_bot.py)
# ============================================================================

VERIFICATION_STEPS = {
    1: {"name": "House Photo", "critical": False, "multi_photo": False},
    2: {"name": "Cable from Pole", "critical": False, "multi_photo": True},
    3: {"name": "Cable Entry Outside", "critical": True, "multi_photo": False},
    4: {"name": "Cable Entry Inside", "critical": False, "multi_photo": True},
    5: {"name": "Wall for Installation", "critical": False, "multi_photo": True},
    6: {"name": "ONT Back After Install", "critical": False, "multi_photo": False},
    7: {"name": "Power Meter Reading", "critical": True, "multi_photo": False},
    8: {"name": "ONT Barcode/Serial", "critical": True, "multi_photo": False},
    9: {"name": "UPS Serial Number", "critical": True, "multi_photo": False},
    10: {"name": "Final Installation", "critical": True, "multi_photo": False},
    11: {"name": "Green Lights", "critical": True, "multi_photo": False},
}


# ============================================================================
# DATABASE HELPERS
# ============================================================================

async def get_db_pool():
    """Get database connection pool."""
    if not ASYNCPG_AVAILABLE or not DATABASE_URL:
        return None
    try:
        return await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=5)
    except Exception as e:
        logger.error(f"Database connection failed: {e}")
        return None


async def query_sessions_from_db(
    pool,
    project: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 50
) -> List[Dict]:
    """Query sessions from PostgreSQL."""
    if not pool:
        return []

    query = """
        SELECT
            dr_number, project, status,
            started_at, completed_at,
            total_photos, photos_downloaded, photos_analyzed,
            steps_verified, verification_result, issues_found,
            error_message, is_frozen, can_resume
        FROM dr_verification_sessions
        WHERE 1=1
    """
    params = []
    param_idx = 1

    if project:
        query += f" AND project = ${param_idx}"
        params.append(project)
        param_idx += 1

    if status:
        if status == "active":
            query += f" AND status IN ('pending', 'downloading', 'analyzing')"
        elif status == "needs_review":
            query += f" AND (is_frozen = TRUE OR verification_result = 'partial')"
        else:
            query += f" AND status = ${param_idx}"
            params.append(status)
            param_idx += 1

    query += f" ORDER BY started_at DESC LIMIT ${param_idx}"
    params.append(limit)

    async with pool.acquire() as conn:
        rows = await conn.fetch(query, *params)
        return [dict(row) for row in rows]


# ============================================================================
# FILE-BASED SESSION LOADING (FALLBACK)
# ============================================================================

def load_sessions_from_files(
    project: Optional[str] = None,
    limit: int = 50
) -> List[Dict]:
    """Load sessions from JSON files AND photo directories.

    Returns both:
    1. Telegram bot sessions (with AI verification results)
    2. Photo-only sessions (need AI verification)
    """
    sessions = []
    session_drs = set()  # Track DRs that have session files

    # STEP 1: Load existing Telegram sessions (have AI verification)
    if DR_SESSIONS_DIR.exists():
        for user_dir in DR_SESSIONS_DIR.iterdir():
            if not user_dir.is_dir():
                continue

            # Find session files
            for session_file in user_dir.glob("*_session.json"):
                try:
                    with open(session_file, "r") as f:
                        data = json.load(f)

                    # Filter by project if specified
                    if project and data.get("project", "").lower() != project.lower():
                        continue

                    dr_number = data.get("dr_number", "Unknown")
                    session_drs.add((dr_number, data.get("project", "Unknown")))

                    # Parse timestamps
                    started_at = datetime.fromisoformat(data.get("started_at", datetime.utcnow().isoformat()))
                    last_activity = datetime.fromisoformat(data.get("last_activity", datetime.utcnow().isoformat()))

                    # Determine status
                    current_step = data.get("current_step", 1)
                    step_results = data.get("step_results", {})
                    auto_advanced = data.get("auto_advanced_steps", [])

                    if current_step > 11:
                        status = SessionStatus.COMPLETED
                    elif auto_advanced:
                        status = SessionStatus.NEEDS_REVIEW
                    else:
                        status = SessionStatus.ACTIVE

                    # Count completed/failed steps
                    steps_completed = len([s for s in step_results.values() if s.get("status") == "passed"])
                    steps_failed = len(auto_advanced)

                    sessions.append({
                        "dr_number": dr_number,
                        "project": data.get("project", "Unknown"),
                        "status": status,
                        "current_step": current_step,
                        "started_at": started_at,
                        "last_activity": last_activity,
                        "steps_completed": steps_completed,
                        "steps_failed": steps_failed,
                        "auto_advanced_steps": auto_advanced,
                        "chat_id": data.get("chat_id"),
                        "file_path": str(session_file),
                        "step_results": step_results,
                        "gps_latitude": data.get("current_latitude"),
                        "gps_longitude": data.get("current_longitude"),
                        "gps_address": data.get("current_address"),
                    })
                except Exception as e:
                    logger.warning(f"Failed to load session file {session_file}: {e}")
                    continue

    # STEP 2: Add photo-only DRs (need AI verification)
    if DR_PHOTOS_DIR.exists():
        # Check both structures:
        # 1. Direct DR folders (local dev): data/dr_photos/DR#/
        # 2. Project subdirectories (VPS): data/dr_photos/{project}/DR#/

        for item in DR_PHOTOS_DIR.iterdir():
            if not item.is_dir() or item.name.startswith("."):
                continue

            # Case 1: Direct DR folder (local dev structure)
            if item.name.startswith("DR"):
                dr_number = item.name
                project_name = "Lawley"  # Default project for direct structure

                # Filter by project if specified
                if project and project_name.lower() != project.lower():
                    continue

                # Skip if already have Telegram session
                if (dr_number, project_name) in session_drs:
                    continue

                # Count photos
                photos = list(item.glob("*.jpg"))
                if not photos:
                    continue

                # Get timestamp from photos
                latest_photo = max(photos, key=lambda p: p.stat().st_mtime)
                last_activity = datetime.fromtimestamp(latest_photo.stat().st_mtime)

                # Create synthetic session
                sessions.append({
                    "dr_number": dr_number,
                    "project": project_name,
                    "status": SessionStatus.COMPLETED,
                    "current_step": 12,
                    "started_at": last_activity,
                    "last_activity": last_activity,
                    "steps_completed": 0,  # No AI verification yet
                    "steps_failed": 0,
                    "auto_advanced_steps": [],
                    "chat_id": None,
                    "file_path": None,
                    "step_results": {},
                    "gps_latitude": None,
                    "gps_longitude": None,
                    "gps_address": None,
                })

            # Case 2: Project folder (VPS structure)
            else:
                project_name = item.name

                # Filter by project if specified
                if project and project_name.lower() != project.lower():
                    continue

                # Scan DRs within project folder
                for dr_dir in item.iterdir():
                    if dr_dir.is_dir() and dr_dir.name.startswith("DR"):
                        dr_number = dr_dir.name

                        # Skip if already have Telegram session
                        if (dr_number, project_name) in session_drs:
                            continue

                        # Count photos
                        photos = list(dr_dir.glob("*.jpg"))
                        if not photos:
                            continue

                        # Get timestamp from photos
                        latest_photo = max(photos, key=lambda p: p.stat().st_mtime)
                        last_activity = datetime.fromtimestamp(latest_photo.stat().st_mtime)

                        # Create synthetic session
                        sessions.append({
                            "dr_number": dr_number,
                            "project": project_name,
                            "status": SessionStatus.COMPLETED,
                            "current_step": 12,
                            "started_at": last_activity,
                            "last_activity": last_activity,
                            "steps_completed": 0,  # No AI verification yet
                            "steps_failed": 0,
                            "auto_advanced_steps": [],
                            "chat_id": None,
                            "file_path": None,
                            "step_results": {},
                            "gps_latitude": None,
                            "gps_longitude": None,
                            "gps_address": None,
                        })

    # Sort by last activity (most recent first)
    sessions.sort(key=lambda x: x["last_activity"], reverse=True)

    return sessions[:limit]


def load_session_detail(dr_number: str, project: str) -> Optional[Dict]:
    """Load full session detail from files."""
    if not DR_SESSIONS_DIR.exists():
        return None

    # Search for session file
    for user_dir in DR_SESSIONS_DIR.iterdir():
        if not user_dir.is_dir():
            continue

        session_file = user_dir / f"{dr_number}_session.json"
        if session_file.exists():
            try:
                with open(session_file, "r") as f:
                    data = json.load(f)

                if data.get("project", "").lower() != project.lower():
                    continue

                return data
            except Exception as e:
                logger.error(f"Failed to load session {dr_number}: {e}")

    return None


def get_photos_for_dr(dr_number: str, project: str = None) -> List[Dict]:
    """Get all photos for a DR from the file system.

    Photos can be in two locations:
    1. data/dr_photos/{dr_number}/ (local dev - naming: {DR}_{ph_code}_{id}.jpg)
    2. data/dr_photos/{project}/{dr_number}/ (VPS - naming: stepN_description_timestamp.jpg)
    """
    photos = []
    dr_photo_dir = None

    # Check data/dr_photos/{dr_number}/ (direct structure, local dev)
    if (DR_PHOTOS_DIR / dr_number).exists():
        dr_photo_dir = DR_PHOTOS_DIR / dr_number
    else:
        # Check all project subfolders for this DR (VPS structure)
        for project_dir in DR_PHOTOS_DIR.iterdir():
            if project_dir.is_dir() and not project_dir.name.startswith("."):
                potential_dr_dir = project_dir / dr_number
                if potential_dr_dir.exists():
                    dr_photo_dir = potential_dr_dir
                    if not project:
                        project = project_dir.name
                    break

    if not dr_photo_dir or not dr_photo_dir.exists():
        return photos

    if dr_photo_dir.exists():
        for photo_file in dr_photo_dir.glob("*.jpg"):
            filename = photo_file.name
            step_number = 0
            sub_step = None
            photo_code = None

            # VPS naming: stepN_description_timestamp.jpg
            if filename.startswith("step"):
                parts = filename.split("_")
                try:
                    step_number = int(parts[0].replace("step", ""))
                except (ValueError, IndexError):
                    step_number = 0
            else:
                # Local dev naming: {DR}_{ph_code}_{id}.jpg
                parts = filename.replace(".jpg", "").split("_")

                # Find the photo code (ph_*)
                for i, part in enumerate(parts):
                    if part == "ph" and i + 1 < len(parts):
                        # Combine ph with next part (e.g., "ph" + "prop" = "ph_prop")
                        photo_code = f"ph_{parts[i + 1]}"

                        # Handle multi-part codes like ph_hm_en, ph_cbl_r
                        if i + 2 < len(parts) and parts[i + 2] in ["en", "ln", "r"]:
                            photo_code = f"ph_{parts[i + 1]}_{parts[i + 2]}"
                        break

            # Map photo code to step number
            if photo_code and photo_code in PHOTO_CODE_TO_STEP:
                step_number = PHOTO_CODE_TO_STEP[photo_code]

                # Determine sub-step for multi-photo steps
                if photo_code in ["ph_hh1", "ph_conn1"]:
                    sub_step = "A"
                elif photo_code == "ph_hh2":
                    sub_step = "B"
                elif photo_code == "ph_powm1":
                    sub_step = "A"
                elif photo_code == "ph_powm2":
                    sub_step = "B"
                elif photo_code == "ph_sign1":
                    sub_step = "A"
                elif photo_code == "ph_sign2":
                    sub_step = "B"

            photos.append({
                "filename": filename,
                "path": str(photo_file),
                "step_number": step_number,
                "sub_step": sub_step,
                "photo_code": photo_code,
                "timestamp": datetime.fromtimestamp(photo_file.stat().st_mtime),
                "size_bytes": photo_file.stat().st_size,
            })

    # Sort by step number, then sub-step
    photos.sort(key=lambda x: (x["step_number"], x.get("sub_step") or ""))

    return photos


# ============================================================================
# API ENDPOINTS
# ============================================================================

@router.get("/available-drs")
async def list_available_drs():
    """List all DRs that have photos available.

    Scans the dr_photos directory for DR folders.
    Supports two structures:
    1. data/dr_photos/{DR#}/ (local dev)
    2. data/dr_photos/{project}/{DR#}/ (VPS)
    """
    drs = []

    if not DR_PHOTOS_DIR.exists():
        return drs

    # Check direct DR folders (local dev structure)
    for dr_dir in DR_PHOTOS_DIR.iterdir():
        if dr_dir.is_dir() and dr_dir.name.startswith("DR"):
            # Count photos
            photos = list(dr_dir.glob("*.jpg"))

            # Get modification times
            if photos:
                latest_photo = max(photos, key=lambda p: p.stat().st_mtime)
                last_activity = datetime.fromtimestamp(latest_photo.stat().st_mtime)
            else:
                last_activity = datetime.fromtimestamp(dr_dir.stat().st_mtime)

            drs.append({
                "dr_number": dr_dir.name,
                "project": "Lawley",  # Default for direct structure
                "photo_count": len(photos),
                "last_activity": last_activity.isoformat(),
            })

    # Also check project subdirectories (VPS structure)
    for project_dir in DR_PHOTOS_DIR.iterdir():
        if project_dir.is_dir() and not project_dir.name.startswith("DR") and not project_dir.name.startswith("."):
            project_name = project_dir.name
            for dr_dir in project_dir.iterdir():
                if dr_dir.is_dir() and dr_dir.name.startswith("DR"):
                    # Count photos
                    photos = list(dr_dir.glob("*.jpg"))

                    # Get modification times
                    if photos:
                        latest_photo = max(photos, key=lambda p: p.stat().st_mtime)
                        last_activity = datetime.fromtimestamp(latest_photo.stat().st_mtime)
                    else:
                        last_activity = datetime.fromtimestamp(dr_dir.stat().st_mtime)

                    drs.append({
                        "dr_number": dr_dir.name,
                        "project": project_name,
                        "photo_count": len(photos),
                        "last_activity": last_activity.isoformat(),
                    })

    # Sort by last activity (most recent first)
    drs.sort(key=lambda x: x["last_activity"], reverse=True)

    return drs


@router.get("/sessions", response_model=List[SessionSummary])
async def list_sessions(
    project: Optional[str] = Query(None, description="Filter by project (lawley, mohadin, mamelodi)"),
    status: Optional[str] = Query(None, description="Filter by status (active, completed, needs_review)"),
    limit: int = Query(50, ge=1, le=200, description="Maximum number of sessions to return"),
):
    """
    List DR verification sessions.

    Returns active and recent sessions with summary information.
    """
    # Try database first
    pool = await get_db_pool()
    if pool:
        try:
            db_sessions = await query_sessions_from_db(pool, project, status, limit)
            await pool.close()

            if db_sessions:
                return [
                    SessionSummary(
                        dr_number=s["dr_number"],
                        project=s["project"],
                        status=_map_db_status(s["status"], s.get("is_frozen")),
                        current_step=s.get("steps_verified", 0) + 1,
                        started_at=s["started_at"],
                        last_activity=s.get("completed_at") or s["started_at"],
                        duration_minutes=_calc_duration(s["started_at"], s.get("completed_at")),
                        steps_completed=s.get("steps_verified", 0),
                        steps_failed=0,
                        needs_review=s.get("is_frozen", False),
                    )
                    for s in db_sessions
                ]
        except Exception as e:
            logger.error(f"Database query failed: {e}")

    # Fallback to file-based
    file_sessions = load_sessions_from_files(project, limit)

    # Apply status filter for file-based
    if status:
        if status == "active":
            file_sessions = [s for s in file_sessions if s["status"] == SessionStatus.ACTIVE]
        elif status == "completed":
            file_sessions = [s for s in file_sessions if s["status"] == SessionStatus.COMPLETED]
        elif status == "needs_review":
            file_sessions = [s for s in file_sessions if s["status"] == SessionStatus.NEEDS_REVIEW]

    return [
        SessionSummary(
            dr_number=s["dr_number"],
            project=s["project"],
            status=s["status"],
            current_step=min(s["current_step"], 11),
            started_at=s["started_at"],
            last_activity=s["last_activity"],
            duration_minutes=int((s["last_activity"] - s["started_at"]).total_seconds() / 60),
            steps_completed=s["steps_completed"],
            steps_failed=s["steps_failed"],
            needs_review=bool(s.get("auto_advanced_steps")),
        )
        for s in file_sessions
    ]


@router.get("/sessions/{dr_number}", response_model=SessionDetail)
async def get_session_detail(
    dr_number: str,
    project: str = Query(..., description="Project name (lawley, mohadin, mamelodi)"),
):
    """
    Get full detail of a DR verification session.

    Includes all steps, photos, and AI verification results.
    Falls back to photo-based view if no session file exists.
    """
    session_data = load_session_detail(dr_number, project)

    # If no session file, check if photos exist and create synthetic session
    if not session_data:
        photos = get_photos_for_dr(dr_number, project)
        if not photos:
            raise HTTPException(status_code=404, detail=f"Session not found: {dr_number}")

        # Create synthetic session data from photos
        timestamps = [p["timestamp"] for p in photos]
        session_data = {
            "dr_number": dr_number,
            "project": project,
            "started_at": min(timestamps).isoformat() if timestamps else datetime.utcnow().isoformat(),
            "last_activity": max(timestamps).isoformat() if timestamps else datetime.utcnow().isoformat(),
            "current_step": 12,  # Completed
            "step_results": {},
            "auto_advanced_steps": [],
            "step_attempts": {},
        }

    # Parse timestamps
    started_at = datetime.fromisoformat(session_data.get("started_at", datetime.utcnow().isoformat()))
    last_activity = datetime.fromisoformat(session_data.get("last_activity", datetime.utcnow().isoformat()))

    # Get photos
    photos = get_photos_for_dr(dr_number, project)
    photos_by_step = {}
    for p in photos:
        step = p["step_number"]
        if step not in photos_by_step:
            photos_by_step[step] = []
        photos_by_step[step].append(p)

    # Build steps list
    step_results = session_data.get("step_results", {})
    auto_advanced = session_data.get("auto_advanced_steps", [])
    step_attempts = session_data.get("step_attempts", {})
    current_step = session_data.get("current_step", 1)

    steps = []
    for step_num in range(1, 12):
        step_info = VERIFICATION_STEPS[step_num]
        step_result = step_results.get(str(step_num), {})

        # Determine status
        step_photos = photos_by_step.get(step_num, [])

        # CRITICAL FIX: Only mark as PASSED/FAILED if AI verification actually happened
        if step_num in auto_advanced:
            status = StepStatus.AUTO_ADVANCED
        elif step_result.get("status") == "passed":
            # AI verified and approved
            status = StepStatus.PASSED
        elif step_result.get("status") == "failed":
            # AI verified and rejected
            status = StepStatus.FAILED
        elif step_photos:
            # Photos uploaded but NOT yet verified by AI
            # Don't lie and say "PASSED" - show truthful status
            status = StepStatus.IN_PROGRESS
        else:
            # No photos uploaded yet
            status = StepStatus.PENDING

        # Get photos for this step
        step_photos = photos_by_step.get(step_num, [])
        photo_path = step_photos[0]["path"] if step_photos else None

        steps.append(StepDetail(
            step_number=step_num,
            step_name=step_info["name"],
            status=status,
            is_critical=step_info["critical"],
            attempts=step_attempts.get(str(step_num), 0),
            ai_result=step_result.get("ai_result"),
            ai_confidence=step_result.get("confidence"),
            photo_path=photo_path,
            photo_count=len(step_photos),
            verified_at=datetime.fromisoformat(step_result["verified_at"]) if step_result.get("verified_at") else None,
            notes=step_result.get("notes"),
        ))

    # Determine overall status
    if current_step > 11:
        status = SessionStatus.COMPLETED
    elif auto_advanced:
        status = SessionStatus.NEEDS_REVIEW
    else:
        status = SessionStatus.ACTIVE

    # Build technician name from user info
    first_name = session_data.get("user_first_name", "")
    last_name = session_data.get("user_last_name", "")
    technician_name = f"{first_name} {last_name}".strip() if first_name or last_name else None

    return SessionDetail(
        dr_number=dr_number,
        project=project,
        status=status,
        current_step=min(current_step, 11),
        started_at=started_at,
        last_activity=last_activity,
        duration_minutes=int((last_activity - started_at).total_seconds() / 60),
        technician_name=technician_name,
        technician_username=session_data.get("user_username"),
        gps_latitude=session_data.get("current_latitude"),
        gps_longitude=session_data.get("current_longitude"),
        gps_address=session_data.get("current_address"),
        steps=steps,
        auto_advanced_steps=auto_advanced,
    )


@router.get("/sessions/{dr_number}/photos")
async def get_session_photos(
    dr_number: str,
    project: str = Query(..., description="Project name"),
):
    """Get all photos for a DR session."""
    photos = get_photos_for_dr(dr_number, project)

    if not photos:
        raise HTTPException(status_code=404, detail=f"No photos found for {dr_number}")

    return photos


@router.get("/photos/{dr_number}/{filename}")
async def get_photo(
    dr_number: str,
    filename: str,
):
    """Serve a photo file.

    Photos are stored directly under data/dr_photos/{dr_number}/
    """
    # Try direct path first (no project subfolder)
    photo_path = DR_PHOTOS_DIR / dr_number / filename

    if not photo_path.exists():
        # Try with common project subfolders
        for project in ["lawley", "mohadin", "mamelodi"]:
            alt_path = DR_PHOTOS_DIR / project / dr_number / filename
            if alt_path.exists():
                photo_path = alt_path
                break

    if not photo_path.exists():
        raise HTTPException(status_code=404, detail="Photo not found")

    return FileResponse(
        photo_path,
        media_type="image/jpeg",
        filename=filename,
    )


@router.get("/photos/{project}/{dr_number}/{filename}")
async def get_photo_with_project(
    project: str,
    dr_number: str,
    filename: str,
):
    """Serve a photo file (with project path for compatibility)."""
    # Try with project subfolder (keep original case)
    photo_path = DR_PHOTOS_DIR / project / dr_number / filename

    if not photo_path.exists():
        # Fall back to direct path
        photo_path = DR_PHOTOS_DIR / dr_number / filename

    if not photo_path.exists():
        raise HTTPException(status_code=404, detail="Photo not found")

    return FileResponse(
        photo_path,
        media_type="image/jpeg",
        filename=filename,
    )


@router.post("/sessions/{dr_number}/steps/{step_number}/review")
async def review_step(
    dr_number: str,
    step_number: int,
    action: ReviewAction,
    project: str = Query(..., description="Project name"),
):
    """
    Submit a review action for a verification step.

    Actions:
    - approve: Mark step as approved
    - reject: Reject and request re-submission
    - comment: Add a note without changing status
    """
    session_data = load_session_detail(dr_number, project)

    if not session_data:
        raise HTTPException(status_code=404, detail=f"Session not found: {dr_number}")

    # TODO: Implement review logic
    # - Update session file
    # - Send Telegram message if send_to_user is True
    # - Log to database

    logger.info(f"Review action for {dr_number} step {step_number}: {action.action}")

    return {
        "status": "success",
        "message": f"Step {step_number} {action.action}d",
        "dr_number": dr_number,
        "step_number": step_number,
        "action": action.action,
        "comment": action.comment,
    }


@router.get("/review-queue")
async def get_review_queue(
    project: Optional[str] = Query(None, description="Filter by project"),
    limit: int = Query(50, ge=1, le=200),
):
    """
    Get items needing manual review.

    Includes:
    - Auto-advanced steps (3-strike failures)
    - Low confidence AI decisions
    - GPS location mismatches
    """
    sessions = load_sessions_from_files(project, limit)

    review_items = []
    for session in sessions:
        auto_advanced = session.get("auto_advanced_steps", [])
        if auto_advanced:
            for step_num in auto_advanced:
                step_info = VERIFICATION_STEPS.get(step_num, {})
                review_items.append({
                    "dr_number": session["dr_number"],
                    "project": session["project"],
                    "step_number": step_num,
                    "step_name": step_info.get("name", f"Step {step_num}"),
                    "reason": "auto_advanced",
                    "is_critical": step_info.get("critical", False),
                    "last_activity": session["last_activity"],
                })

    # Sort by criticality then recency
    review_items.sort(key=lambda x: (not x["is_critical"], x["last_activity"]), reverse=True)

    return review_items


@router.get("/stats")
async def get_stats(
    project: Optional[str] = Query(None, description="Filter by project"),
    period: str = Query("today", description="Time period (today, week, month)"),
):
    """Get verification statistics."""
    sessions = load_sessions_from_files(project, limit=500)

    # Filter by period
    now = datetime.utcnow()
    if period == "today":
        start_date = now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif period == "week":
        start_date = now - timedelta(days=7)
    elif period == "month":
        start_date = now - timedelta(days=30)
    else:
        start_date = now - timedelta(days=1)

    filtered = [s for s in sessions if s["started_at"] >= start_date]

    # Calculate stats
    total = len(filtered)
    completed = len([s for s in filtered if s["status"] == SessionStatus.COMPLETED])
    active = len([s for s in filtered if s["status"] == SessionStatus.ACTIVE])
    needs_review = len([s for s in filtered if s["status"] == SessionStatus.NEEDS_REVIEW])

    # Average duration for completed
    completed_sessions = [s for s in filtered if s["status"] == SessionStatus.COMPLETED]
    avg_duration = 0
    if completed_sessions:
        durations = [(s["last_activity"] - s["started_at"]).total_seconds() / 60 for s in completed_sessions]
        avg_duration = sum(durations) / len(durations)

    return {
        "period": period,
        "project": project or "all",
        "total_sessions": total,
        "completed": completed,
        "active": active,
        "needs_review": needs_review,
        "completion_rate": round(completed / total * 100, 1) if total > 0 else 0,
        "average_duration_minutes": round(avg_duration, 1),
    }


# ============================================================================
# WEBSOCKET FOR REAL-TIME UPDATES
# ============================================================================

class ConnectionManager:
    """Manages WebSocket connections for real-time updates."""

    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"WebSocket connected. Total: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)
        logger.info(f"WebSocket disconnected. Total: {len(self.active_connections)}")

    async def broadcast(self, message: dict):
        """Send message to all connected clients."""
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception as e:
                logger.error(f"WebSocket send error: {e}")


manager = ConnectionManager()


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint for real-time updates.

    Message types:
    - session_started: New DR verification session started
    - photo_received: Photo submitted for verification
    - step_completed: Step verification complete (pass/fail)
    - session_completed: All steps done
    - review_needed: Manual review required
    """
    await manager.connect(websocket)
    try:
        while True:
            # Keep connection alive, wait for messages
            data = await websocket.receive_text()

            # Handle ping/pong
            if data == "ping":
                await websocket.send_text("pong")

            # Handle subscription requests
            try:
                msg = json.loads(data)
                if msg.get("type") == "subscribe":
                    # Client wants to subscribe to specific projects
                    logger.info(f"Client subscribed to: {msg.get('projects', 'all')}")
            except json.JSONDecodeError:
                pass

    except WebSocketDisconnect:
        manager.disconnect(websocket)


async def broadcast_update(event_type: str, data: dict):
    """Broadcast an update to all WebSocket clients."""
    await manager.broadcast({
        "type": event_type,
        "data": data,
        "timestamp": datetime.utcnow().isoformat(),
    })


# ============================================================================
# SEARCH ENDPOINT (Per Plan Phase 2)
# ============================================================================

@router.get("/search")
async def search_drs(
    q: str = Query(..., min_length=2, description="Search query (DR number, technician, address)"),
    project: Optional[str] = Query(None, description="Filter by project"),
    status: Optional[str] = Query(None, description="Filter by QA status (passed, failed, pending, needs_review)"),
    limit: int = Query(50, ge=1, le=100, description="Maximum results"),
):
    """Search DRs across photos and sessions.

    Searches:
    - DR number (partial match, e.g., "DR173")
    - Technician name (if session data available)
    - GPS address (if location data available)

    Returns results with QA status badges.
    """
    results = []
    q_lower = q.lower()

    # Load all sessions for search
    all_sessions = load_sessions_from_files(project=project, limit=500)

    for session in all_sessions:
        match_score = 0
        match_reason = None

        # Search DR number
        if q_lower in session["dr_number"].lower():
            match_score = 100 if q_lower == session["dr_number"].lower() else 80
            match_reason = "dr_number"

        # Search GPS address (if available)
        gps_address = session.get("gps_address", "")
        if gps_address and q_lower in gps_address.lower():
            match_score = max(match_score, 60)
            match_reason = match_reason or "address"

        # Search step results for AI notes
        step_results = session.get("step_results", {})
        for step_num, step_result in step_results.items():
            notes = step_result.get("notes", "")
            if notes and q_lower in notes.lower():
                match_score = max(match_score, 40)
                match_reason = match_reason or "notes"
                break

        if match_score > 0:
            # Get QA status for this DR
            qa_status = _get_qa_status_badge(session)

            # Apply status filter
            if status and qa_status["status"] != status:
                continue

            results.append({
                "dr_number": session["dr_number"],
                "project": session["project"],
                "match_score": match_score,
                "match_reason": match_reason,
                "qa_badge": qa_status,
                "session_status": str(session["status"].value) if isinstance(session["status"], SessionStatus) else session["status"],
                "steps_completed": session.get("steps_completed", 0),
                "steps_failed": session.get("steps_failed", 0),
                "last_activity": session["last_activity"].isoformat() if hasattr(session["last_activity"], "isoformat") else session["last_activity"],
                "gps_address": session.get("gps_address"),
            })

    # Sort by match score (highest first)
    results.sort(key=lambda x: x["match_score"], reverse=True)

    return {
        "query": q,
        "total": len(results),
        "results": results[:limit]
    }


# ============================================================================
# QA STATUS AND BADGES (Per Plan Phase 2)
# ============================================================================

class QABadgeColor(str, Enum):
    """QA badge color based on status and confidence."""
    GREEN = "green"      # Passed, high confidence (>=0.9)
    YELLOW = "yellow"    # Passed, low confidence (<0.9) or needs_review
    RED = "red"          # Failed
    GRAY = "gray"        # Pending (not yet evaluated)


@router.get("/sessions/{dr_number}/qa-status")
async def get_session_qa_status(
    dr_number: str,
    project: str = Query(..., description="Project name"),
):
    """Get detailed QA status for a DR session.

    Returns per-step QA badges with confidence scores.
    """
    photos = get_photos_for_dr(dr_number, project)
    session_data = load_session_detail(dr_number, project)

    if not photos and not session_data:
        raise HTTPException(status_code=404, detail=f"DR not found: {dr_number}")

    step_results = session_data.get("step_results", {}) if session_data else {}
    auto_advanced = session_data.get("auto_advanced_steps", []) if session_data else []

    # Group photos by step
    photos_by_step = {}
    for p in photos:
        step = p["step_number"]
        if step not in photos_by_step:
            photos_by_step[step] = []
        photos_by_step[step].append(p)

    # Build QA status for each step
    steps_qa = []
    total_passed = 0
    total_failed = 0
    total_pending = 0
    total_review = 0

    for step_num in range(1, 12):
        step_info = VERIFICATION_STEPS.get(step_num, {})
        step_result = step_results.get(str(step_num), {})
        step_photos = photos_by_step.get(step_num, [])

        # Determine QA status and badge
        confidence = step_result.get("confidence", 0)
        ai_status = step_result.get("status", None)
        provider = step_result.get("provider", None)
        cost = step_result.get("cost", 0)

        if step_num in auto_advanced:
            qa_status = "auto_advanced"
            badge_color = QABadgeColor.YELLOW
            total_review += 1
        elif ai_status == "passed":
            qa_status = "passed"
            badge_color = QABadgeColor.GREEN if confidence >= 0.9 else QABadgeColor.YELLOW
            total_passed += 1
        elif ai_status == "failed":
            qa_status = "failed"
            badge_color = QABadgeColor.RED
            total_failed += 1
        elif step_photos:
            qa_status = "pending"
            badge_color = QABadgeColor.GRAY
            total_pending += 1
        else:
            qa_status = "no_photo"
            badge_color = QABadgeColor.GRAY
            total_pending += 1

        steps_qa.append({
            "step_number": step_num,
            "step_name": step_info.get("name", f"Step {step_num}"),
            "is_critical": step_info.get("critical", False),
            "qa_status": qa_status,
            "badge_color": badge_color.value,
            "confidence": confidence,
            "provider": provider,
            "cost": cost,
            "photo_count": len(step_photos),
            "ai_result": step_result.get("ai_result"),
            "issues": step_result.get("issues", []),
        })

    # Determine overall status
    if total_failed > 0:
        overall_status = "failed"
        overall_badge = QABadgeColor.RED
    elif total_review > 0:
        overall_status = "needs_review"
        overall_badge = QABadgeColor.YELLOW
    elif total_pending > 0:
        overall_status = "partial"
        overall_badge = QABadgeColor.GRAY
    elif total_passed == 11:
        overall_status = "passed"
        overall_badge = QABadgeColor.GREEN
    else:
        overall_status = "unknown"
        overall_badge = QABadgeColor.GRAY

    return {
        "dr_number": dr_number,
        "project": project,
        "overall_status": overall_status,
        "overall_badge": overall_badge.value,
        "summary": {
            "total_steps": 11,
            "passed": total_passed,
            "failed": total_failed,
            "pending": total_pending,
            "needs_review": total_review,
            "pass_rate": round(total_passed / 11 * 100, 1)
        },
        "steps": steps_qa
    }


@router.get("/qa-summary")
async def get_qa_dashboard_summary(
    project: Optional[str] = Query(None, description="Filter by project"),
    period: str = Query("all", description="Time period (today, week, month, all)"),
):
    """Get QA summary statistics for dashboard cards.

    Returns aggregate stats like:
    - Total DRs
    - QA Passed
    - QA Failed
    - Pending Review
    """
    sessions = load_sessions_from_files(project=project, limit=500)

    # Filter by period
    now = datetime.utcnow()
    if period == "today":
        start_date = now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif period == "week":
        start_date = now - timedelta(days=7)
    elif period == "month":
        start_date = now - timedelta(days=30)
    else:
        start_date = None

    if start_date:
        sessions = [s for s in sessions if s["last_activity"] >= start_date]

    # Count by QA status
    total = len(sessions)
    passed = 0
    failed = 0
    pending = 0
    needs_review = 0

    for session in sessions:
        qa_badge = _get_qa_status_badge(session)
        status = qa_badge["status"]

        if status == "passed":
            passed += 1
        elif status == "failed":
            failed += 1
        elif status == "needs_review":
            needs_review += 1
        else:
            pending += 1

    return {
        "period": period,
        "project": project or "all",
        "total_drs": total,
        "passed_count": passed,
        "failed_count": failed,
        "pending_count": pending + needs_review,
        "needs_review": needs_review,
        "pass_rate": round(passed / total * 100, 1) if total > 0 else 0,
        "total_cost": 0.0,  # TODO: Calculate from dr_qa_audit_log when available
        "cards": [
            {"label": "Total DRs", "value": total, "color": "blue"},
            {"label": "QA Passed", "value": passed, "color": "green"},
            {"label": "QA Failed", "value": failed, "color": "red"},
            {"label": "Pending", "value": pending + needs_review, "color": "yellow"},
        ]
    }


def _get_qa_status_badge(session: Dict) -> Dict[str, Any]:
    """Get QA status badge for a session.

    Returns:
        {
            "status": "passed"|"failed"|"pending"|"needs_review",
            "badge_color": "green"|"red"|"gray"|"yellow",
            "confidence": 0.0-1.0,
            "passed_count": int,
            "failed_count": int
        }
    """
    step_results = session.get("step_results", {})
    auto_advanced = session.get("auto_advanced_steps", [])

    passed = 0
    failed = 0
    total_confidence = 0

    for step_num, result in step_results.items():
        status = result.get("status")
        confidence = result.get("confidence", 0)

        if status == "passed":
            passed += 1
            total_confidence += confidence
        elif status == "failed":
            failed += 1

    avg_confidence = total_confidence / max(passed, 1)

    if failed > 0:
        return {
            "status": "failed",
            "badge_color": "red",
            "confidence": avg_confidence,
            "passed_count": passed,
            "failed_count": failed
        }
    elif auto_advanced:
        return {
            "status": "needs_review",
            "badge_color": "yellow",
            "confidence": avg_confidence,
            "passed_count": passed,
            "failed_count": len(auto_advanced)
        }
    elif passed == 0:
        return {
            "status": "pending",
            "badge_color": "gray",
            "confidence": 0,
            "passed_count": 0,
            "failed_count": 0
        }
    elif passed == 11:
        badge_color = "green" if avg_confidence >= 0.9 else "yellow"
        return {
            "status": "passed",
            "badge_color": badge_color,
            "confidence": avg_confidence,
            "passed_count": passed,
            "failed_count": failed
        }
    else:
        return {
            "status": "partial",
            "badge_color": "gray",
            "confidence": avg_confidence,
            "passed_count": passed,
            "failed_count": failed
        }


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def _map_db_status(db_status: str, is_frozen: bool = False) -> SessionStatus:
    """Map database status to SessionStatus enum."""
    if is_frozen:
        return SessionStatus.NEEDS_REVIEW
    if db_status in ("pending", "downloading", "analyzing"):
        return SessionStatus.ACTIVE
    if db_status == "complete":
        return SessionStatus.COMPLETED
    if db_status == "failed":
        return SessionStatus.FAILED
    return SessionStatus.ACTIVE


def _calc_duration(started: datetime, completed: Optional[datetime]) -> int:
    """Calculate duration in minutes."""
    end = completed or datetime.utcnow()
    return int((end - started).total_seconds() / 60)
