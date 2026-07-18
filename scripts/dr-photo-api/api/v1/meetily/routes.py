"""
Meetily Meeting Intelligence API Routes

Provides endpoints for:
- Meeting management (list, get, update, delete)
- Transcript processing and summarization
- Model configuration management
- Proxy to Meetily backend service

Author: BOSS Development Team
Created: 2025-11-18
Updated: 2025-11-18 (Fixed to match actual Meetily backend API)
"""

import logging
import httpx
from typing import Dict, Any, List, Optional
from datetime import datetime
from fastapi import APIRouter, HTTPException, Depends, status
from pydantic import BaseModel, Field

from api.auth import verify_api_key

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/meetily", tags=["Meeting Intelligence"])

# Meetily backend service URL (from environment or default)
import os
MEETILY_BACKEND_URL = os.getenv("MEETILY_BACKEND_URL", "http://localhost:5167")


# ============================================================================
# REQUEST/RESPONSE MODELS (Matching Meetily Backend)
# ============================================================================

class Transcript(BaseModel):
    """Transcript segment model"""
    id: str
    text: str
    timestamp: str
    audio_start_time: Optional[float] = None
    audio_end_time: Optional[float] = None
    duration: Optional[float] = None


class TranscriptRequest(BaseModel):
    """Process transcript request"""
    text: str
    model: str  # "claude", "groq", "openai", "ollama"
    model_name: str
    meeting_id: str
    chunk_size: Optional[int] = 5000
    overlap: Optional[int] = 1000
    custom_prompt: Optional[str] = "Generate a summary of the meeting transcript."


class SaveTranscriptRequest(BaseModel):
    """Save transcript segments request"""
    meeting_title: str
    transcripts: List[Transcript]
    folder_path: Optional[str] = None


class MeetingTitleUpdate(BaseModel):
    """Update meeting title request"""
    meeting_id: str
    new_title: str


class DeleteMeetingRequest(BaseModel):
    """Delete meeting request"""
    meeting_id: str


class SaveModelConfigRequest(BaseModel):
    """Save AI model configuration"""
    model: str
    model_name: str
    api_key: Optional[str] = None
    base_url: Optional[str] = None


class SaveTranscriptConfigRequest(BaseModel):
    """Save transcript configuration"""
    chunk_size: int
    overlap: int
    custom_prompt: str


class MeetingResponse(BaseModel):
    """Basic meeting information"""
    id: str
    title: str
    created_at: str
    folder_path: Optional[str] = None


class MeetingDetailsResponse(BaseModel):
    """Detailed meeting information"""
    id: str
    title: str
    transcripts: List[Transcript]
    summary: Optional[str] = None
    created_at: str
    folder_path: Optional[str] = None


class ProcessResponse(BaseModel):
    """Process transcript response"""
    message: str
    process_id: str


# ============================================================================
# PROXY HELPER FUNCTION
# ============================================================================

async def proxy_to_meetily(
    endpoint: str,
    method: str = "GET",
    json_data: Optional[Dict] = None,
    params: Optional[Dict] = None
) -> Dict[str, Any]:
    """
    Proxy request to Meetily backend service.

    Args:
        endpoint: Meetily API endpoint (e.g., "/get-meetings")
        method: HTTP method (GET, POST, PUT, DELETE)
        json_data: JSON request body
        params: Query parameters

    Returns:
        Response from Meetily backend

    Raises:
        HTTPException: If proxy request fails
    """
    url = f"{MEETILY_BACKEND_URL}{endpoint}"

    logger.info(f"Proxying {method} request to Meetily: {url}")

    try:
        async with httpx.AsyncClient(timeout=300.0) as client:
            if method == "GET":
                response = await client.get(url, params=params)
            elif method == "POST":
                response = await client.post(url, json=json_data, params=params)
            elif method == "PUT":
                response = await client.put(url, json=json_data)
            elif method == "DELETE":
                response = await client.delete(url, params=params)
            else:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Unsupported HTTP method: {method}"
                )

            # Check for errors
            if response.status_code >= 400:
                error_detail = response.text
                logger.error(f"Meetily backend error ({response.status_code}): {error_detail}")
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"Meetily backend error: {error_detail}"
                )

            return response.json()

    except httpx.TimeoutException:
        logger.error(f"Timeout while proxying to Meetily: {url}")
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Meetily backend timeout (processing may take several minutes for large transcripts)"
        )
    except httpx.RequestError as e:
        logger.error(f"Request error while proxying to Meetily: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Meetily backend unavailable: {str(e)}"
        )
    except ValueError as e:
        logger.error(f"Invalid JSON response from Meetily: {e}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Invalid response from Meetily backend"
        )


# ============================================================================
# API ENDPOINTS (Matching Meetily Backend)
# ============================================================================

@router.get("/meetings", response_model=List[MeetingResponse], dependencies=[Depends(verify_api_key)])
async def get_meetings():
    """
    Get all meetings with basic information.

    Returns list of meetings with id, title, created_at, folder_path.

    **Example:**
    ```bash
    curl -X GET "http://localhost:8000/api/v1/meetily/meetings" \\
      -H "Authorization: Bearer boss_n8n_integration_key_2025"
    ```
    """
    logger.info("Fetching all meetings")
    return await proxy_to_meetily("/get-meetings", method="GET")


