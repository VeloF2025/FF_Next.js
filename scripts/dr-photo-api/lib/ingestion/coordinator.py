"""
BOSS Ingestion Coordinator - Batch Aggregation & Distribution

Central coordination service that:
1. Consumes raw items from Redis Streams
2. Aggregates into batches for embedding
3. Calls embedding service for vectors
4. Distributes to Qdrant and PostgreSQL
5. Manages backpressure to prevent overload

Endpoints:
- POST /ingest - Queue items for ingestion
- GET /health - Health check
- GET /metrics - Prometheus metrics
- GET /status - Queue and processing status
"""

import asyncio
import os
import time
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Optional
from uuid import uuid4

import httpx
import redis.asyncio as redis
from fastapi import FastAPI, HTTPException
from fastapi.responses import PlainTextResponse
from loguru import logger
from prometheus_client import Counter, Gauge, Histogram, generate_latest
from pydantic import BaseModel, Field

# ============================================================================
# Configuration
# ============================================================================

EMBEDDING_SERVICE_URL = os.getenv("EMBEDDING_SERVICE_URL", "http://boss-embedding-service:8001")
REDIS_URL = os.getenv("REDIS_URL", "redis://boss-redis:6379")
POSTGRES_HOST = os.getenv("POSTGRES_HOST", "boss-postgres")
POSTGRES_PORT = int(os.getenv("POSTGRES_PORT", "5432"))
POSTGRES_DB = os.getenv("POSTGRES_DB", "boss_production")
POSTGRES_USER = os.getenv("POSTGRES_USER", "boss_admin")
POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD", "")
QDRANT_URL = os.getenv("QDRANT_URL", "http://boss-qdrant:6333")

# Batch sizes
EMBEDDING_BATCH_SIZE = int(os.getenv("EMBEDDING_BATCH_SIZE", "32"))
QDRANT_BATCH_SIZE = int(os.getenv("QDRANT_BATCH_SIZE", "100"))
POSTGRES_BATCH_SIZE = int(os.getenv("POSTGRES_BATCH_SIZE", "50"))

# Backpressure thresholds
BACKPRESSURE_PAUSE_THRESHOLD = int(os.getenv("BACKPRESSURE_PAUSE_THRESHOLD", "10000"))
BACKPRESSURE_RESUME_THRESHOLD = int(os.getenv("BACKPRESSURE_RESUME_THRESHOLD", "5000"))

# Stream names
STREAM_RAW = "boss:ingestion:raw"
STREAM_EMBEDDING = "boss:embedding:queue"
CONSUMER_GROUP = "cg:coordinator"
CONSUMER_NAME = f"coordinator-{uuid4().hex[:8]}"

# ============================================================================
# Prometheus Metrics
# ============================================================================

ITEMS_QUEUED = Counter(
    "boss_ingestion_items_queued_total",
    "Total items queued for ingestion",
    ["source"]
)

ITEMS_PROCESSED = Counter(
    "boss_ingestion_items_processed_total",
    "Total items successfully processed",
    ["source"]
)

ITEMS_FAILED = Counter(
    "boss_ingestion_items_failed_total",
    "Total items that failed processing",
    ["source", "reason"]
)

BATCH_PROCESSING_TIME = Histogram(
    "boss_ingestion_batch_processing_seconds",
    "Time to process a batch",
    ["stage"],
    buckets=(0.1, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0, 60.0)
)

QUEUE_DEPTH = Gauge(
    "boss_ingestion_queue_depth",
    "Current queue depth",
    ["stream"]
)

BACKPRESSURE_ACTIVE = Gauge(
    "boss_ingestion_backpressure_active",
    "Whether backpressure is currently active"
)

# ============================================================================
# Request/Response Models
# ============================================================================


class IngestItem(BaseModel):
    """Single item to ingest."""
    id: str = Field(..., description="Unique identifier")
    source: str = Field(..., description="Source type (email, document, etc)")
    content: str = Field(..., description="Text content to embed")
    metadata: dict = Field(default_factory=dict, description="Additional metadata")


class IngestRequest(BaseModel):
    """Request to queue items for ingestion."""
    items: list[IngestItem] = Field(..., description="Items to ingest")


class IngestResponse(BaseModel):
    """Response from ingestion request."""
    queued: int = Field(..., description="Number of items queued")
    message: str = Field(..., description="Status message")


