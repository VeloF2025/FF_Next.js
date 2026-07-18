"""
Context Enrichment API Routes - Simplified Version (RAG Only)

Provides endpoints for enriching email/message context using:
- RAG Engine (semantic document search)
- Memory Graph integration (stubbed for now)

Author: BOSS Development Team
Created: 2025-11-17
"""

import logging
from typing import Dict, Any, List, Optional
from fastapi import APIRouter, HTTPException, Depends, status
from pydantic import BaseModel, Field

from api.auth import verify_api_key
from lib.rag.rag_engine import get_rag_engine

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/context", tags=["Context Enrichment"])


# ============================================================================
# REQUEST/RESPONSE MODELS
# ============================================================================

class EmailContext(BaseModel):
    """Email context for enrichment"""
    from_address: str = Field(..., description="Sender email address")
    to_addresses: List[str] = Field(..., description="Recipient email addresses")
    subject: str = Field(..., description="Email subject")
    body: str = Field(..., description="Email body text")
    cc_addresses: Optional[List[str]] = Field(default=None, description="CC addresses")


class EnrichContextRequest(BaseModel):
    """Request model for context enrichment"""
    email: EmailContext = Field(..., description="Email to enrich")
    top_k: int = Field(default=5, description="Number of relevant documents to retrieve")
    include_memory_graph: bool = Field(default=True, description="Include memory graph entities")


class EntityInfo(BaseModel):
    """Entity information from memory graph"""
    id: str
    name: str
    entity_type: str
    properties: Dict[str, Any]


class DocumentInfo(BaseModel):
    """Relevant document information"""
    title: str
    source: str
    relevance_score: float
    excerpt: str


class EnrichContextResponse(BaseModel):
    """Response model for context enrichment"""
    sender_info: Optional[EntityInfo] = None
    recipient_info: List[EntityInfo] = []
    mentioned_entities: List[EntityInfo] = []
    relevant_documents: List[DocumentInfo] = []
    context_summary: str
    suggested_actions: List[str] = []
    confidence: float = Field(ge=0.0, le=1.0, description="Overall confidence score")


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def suggest_actions(email: EmailContext) -> List[str]:
    """
    Suggest actions based on email context.

    Args:
        email: Email context

    Returns:
        List of suggested actions
    """
    actions = []

    # Check for common action keywords
    body_lower = email.body.lower()
    subject_lower = email.subject.lower()

    if any(word in subject_lower or word in body_lower for word in ["urgent", "asap", "immediately"]):
        actions.append("high_priority_response")

    if any(word in subject_lower or word in body_lower for word in ["review", "feedback", "thoughts"]):
        actions.append("review_and_respond")

    if any(word in subject_lower or word in body_lower for word in ["meeting", "call", "schedule"]):
        actions.append("schedule_meeting")

    if any(word in subject_lower or word in body_lower for word in ["invoice", "payment", "financial"]):
        actions.append("financial_review")

    if not actions:
        actions.append("standard_response")

    return actions


# ============================================================================
# API ENDPOINTS
# ============================================================================

@router.post("/enrich", response_model=EnrichContextResponse, dependencies=[Depends(verify_api_key)])
async def enrich_context(request: EnrichContextRequest) -> EnrichContextResponse:
    """
    Enrich email context using RAG.

    This endpoint:
    1. Searches RAG for relevant documents
    2. Generates context summary and suggested actions
    3. (Memory graph integration TODO)

    **Example Request:**
    ```json
    {
        "email": {
            "from_address": "john@blitz.com",
            "to_addresses": ["boss@example.com"],
            "subject": "Q4 Financial Update",
            "body": "Hi team, please review the attached Q4 financials for Velocity Fibre..."
        },
        "top_k": 5,
        "include_memory_graph": true
    }
    ```

    **Returns:**
    - Relevant documents from knowledge base
    - Context summary
    - Suggested actions
    """
    logger.info(f"Context enrichment request for email from: {request.email.from_address}")

    try:
        # 1. Search RAG for relevant documents
        rag = get_rag_engine()

        # Build search query from subject + body
        search_query = f"{request.email.subject} {request.email.body}"

        rag_results = rag.query(
            question=search_query,
            top_k=request.top_k,
            include_context=True
        )

        # Extract document info
        relevant_documents = []
        for result in rag_results.get("results", [])[:request.top_k]:
            payload = result.get("payload", {})
            relevant_documents.append(DocumentInfo(
                title=payload.get("title", "Untitled"),
                source=payload.get("source", "Unknown"),
                relevance_score=result.get("rrf_score", 0.0),
                excerpt=payload.get("chunk_text", "")[:200] + "..."
            ))

        # 2. Generate context summary
        if relevant_documents:
            context_summary = f"Found {len(relevant_documents)} relevant documents related to: {request.email.subject}."
        else:
            context_summary = "No relevant documents found in knowledge base."

        # 3. Suggest actions
        suggested_actions = suggest_actions(email=request.email)

        # 4. Calculate confidence
        confidence = 0.5  # Base confidence
        if relevant_documents:
            confidence += 0.3
        confidence = min(confidence, 1.0)

        response = EnrichContextResponse(
            sender_info=None,  # TODO: Memory graph integration
            recipient_info=[],  # TODO: Memory graph integration
            mentioned_entities=[],  # TODO: Memory graph integration
            relevant_documents=relevant_documents,
            context_summary=context_summary,
            suggested_actions=suggested_actions,
            confidence=confidence
        )

        logger.info(f"✅ Context enrichment complete: {len(relevant_documents)} docs")

        return response

    except Exception as e:
        logger.error(f"Context enrichment failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Context enrichment failed: {str(e)}"
        )