@router.get("/meetings/{meeting_id}", response_model=MeetingDetailsResponse, dependencies=[Depends(verify_api_key)])
async def get_meeting(meeting_id: str):
    """
    Get detailed information for a specific meeting.

    Returns meeting with id, title, transcripts, summary, created_at, folder_path.

    **Example:**
    ```bash
    curl -X GET "http://localhost:8000/api/v1/meetily/meetings/meeting_123" \\
      -H "Authorization: Bearer boss_n8n_integration_key_2025"
    ```
    """
    logger.info(f"Fetching meeting details: {meeting_id}")
    return await proxy_to_meetily(f"/get-meeting/{meeting_id}", method="GET")


@router.post("/meetings/title", dependencies=[Depends(verify_api_key)])
async def save_meeting_title(data: MeetingTitleUpdate):
    """
    Update meeting title.

    **Request Body:**
    ```json
    {
        "meeting_id": "meeting_123",
        "new_title": "Q4 Strategy Meeting"
    }
    ```

    **Example:**
    ```bash
    curl -X POST "http://localhost:8000/api/v1/meetily/meetings/title" \\
      -H "Authorization: Bearer boss_n8n_integration_key_2025" \\
      -H "Content-Type: application/json" \\
      -d '{"meeting_id": "meeting_123", "new_title": "Updated Title"}'
    ```
    """
    logger.info(f"Updating meeting title: {data.meeting_id} -> {data.new_title}")
    return await proxy_to_meetily("/save-meeting-title", method="POST", json_data=data.dict())


@router.delete("/meetings/{meeting_id}", dependencies=[Depends(verify_api_key)])
async def delete_meeting(meeting_id: str):
    """
    Delete a meeting and all associated data (transcripts, summaries).

    **Example:**
    ```bash
    curl -X DELETE "http://localhost:8000/api/v1/meetily/meetings/meeting_123" \\
      -H "Authorization: Bearer boss_n8n_integration_key_2025"
    ```
    """
    logger.info(f"Deleting meeting: {meeting_id}")
    data = {"meeting_id": meeting_id}
    return await proxy_to_meetily("/delete-meeting", method="POST", json_data=data)


@router.post("/process", response_model=ProcessResponse, dependencies=[Depends(verify_api_key)])
async def process_transcript(transcript: TranscriptRequest):
    """
    Process transcript text and generate meeting summary (async background task).

    This endpoint starts background processing and returns immediately with a process_id.
    Use GET /summary/{meeting_id} to check processing status and retrieve results.

    **Supported Models:**
    - `claude`: Claude AI (via Anthropic API)
    - `groq`: Groq AI (fast inference)
    - `openai`: OpenAI GPT models
    - `ollama`: Local Ollama models

    **Request Body:**
    ```json
    {
        "text": "Meeting transcript text here...",
        "model": "claude",
        "model_name": "claude-3-5-sonnet-20241022",
        "meeting_id": "meeting_123",
        "chunk_size": 5000,
        "overlap": 1000,
        "custom_prompt": "Generate a summary of the meeting transcript."
    }
    ```

    **Response:**
    ```json
    {
        "message": "Processing started",
        "process_id": "proc_abc123"
    }
    ```

    **Example:**
    ```bash
    curl -X POST "http://localhost:8000/api/v1/meetily/process" \\
      -H "Authorization: Bearer boss_n8n_integration_key_2025" \\
      -H "Content-Type: application/json" \\
      -d '{
        "text": "Team discussed Q4 goals...",
        "model": "claude",
        "model_name": "claude-3-5-sonnet-20241022",
        "meeting_id": "meeting_123"
      }'
    ```
    """
    logger.info(f"Processing transcript for meeting: {transcript.meeting_id}, model: {transcript.model}")
    return await proxy_to_meetily("/process-transcript", method="POST", json_data=transcript.dict())


@router.get("/summary/{meeting_id}", dependencies=[Depends(verify_api_key)])
async def get_summary(meeting_id: str):
    """
    Get processing results and summary for a meeting.

    Returns:
    - Processing status (pending/complete/failed)
    - Generated summary (if complete)
    - Error message (if failed)

    **Response (Processing):**
    ```json
    {
        "status": "processing",
        "message": "Processing in progress..."
    }
    ```

    **Response (Complete):**
    ```json
    {
        "status": "complete",
        "summary": "Meeting summary text...",
        "meeting_id": "meeting_123"
    }
    ```

    **Example:**
    ```bash
    curl -X GET "http://localhost:8000/api/v1/meetily/summary/meeting_123" \\
      -H "Authorization: Bearer boss_n8n_integration_key_2025"
    ```
    """
    logger.info(f"Retrieving summary for meeting: {meeting_id}")
    return await proxy_to_meetily(f"/get-summary/{meeting_id}", method="GET")


