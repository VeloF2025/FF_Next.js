"""
Context Enrichment API Routes

Provides endpoints for enriching email/message context using:
- RAG Engine (semantic document search)
- Memory Graph (entity relationships)

Author: BOSS Development Team
Created: 2025-11-17
"""

import logging
from typing import Dict, Any, List, Optional
from fastapi import APIRouter, HTTPException, Depends, status
from pydantic import BaseModel, Field

from api.auth import verify_api_key
from lib.rag.rag_engine import get_rag_engine
from lib.memory.graph import get_graph

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

def extract_sender_info(email_address: str) -> Optional[Dict[str, Any]]:
    """
    Extract sender information from memory graph.

    Args:
        email_address: Sender email address

    Returns:
        Sender entity dict or None
    """
    logger.debug("🔍 extract_sender_info called - VERSION 2.0")
    graph = None
    try:
        graph = get_graph()
        graph.connect()

        # Try to find person by email
        # Query memory.nodes for person with email in properties
        with graph.conn.cursor() as cursor:
            cursor.execute("""
                SELECT id, node_type, label, properties
                FROM memory.nodes
                WHERE node_type = 'person'
                AND properties->>'email' = %s
                LIMIT 1
            """, (email_address,))

            result = cursor.fetchone()

            if result:
                return {
                    "id": str(result[0]),
                    "name": result[2],
                    "entity_type": result[1],
                    "properties": result[3] or {}
                }

        return None

    except Exception as e:
        logger.error(f"Error extracting sender info: {e}")
        return None

    finally:
        if graph:
            graph.close()


def extract_entities_from_text(text: str) -> List[str]:
    """
    Extract entity names from text (simple capitalized word extraction).

    Args:
        text: Text to extract from

    Returns:
        List of potential entity names
    """
    words = text.split()
    entities = []

    for word in words:
        # Simple heuristic: capitalized words longer than 3 chars
        clean_word = word.strip(".,!?;:")
        if clean_word and len(clean_word) > 3 and clean_word[0].isupper():
            entities.append(clean_word)

    return list(set(entities))  # Remove duplicates


def find_mentioned_entities(entity_names: List[str]) -> List[Dict[str, Any]]:
    """
    Find entities in memory graph by name.

    Args:
        entity_names: List of entity names to search for

    Returns:
        List of entity dicts
    """
    if not entity_names:
        return []

    graph = None
    try:
        graph = get_graph()
        graph.connect()

        entities = []

        with graph.conn.cursor() as cursor:
            for name in entity_names:
                cursor.execute("""
                    SELECT id, node_type, label, properties
                    FROM memory.nodes
                    WHERE LOWER(label) = LOWER(%s)
                    LIMIT 1
                """, (name,))

                result = cursor.fetchone()

                if result:
                    entities.append({
                        "id": str(result[0]),
                        "name": result[2],
                        "entity_type": result[1],
                        "properties": result[3] or {}
                    })

        return entities

    except Exception as e:
        logger.error(f"Error finding mentioned entities: {e}")
        return []

    finally:
        if graph:
            graph.close()


def generate_context_summary(
    sender: Optional[Dict],
    documents: List[Dict],
    entities: List[Dict]
) -> str:
    """
    Generate human-readable context summary.

    Args:
        sender: Sender entity info
        documents: Relevant documents
        entities: Mentioned entities

    Returns:
        Context summary string
    """
    parts = []

    if sender:
        name = sender.get("name", "Unknown")
        role = sender.get("properties", {}).get("role", "")
        if role:
            parts.append(f"Email from {name} ({role}).")
        else:
            parts.append(f"Email from {name}.")

    if entities:
        entity_names = [e["name"] for e in entities[:3]]
        parts.append(f"Mentions: {', '.join(entity_names)}.")

    if documents:
        parts.append(f"Found {len(documents)} relevant documents.")

    if not parts:
        return "No additional context available."

    return " ".join(parts)


def suggest_actions(
    email: EmailContext,
    sender: Optional[Dict],
    documents: List[Dict]
) -> List[str]:
    """
    Suggest actions based on email context.

    Args:
        email: Email context
        sender: Sender info
        documents: Relevant documents

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

    if documents:
        actions.append("review_related_documents")

    if not actions:
        actions.append("standard_response")

    return actions


# ============================================================================
# API ENDPOINTS
# ============================================================================

@router.post("/enrich", response_model=EnrichContextResponse, dependencies=[Depends(verify_api_key)])
async def enrich_context(request: EnrichContextRequest) -> EnrichContextResponse:
    """
    Enrich email context using RAG and Memory Graph.

    This endpoint:
    1. Extracts sender info from memory graph
    2. Searches RAG for relevant documents
    3. Identifies mentioned entities
    4. Generates context summary and suggested actions

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
    - Sender information (name, role, relationships)
    - Relevant documents from knowledge base
    - Mentioned entities (people, projects, companies)
    - Context summary
    - Suggested actions
    """
    logger.info(f"Context enrichment request for email from: {request.email.from_address}")

    try:
        # 1. Extract sender info from memory graph
        sender_info = None
        if request.include_memory_graph:
            sender_data = extract_sender_info(request.email.from_address)
            if sender_data:
                sender_info = EntityInfo(**sender_data)

        # 2. Search RAG for relevant documents
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

        # 3. Extract and find mentioned entities
        mentioned_entities = []
        if request.include_memory_graph:
            # Extract entity names from subject + body
            text = f"{request.email.subject} {request.email.body}"
            entity_names = extract_entities_from_text(text)

            # Find entities in memory graph
            entity_data = find_mentioned_entities(entity_names)
            mentioned_entities = [EntityInfo(**e) for e in entity_data]

        # 4. Generate context summary
        context_summary = generate_context_summary(
            sender=sender_info.dict() if sender_info else None,
            documents=[d.dict() for d in relevant_documents],
            entities=[e.dict() for e in mentioned_entities]
        )

        # 5. Suggest actions
        suggested_actions = suggest_actions(
            email=request.email,
            sender=sender_info.dict() if sender_info else None,
            documents=[d.dict() for d in relevant_documents]
        )

        # 6. Calculate confidence
        confidence = 0.5  # Base confidence
        if sender_info:
            confidence += 0.2
        if relevant_documents:
            confidence += 0.2
        if mentioned_entities:
            confidence += 0.1
        confidence = min(confidence, 1.0)

        response = EnrichContextResponse(
            sender_info=sender_info,
            recipient_info=[],  # TODO: Extract recipient info
            mentioned_entities=mentioned_entities,
            relevant_documents=relevant_documents,
            context_summary=context_summary,
            suggested_actions=suggested_actions,
            confidence=confidence
        )

        logger.info(f"✅ Context enrichment complete: {len(relevant_documents)} docs, {len(mentioned_entities)} entities")

        return response

    except Exception as e:
        logger.error(f"Context enrichment failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Context enrichment failed: {str(e)}"
        )