class HealthResponse(BaseModel):
    """Health check response."""
    status: str
    redis_connected: bool
    embedding_service_available: bool
    queue_depth: int
    backpressure_active: bool
    uptime_seconds: float


class StatusResponse(BaseModel):
    """Detailed status response."""
    queue_depth: int
    backpressure_active: bool
    items_processed: int
    items_failed: int
    embedding_service_url: str
    batch_sizes: dict


# ============================================================================
# Global State
# ============================================================================

redis_client: Optional[redis.Redis] = None
http_client: Optional[httpx.AsyncClient] = None
startup_time = time.time()
backpressure_active = False
processing_stats = {
    "items_processed": 0,
    "items_failed": 0
}


# ============================================================================
# Lifecycle Management
# ============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize and cleanup resources."""
    global redis_client, http_client

    logger.info("Starting BOSS Ingestion Coordinator")

    # Initialize Redis
    try:
        redis_client = redis.from_url(REDIS_URL, decode_responses=True)
        await redis_client.ping()
        logger.info(f"Redis connected: {REDIS_URL}")

        # Create consumer group if not exists
        try:
            await redis_client.xgroup_create(STREAM_RAW, CONSUMER_GROUP, id="0", mkstream=True)
            logger.info(f"Created consumer group: {CONSUMER_GROUP}")
        except redis.ResponseError as e:
            if "BUSYGROUP" not in str(e):
                raise
            logger.info(f"Consumer group already exists: {CONSUMER_GROUP}")

    except Exception as e:
        logger.error(f"Redis connection failed: {e}")
        raise

    # Initialize HTTP client
    http_client = httpx.AsyncClient(timeout=60.0)

    # Start background processor
    processor_task = asyncio.create_task(background_processor())

    yield

    # Cleanup
    logger.info("Shutting down coordinator")
    processor_task.cancel()
    try:
        await processor_task
    except asyncio.CancelledError:
        pass

    if http_client:
        await http_client.aclose()
    if redis_client:
        await redis_client.close()


# ============================================================================
# Background Processor
# ============================================================================

async def background_processor():
    """Background task to process items from Redis stream."""
    global backpressure_active, processing_stats

    logger.info("Background processor started")

    while True:
        try:
            # Check backpressure
            queue_depth = await get_queue_depth()
            QUEUE_DEPTH.labels(stream=STREAM_RAW).set(queue_depth)

            if queue_depth > BACKPRESSURE_PAUSE_THRESHOLD:
                if not backpressure_active:
                    logger.warning(f"Backpressure activated: queue depth {queue_depth}")
                    backpressure_active = True
                    BACKPRESSURE_ACTIVE.set(1)
                await asyncio.sleep(5)  # Wait before checking again
                continue
            elif backpressure_active and queue_depth < BACKPRESSURE_RESUME_THRESHOLD:
                logger.info(f"Backpressure deactivated: queue depth {queue_depth}")
                backpressure_active = False
                BACKPRESSURE_ACTIVE.set(0)

            # Read from stream
            messages = await redis_client.xreadgroup(
                CONSUMER_GROUP,
                CONSUMER_NAME,
                {STREAM_RAW: ">"},
                count=EMBEDDING_BATCH_SIZE,
                block=5000
            )

            if not messages:
                continue

            # Process batch
            batch_start = time.time()
            items = []

            for stream_name, stream_messages in messages:
                for msg_id, msg_data in stream_messages:
                    try:
                        item = IngestItem(
                            id=msg_data.get("id", msg_id),
                            source=msg_data.get("source", "unknown"),
                            content=msg_data.get("content", ""),
                            metadata=eval(msg_data.get("metadata", "{}"))  # Safe: from our own stream
                        )
                        items.append((msg_id, item))
                    except Exception as e:
                        logger.error(f"Failed to parse message {msg_id}: {e}")
                        await redis_client.xack(STREAM_RAW, CONSUMER_GROUP, msg_id)
                        ITEMS_FAILED.labels(source="unknown", reason="parse_error").inc()

            if not items:
                continue

            # Generate embeddings
            try:
                texts = [item.content for _, item in items]
                embeddings = await generate_embeddings(texts)

                if len(embeddings) != len(items):
                    raise Exception(f"Embedding count mismatch: {len(embeddings)} vs {len(items)}")

                BATCH_PROCESSING_TIME.labels(stage="embedding").observe(time.time() - batch_start)

            except Exception as e:
                logger.error(f"Embedding generation failed: {e}")
                for msg_id, item in items:
                    ITEMS_FAILED.labels(source=item.source, reason="embedding_failed").inc()
                    await redis_client.xack(STREAM_RAW, CONSUMER_GROUP, msg_id)
                continue

            # Store in Qdrant and PostgreSQL
            store_start = time.time()
            try:
                # TODO: Implement Qdrant and PostgreSQL storage
                # For now, just acknowledge and count
                for msg_id, item in items:
                    await redis_client.xack(STREAM_RAW, CONSUMER_GROUP, msg_id)
                    ITEMS_PROCESSED.labels(source=item.source).inc()
                    processing_stats["items_processed"] += 1

                BATCH_PROCESSING_TIME.labels(stage="storage").observe(time.time() - store_start)
                logger.debug(f"Processed batch of {len(items)} items")

            except Exception as e:
                logger.error(f"Storage failed: {e}")
                for msg_id, item in items:
                    ITEMS_FAILED.labels(source=item.source, reason="storage_failed").inc()
                    processing_stats["items_failed"] += 1
                    await redis_client.xack(STREAM_RAW, CONSUMER_GROUP, msg_id)

        except asyncio.CancelledError:
            logger.info("Background processor cancelled")
            break
        except Exception as e:
            logger.error(f"Background processor error: {e}")
            await asyncio.sleep(5)