@router.post("/transcripts", dependencies=[Depends(verify_api_key)])
async def save_transcript(request: SaveTranscriptRequest):
    """
    Save transcript segments for a meeting without processing.

    Use this to save raw transcript data before processing it.

    **Request Body:**
    ```json
    {
        "meeting_title": "Team Standup",
        "transcripts": [
            {
                "id": "seg_1",
                "text": "First segment...",
                "timestamp": "2025-11-18T10:00:00Z",
                "audio_start_time": 0.0,
                "audio_end_time": 5.5,
                "duration": 5.5
            }
        ],
        "folder_path": "/meetings/2025-11"
    }
    ```

    **Example:**
    ```bash
    curl -X POST "http://localhost:8000/api/v1/meetily/transcripts" \\
      -H "Authorization: Bearer boss_n8n_integration_key_2025" \\
      -H "Content-Type: application/json" \\
      -d '{
        "meeting_title": "Team Meeting",
        "transcripts": [...]
      }'
    ```
    """
    logger.info(f"Saving transcript: {request.meeting_title}")
    return await proxy_to_meetily("/save-transcript", method="POST", json_data=request.dict())


@router.get("/config/model", dependencies=[Depends(verify_api_key)])
async def get_model_config():
    """
    Get current AI model configuration.

    Returns:
    - Selected model (claude/groq/openai/ollama)
    - Model name
    - API configuration (without sensitive keys)

    **Example:**
    ```bash
    curl -X GET "http://localhost:8000/api/v1/meetily/config/model" \\
      -H "Authorization: Bearer boss_n8n_integration_key_2025"
    ```
    """
    logger.info("Fetching model configuration")
    return await proxy_to_meetily("/get-model-config", method="GET")


@router.post("/config/model", dependencies=[Depends(verify_api_key)])
async def save_model_config(config: SaveModelConfigRequest):
    """
    Save AI model configuration.

    **Request Body:**
    ```json
    {
        "model": "claude",
        "model_name": "claude-3-5-sonnet-20241022",
        "api_key": "sk-ant-...",
        "base_url": "https://api.anthropic.com"
    }
    ```

    **Example:**
    ```bash
    curl -X POST "http://localhost:8000/api/v1/meetily/config/model" \\
      -H "Authorization: Bearer boss_n8n_integration_key_2025" \\
      -H "Content-Type: application/json" \\
      -d '{
        "model": "claude",
        "model_name": "claude-3-5-sonnet-20241022"
      }'
    ```
    """
    logger.info(f"Saving model configuration: {config.model}/{config.model_name}")
    return await proxy_to_meetily("/save-model-config", method="POST", json_data=config.dict())


@router.get("/config/transcript", dependencies=[Depends(verify_api_key)])
async def get_transcript_config():
    """
    Get current transcript processing configuration.

    Returns:
    - Chunk size for text splitting
    - Overlap size between chunks
    - Custom prompt template

    **Example:**
    ```bash
    curl -X GET "http://localhost:8000/api/v1/meetily/config/transcript" \\
      -H "Authorization: Bearer boss_n8n_integration_key_2025"
    ```
    """
    logger.info("Fetching transcript configuration")
    return await proxy_to_meetily("/get-transcript-config", method="GET")


@router.post("/config/transcript", dependencies=[Depends(verify_api_key)])
async def save_transcript_config(config: SaveTranscriptConfigRequest):
    """
    Save transcript processing configuration.

    **Request Body:**
    ```json
    {
        "chunk_size": 5000,
        "overlap": 1000,
        "custom_prompt": "Generate a detailed summary..."
    }
    ```

    **Example:**
    ```bash
    curl -X POST "http://localhost:8000/api/v1/meetily/config/transcript" \\
      -H "Authorization: Bearer boss_n8n_integration_key_2025" \\
      -H "Content-Type: application/json" \\
      -d '{
        "chunk_size": 5000,
        "overlap": 1000,
        "custom_prompt": "Summarize this meeting..."
      }'
    ```
    """
    logger.info(f"Saving transcript configuration: chunk_size={config.chunk_size}")
    return await proxy_to_meetily("/save-transcript-config", method="POST", json_data=config.dict())


@router.get("/health", dependencies=[Depends(verify_api_key)])
async def health_check():
    """
    Check Meetily backend service health.

    Returns:
    - Status: healthy/unhealthy
    - Backend URL
    - Optional error message

    **Example:**
    ```bash
    curl -X GET "http://localhost:8000/api/v1/meetily/health" \\
      -H "Authorization: Bearer boss_n8n_integration_key_2025"
    ```
    """
    logger.info("Checking Meetily backend health")
    try:
        # Try to fetch meetings as health check
        await proxy_to_meetily("/get-meetings", method="GET")
        return {
            "status": "healthy",
            "backend_url": MEETILY_BACKEND_URL,
            "message": "Meetily backend is operational"
        }
    except HTTPException as e:
        return {
            "status": "unhealthy",
            "backend_url": MEETILY_BACKEND_URL,
            "error": str(e.detail)
        }
