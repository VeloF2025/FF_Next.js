"""
DR Photo Verification API Routes

Provides REST API endpoints for DR photo verification workflow:
- Query DR records from 1Map
- Download and serve DR photos
- Verify photo completeness
- Browse by project/site

Author: BOSS System
"""

import logging
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel

from agents.integrations.onemap_specialist_agent import (
    OneMapSpecialistAgent,
    DRRecord,
    PhotoType,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/dr-photos", tags=["DR Photos"])

# Photo storage path
PHOTOS_BASE_PATH = Path("data/dr_photos")


# =============================================================================
# RESPONSE MODELS
# =============================================================================

class DRRecordResponse(BaseModel):
    """DR record response model."""
    dr_number: str
    site: str
    site_name: str
    status: Optional[str]
    address: Optional[str]
    photo_count: int
    photos: dict
    coordinates: Optional[dict]


class PhotoSummaryResponse(BaseModel):
    """Photo summary response model."""
    dr_number: str
    total_photos: int
    available: List[str]
    missing: List[str]
    downloaded: bool
    download_path: Optional[str]


class VerificationResponse(BaseModel):
    """Photo verification response model."""
    dr_number: str
    site: str
    status: Optional[str]
    verified: bool
    required_photos: List[str]
    available_photos: List[str]
    missing_photos: List[str]
    photo_count: int
    address: Optional[str]


class SiteStatsResponse(BaseModel):
    """Site statistics response model."""
    site: str
    site_name: str
    total_records: int
    status_breakdown: dict
    photo_coverage: dict


class DownloadResponse(BaseModel):
    """Download response model."""
    dr_number: str
    photos_downloaded: int
    output_path: str
    files: List[str]


# =============================================================================
# API ENDPOINTS
# =============================================================================

@router.get("/", response_class=HTMLResponse)
async def dr_photos_ui():
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
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; padding: 20px; }
            .container { max-width: 1200px; margin: 0 auto; }
            h1 { color: #333; margin-bottom: 20px; }
            .search-box { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); margin-bottom: 20px; }
            .search-box input { padding: 12px; font-size: 16px; border: 1px solid #ddd; border-radius: 4px; width: 300px; }
            .search-box button { padding: 12px 24px; font-size: 16px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; margin-left: 10px; }
            .search-box button:hover { background: #0056b3; }
            .search-box button.download { background: #28a745; }
            .search-box button.download:hover { background: #1e7e34; }
            .result { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); margin-bottom: 20px; }
            .result h2 { color: #333; margin-bottom: 15px; border-bottom: 1px solid #eee; padding-bottom: 10px; }
            .info-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 20px; }
            .info-item { background: #f8f9fa; padding: 10px; border-radius: 4px; }
            .info-item label { font-size: 12px; color: #666; display: block; }
            .info-item span { font-size: 16px; font-weight: 500; color: #333; }
            .photos-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 15px; }
            .photo-card { background: #f8f9fa; border-radius: 8px; overflow: hidden; }
            .photo-card img { width: 100%; height: 200px; object-fit: cover; cursor: pointer; }
            .photo-card .caption { padding: 10px; font-size: 14px; color: #666; }
            .status-badge { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 500; }
            .status-badge.verified { background: #d4edda; color: #155724; }
            .status-badge.missing { background: #f8d7da; color: #721c24; }
            .loading { text-align: center; padding: 40px; color: #666; }
            .error { background: #f8d7da; color: #721c24; padding: 15px; border-radius: 4px; }
            .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.9); z-index: 1000; justify-content: center; align-items: center; }
            .modal img { max-width: 90%; max-height: 90%; }
            .modal.active { display: flex; }
            .close-modal { position: absolute; top: 20px; right: 30px; color: white; font-size: 40px; cursor: pointer; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🔍 DR Photo Verification</h1>

            <div class="search-box">
                <input type="text" id="drInput" placeholder="Enter DR number (e.g., DR1733592)" onkeypress="if(event.key==='Enter')searchDR()">
                <button onclick="searchDR()">Search</button>
                <button class="download" onclick="downloadPhotos()">Download Photos</button>
            </div>

            <div id="result"></div>
        </div>

        <div class="modal" id="imageModal" onclick="closeModal()">
            <span class="close-modal">&times;</span>
            <img id="modalImage" src="">
        </div>

        <script>
            const API_BASE = '/api/v1/dr-photos';

            async function searchDR() {
                const dr = document.getElementById('drInput').value.trim();
                if (!dr) return;

                const resultDiv = document.getElementById('result');
                resultDiv.innerHTML = '<div class="loading">Searching...</div>';

                try {
                    const response = await fetch(`${API_BASE}/record/${dr}`);
                    if (!response.ok) {
                        const error = await response.json();
                        throw new Error(error.detail || 'DR not found');
                    }
                    const data = await response.json();
                    displayResult(data);
                } catch (error) {
                    resultDiv.innerHTML = `<div class="error">${error.message}</div>`;
                }
            }

            async function downloadPhotos() {
                const dr = document.getElementById('drInput').value.trim();
                if (!dr) return;

                const resultDiv = document.getElementById('result');
                resultDiv.innerHTML = '<div class="loading">Downloading photos from 1Map...</div>';

                try {
                    const response = await fetch(`${API_BASE}/download/${dr}`, { method: 'POST' });
                    if (!response.ok) {
                        const error = await response.json();
                        throw new Error(error.detail || 'Download failed');
                    }
                    const data = await response.json();
                    resultDiv.innerHTML = `
                        <div class="result">
                            <h2>✅ Download Complete</h2>
                            <p>Downloaded ${data.photos_downloaded} photos to ${data.output_path}</p>
                            <p>Files: ${data.files.join(', ')}</p>
                        </div>
                    `;
                    // Refresh to show photos
                    setTimeout(searchDR, 1000);
                } catch (error) {
                    resultDiv.innerHTML = `<div class="error">${error.message}</div>`;
                }
            }

            function displayResult(data) {
                const resultDiv = document.getElementById('result');

                let photosHTML = '';
                if (data.local_photos && data.local_photos.length > 0) {
                    photosHTML = `
                        <h3 style="margin: 20px 0 15px;">📷 Downloaded Photos (${data.local_photos.length})</h3>
                        <div class="photos-grid">
                            ${data.local_photos.map(p => `
                                <div class="photo-card">
                                    <img src="${API_BASE}/photo/${data.dr_number}/${p.filename}"
                                         alt="${p.type}"
                                         onclick="openModal(this.src)"
                                         onerror="this.style.display='none'">
                                    <div class="caption">${p.type}</div>
                                </div>
                            `).join('')}
                        </div>
                    `;
                } else {
                    photosHTML = `
                        <div style="margin-top: 20px; padding: 20px; background: #fff3cd; border-radius: 4px; color: #856404;">
                            📥 No photos downloaded yet. Click "Download Photos" to fetch from 1Map.
                        </div>
                    `;
                }

                resultDiv.innerHTML = `
                    <div class="result">
                        <h2>${data.dr_number}
                            <span class="status-badge ${data.photo_count > 10 ? 'verified' : 'missing'}">
                                ${data.photo_count} photos available
                            </span>
                        </h2>

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
                        </div>

                        ${photosHTML}
                    </div>
                `;
            }

            function openModal(src) {
                document.getElementById('modalImage').src = src;
                document.getElementById('imageModal').classList.add('active');
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


@router.get("/record/{dr_number}", response_model=DRRecordResponse)
async def get_dr_record(dr_number: str):
    """
    Get DR record details from 1Map.

    Args:
        dr_number: DR number (e.g., DR1733592)

    Returns:
        DR record with photos info and local photo list
    """
    try:
        async with OneMapSpecialistAgent() as agent:
            record = await agent.get_dr(dr_number)

            if not record:
                raise HTTPException(status_code=404, detail=f"DR {dr_number} not found")

            # Check for local photos
            local_photos = []
            dr_path = PHOTOS_BASE_PATH / dr_number
            if dr_path.exists():
                for photo_file in dr_path.glob("*.jpg"):
                    # Parse photo type from filename
                    parts = photo_file.stem.split("_")
                    photo_type = "_".join(parts[1:-1]) if len(parts) > 2 else "unknown"
                    local_photos.append({
                        "filename": photo_file.name,
                        "type": photo_type,
                        "size": photo_file.stat().st_size
                    })

            return {
                "dr_number": record.dr_number,
                "site": record.site,
                "site_name": agent.get_site_name(record.site),
                "status": record.status,
                "address": record.address,
                "photo_count": len(record.photos),
                "photos": record.photos,
                "coordinates": record.coordinates,
                "local_photos": local_photos
            }

    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        logger.error(f"Error fetching DR {dr_number}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/download/{dr_number}", response_model=DownloadResponse)
async def download_dr_photos(dr_number: str):
    """
    Download all photos for a DR from 1Map.

    Args:
        dr_number: DR number (e.g., DR1733592)

    Returns:
        Download result with file list
    """
    try:
        async with OneMapSpecialistAgent() as agent:
            record = await agent.get_dr(dr_number)

            if not record:
                raise HTTPException(status_code=404, detail=f"DR {dr_number} not found")

            output_dir = PHOTOS_BASE_PATH / dr_number
            photos = await agent.download_all_photos(record, str(output_dir))

            files = [f"{record.dr_number}_{p.photo_type}_{p.attachment_id}.jpg" for p in photos]

            return {
                "dr_number": dr_number,
                "photos_downloaded": len(photos),
                "output_path": str(output_dir),
                "files": files
            }

    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        logger.error(f"Error downloading photos for DR {dr_number}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/photo/{dr_number}/{filename}")
async def serve_photo(dr_number: str, filename: str):
    """
    Serve a downloaded photo file.

    Args:
        dr_number: DR number
        filename: Photo filename

    Returns:
        Photo file
    """
    photo_path = PHOTOS_BASE_PATH / dr_number / filename

    if not photo_path.exists():
        raise HTTPException(status_code=404, detail="Photo not found")

    return FileResponse(
        photo_path,
        media_type="image/jpeg",
        filename=filename
    )


@router.get("/verify/{dr_number}", response_model=VerificationResponse)
async def verify_dr_photos(
    dr_number: str,
    required: Optional[str] = Query(None, description="Comma-separated required photo types")
):
    """
    Verify that a DR has required photos.

    Args:
        dr_number: DR number to verify
        required: Optional comma-separated list of required photo types

    Returns:
        Verification result
    """
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


@router.get("/sites", response_model=dict)
async def list_sites():
    """List all known project sites."""
    async with OneMapSpecialistAgent() as agent:
        return {"sites": agent.list_known_sites()}


@router.get("/sites/{site}/stats", response_model=SiteStatsResponse)
async def get_site_stats(site: str):
    """
    Get statistics for a project site.

    Args:
        site: Site code (e.g., LAW, KWN)

    Returns:
        Site statistics
    """
    try:
        async with OneMapSpecialistAgent() as agent:
            return await agent.get_site_statistics(site)

    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        logger.error(f"Error getting stats for site {site}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/search")
async def search_records(
    site: Optional[str] = Query(None, description="Site code"),
    dr_pattern: Optional[str] = Query(None, description="DR pattern with wildcards"),
    limit: int = Query(50, description="Maximum results")
):
    """
    Search DR records.

    Args:
        site: Optional site code filter
        dr_pattern: Optional DR pattern (use % for wildcards)
        limit: Maximum results to return

    Returns:
        List of matching DR records
    """
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
