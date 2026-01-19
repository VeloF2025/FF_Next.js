#!/usr/bin/env python3
"""
FastAPI webhook server for QField OES sync.

Listens on port 8095 for sync requests from FibreFlow OES import.

Endpoints:
    POST /sync/oes     - Trigger delta sync
    POST /sync/full    - Trigger full sync
    GET  /health       - Health check
    GET  /status       - Last sync status
"""

import os
import sys
import subprocess
import logging
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, BackgroundTasks, HTTPException
from pydantic import BaseModel
import uvicorn

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler('/var/log/qfield-sync-server.log', mode='a')
    ]
)
logger = logging.getLogger(__name__)

app = FastAPI(title="QField OES Sync Server", version="1.0.0")

# Track sync status
class SyncStatus:
    last_sync: Optional[datetime] = None
    last_count: int = 0
    last_error: Optional[str] = None
    is_running: bool = False

sync_status = SyncStatus()


class SyncRequest(BaseModel):
    """Request body for sync endpoint."""
    batchId: Optional[str] = None
    totalRows: Optional[int] = None


class SyncResponse(BaseModel):
    """Response from sync endpoint."""
    success: bool
    message: str
    count: Optional[int] = None
    timestamp: str


def run_sync(full: bool = False, gpkg: bool = False):
    """Run the sync script."""
    global sync_status

    if sync_status.is_running:
        logger.warning("Sync already in progress, skipping")
        return

    sync_status.is_running = True
    sync_status.last_error = None

    try:
        script_path = os.path.join(os.path.dirname(__file__), 'sync_oes_to_qfield.py')
        cmd = [sys.executable, script_path]
        if full:
            cmd.append('--full')
        if gpkg:
            cmd.append('--gpkg')

        logger.info(f"Running sync: {' '.join(cmd)}")
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)

        if result.returncode == 0:
            # Parse count from output
            for line in result.stdout.split('\n'):
                if 'records' in line.lower():
                    try:
                        count = int(''.join(filter(str.isdigit, line.split(':')[-1].split()[0])))
                        sync_status.last_count = count
                    except (ValueError, IndexError):
                        pass

            sync_status.last_sync = datetime.now()
            logger.info(f"Sync completed successfully: {sync_status.last_count} records")
        else:
            sync_status.last_error = result.stderr or "Unknown error"
            logger.error(f"Sync failed: {sync_status.last_error}")

    except subprocess.TimeoutExpired:
        sync_status.last_error = "Sync timed out after 5 minutes"
        logger.error(sync_status.last_error)
    except Exception as e:
        sync_status.last_error = str(e)
        logger.error(f"Sync error: {e}")
    finally:
        sync_status.is_running = False


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "healthy", "service": "qfield-sync"}


@app.get("/status")
async def status():
    """Get last sync status."""
    return {
        "last_sync": sync_status.last_sync.isoformat() if sync_status.last_sync else None,
        "last_count": sync_status.last_count,
        "last_error": sync_status.last_error,
        "is_running": sync_status.is_running
    }


@app.post("/sync/oes", response_model=SyncResponse)
async def sync_oes(request: SyncRequest, background_tasks: BackgroundTasks):
    """
    Trigger delta OES sync.
    Called by FibreFlow after OES import.
    """
    if sync_status.is_running:
        return SyncResponse(
            success=False,
            message="Sync already in progress",
            timestamp=datetime.now().isoformat()
        )

    logger.info(f"Sync requested - batchId: {request.batchId}, totalRows: {request.totalRows}")

    # Run sync in background
    background_tasks.add_task(run_sync, full=False, gpkg=True)

    return SyncResponse(
        success=True,
        message="Sync started",
        timestamp=datetime.now().isoformat()
    )


@app.post("/sync/full", response_model=SyncResponse)
async def sync_full(background_tasks: BackgroundTasks):
    """
    Trigger full OES sync (truncate + insert).
    """
    if sync_status.is_running:
        return SyncResponse(
            success=False,
            message="Sync already in progress",
            timestamp=datetime.now().isoformat()
        )

    logger.info("Full sync requested")

    # Run full sync in background
    background_tasks.add_task(run_sync, full=True, gpkg=True)

    return SyncResponse(
        success=True,
        message="Full sync started",
        timestamp=datetime.now().isoformat()
    )


if __name__ == "__main__":
    port = int(os.environ.get("SYNC_SERVER_PORT", 8095))
    logger.info(f"Starting QField Sync Server on port {port}")
    uvicorn.run(app, host="0.0.0.0", port=port)