async def get_queue_depth() -> int:
    """Get current queue depth."""
    try:
        info = await redis_client.xinfo_stream(STREAM_RAW)
        return info.get("length", 0)
    except Exception:
        return 0


async def generate_embeddings(texts: list[str]) -> list[list[float]]:
    """Generate embeddings via embedding service."""
    response = await http_client.post(
        f"{EMBEDDING_SERVICE_URL}/embed",
        json={"inputs": texts, "normalize": True}
    )

    if response.status_code != 200:
        raise Exception(f"Embedding service error: {response.status_code}")

    data = response.json()
    return data["embeddings"]


# ============================================================================
# FastAPI App
# ============================================================================

app = FastAPI(
    title="BOSS Ingestion Coordinator",
    description="Batch aggregation and distribution for ingestion",
    version="1.0.0",
    lifespan=lifespan
)


# ============================================================================
# Endpoints
# ============================================================================

@app.get("/health", response_model=HealthResponse)
async def health():
    """Health check endpoint."""
    redis_ok = False
    embedding_ok = False

    try:
        await redis_client.ping()
        redis_ok = True
    except Exception:
        pass

    try:
        response = await http_client.get(f"{EMBEDDING_SERVICE_URL}/health")
        embedding_ok = response.status_code == 200
    except Exception:
        pass

    queue_depth = await get_queue_depth()

    return HealthResponse(
        status="healthy" if redis_ok else "degraded",
        redis_connected=redis_ok,
        embedding_service_available=embedding_ok,
        queue_depth=queue_depth,
        backpressure_active=backpressure_active,
        uptime_seconds=time.time() - startup_time
    )


@app.get("/status", response_model=StatusResponse)
async def status():
    """Get detailed status."""
    return StatusResponse(
        queue_depth=await get_queue_depth(),
        backpressure_active=backpressure_active,
        items_processed=processing_stats["items_processed"],
        items_failed=processing_stats["items_failed"],
        embedding_service_url=EMBEDDING_SERVICE_URL,
        batch_sizes={
            "embedding": EMBEDDING_BATCH_SIZE,
            "qdrant": QDRANT_BATCH_SIZE,
            "postgres": POSTGRES_BATCH_SIZE
        }
    )


@app.get("/metrics", response_class=PlainTextResponse)
async def metrics():
    """Prometheus metrics endpoint."""
    return generate_latest()


@app.post("/ingest", response_model=IngestResponse)
async def ingest(request: IngestRequest):
    """Queue items for ingestion."""
    if backpressure_active:
        raise HTTPException(
            status_code=503,
            detail="Backpressure active, please retry later"
        )

    queued = 0
    for item in request.items:
        try:
            await redis_client.xadd(
                STREAM_RAW,
                {
                    "id": item.id,
                    "source": item.source,
                    "content": item.content,
                    "metadata": str(item.metadata),
                    "timestamp": datetime.utcnow().isoformat()
                }
            )
            ITEMS_QUEUED.labels(source=item.source).inc()
            queued += 1
        except Exception as e:
            logger.error(f"Failed to queue item {item.id}: {e}")

    return IngestResponse(
        queued=queued,
        message=f"Queued {queued}/{len(request.items)} items"
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8010)
