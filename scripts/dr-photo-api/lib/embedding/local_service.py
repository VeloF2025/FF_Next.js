"""
BOSS Local Embedding Service - FastAPI Server

GPU-accelerated embedding generation using BAAI/bge-base-en-v1.5.
Provides OpenAI-compatible API for seamless integration.

Model Details:
- Name: BAAI/bge-base-en-v1.5
- Dimensions: 768
- Size: ~440MB
- Throughput: ~1000 embeddings/sec with batching

Endpoints:
- POST /embed - Generate embeddings
- POST /v1/embeddings - OpenAI-compatible endpoint
- GET /health - Health check
- GET /metrics - Prometheus metrics
"""

import os
import time
from contextlib import asynccontextmanager
from typing import Optional

import numpy as np
import torch
from fastapi import FastAPI, HTTPException
from fastapi.responses import PlainTextResponse
from loguru import logger
from prometheus_client import Counter, Histogram, generate_latest
from pydantic import BaseModel, Field
from sentence_transformers import SentenceTransformer

# ============================================================================
# Configuration
# ============================================================================

MODEL_NAME = os.getenv("EMBEDDING_MODEL", "BAAI/bge-base-en-v1.5")
CACHE_DIR = os.getenv("TRANSFORMERS_CACHE", "/app/cache/transformers")
MAX_BATCH_SIZE = int(os.getenv("MAX_BATCH_SIZE", "32"))

# Auto-detect device (prefer CUDA if available, fallback to CPU)
def _get_device():
    if torch.cuda.is_available():
        return "cuda"
    # Check for MPS (Apple Silicon)
    if hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
        return "mps"
    return "cpu"

DEVICE = os.getenv("EMBEDDING_DEVICE", _get_device())

# ============================================================================
# Prometheus Metrics
# ============================================================================

EMBEDDINGS_GENERATED = Counter(
    "boss_embeddings_generated_total",
    "Total number of embeddings generated",
    ["model"]
)

EMBEDDING_LATENCY = Histogram(
    "boss_embedding_latency_seconds",
    "Time spent generating embeddings",
    ["model", "batch_size_bucket"],
    buckets=(0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0)
)

BATCH_SIZE_HISTOGRAM = Histogram(
    "boss_embedding_batch_size",
    "Distribution of batch sizes",
    ["model"],
    buckets=(1, 2, 4, 8, 16, 32, 64, 128)
)

# ============================================================================
# Global Model Instance
# ============================================================================

model: Optional[SentenceTransformer] = None
model_info: dict = {}


def get_batch_size_bucket(size: int) -> str:
    """Get bucket label for batch size."""
    if size <= 1:
        return "1"
    elif size <= 4:
        return "2-4"
    elif size <= 8:
        return "5-8"
    elif size <= 16:
        return "9-16"
    elif size <= 32:
        return "17-32"
    else:
        return "33+"


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load model on startup."""
    global model, model_info

    logger.info(f"Loading embedding model: {MODEL_NAME}")
    logger.info(f"Using device: {DEVICE}")
    logger.info(f"Max batch size: {MAX_BATCH_SIZE}")

    try:
        # Load model
        model = SentenceTransformer(MODEL_NAME, cache_folder=CACHE_DIR, device=DEVICE)

        # Get model dimensions
        test_embedding = model.encode("test", convert_to_numpy=True)
        dimensions = len(test_embedding)

        model_info = {
            "name": MODEL_NAME,
            "dimensions": dimensions,
            "device": DEVICE,
            "max_batch_size": MAX_BATCH_SIZE,
            "loaded_at": time.strftime("%Y-%m-%d %H:%M:%S")
        }

        logger.info(f"Model loaded successfully: {dimensions}d embeddings on {DEVICE}")

        # Warmup with a few test embeddings
        logger.info("Warming up model...")
        _ = model.encode(["warmup text " + str(i) for i in range(8)], convert_to_numpy=True)
        logger.info("Model warmup complete")

    except Exception as e:
        logger.error(f"Failed to load model: {e}")
        raise

    yield

    # Cleanup
    logger.info("Shutting down embedding service")
    model = None


# ============================================================================
# FastAPI App
# ============================================================================

app = FastAPI(
    title="BOSS Embedding Service",
    description="Local GPU-accelerated embedding generation",
    version="1.0.0",
    lifespan=lifespan
)

# ============================================================================
# Request/Response Models
# ============================================================================


class EmbedRequest(BaseModel):
    """Request model for embedding generation."""
    inputs: str | list[str] = Field(..., description="Text or list of texts to embed")
    normalize: bool = Field(default=True, description="Normalize embeddings to unit length")


class EmbedResponse(BaseModel):
    """Response model for embedding generation."""
    embeddings: list[list[float]] = Field(..., description="Generated embeddings")
    model: str = Field(..., description="Model used")
    dimensions: int = Field(..., description="Embedding dimensions")
    count: int = Field(..., description="Number of embeddings generated")
    latency_ms: float = Field(..., description="Processing time in milliseconds")


class OpenAIEmbedRequest(BaseModel):
    """OpenAI-compatible embedding request."""
    input: str | list[str] = Field(..., description="Text or list of texts to embed")
    model: str = Field(default="bge-base-en-v1.5", description="Model name (ignored)")
    encoding_format: str = Field(default="float", description="Output format")


class OpenAIEmbedResponse(BaseModel):
    """OpenAI-compatible embedding response."""
    object: str = "list"
    data: list[dict] = Field(..., description="Embedding objects")
    model: str = Field(..., description="Model used")
    usage: dict = Field(..., description="Token usage (approximate)")


class HealthResponse(BaseModel):
    """Health check response."""
    status: str
    model: str
    dimensions: int
    device: str
    uptime_seconds: float


# ============================================================================
# Endpoints
# ============================================================================

startup_time = time.time()


@app.get("/health", response_model=HealthResponse)
async def health():
    """Health check endpoint."""
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    return HealthResponse(
        status="healthy",
        model=model_info.get("name", "unknown"),
        dimensions=model_info.get("dimensions", 0),
        device=model_info.get("device", "unknown"),
        uptime_seconds=time.time() - startup_time
    )


@app.get("/info")
async def info():
    """Get model information."""
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    return model_info


@app.get("/metrics", response_class=PlainTextResponse)
async def metrics():
    """Prometheus metrics endpoint."""
    return generate_latest()


@app.post("/embed", response_model=EmbedResponse)
async def embed(request: EmbedRequest):
    """
    Generate embeddings for text input.

    Supports both single text strings and lists of texts.
    Batches are processed efficiently on GPU.
    """
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    start_time = time.time()

    # Normalize input to list
    texts = request.inputs if isinstance(request.inputs, list) else [request.inputs]

    if not texts:
        raise HTTPException(status_code=400, detail="No input texts provided")

    if len(texts) > MAX_BATCH_SIZE * 4:
        raise HTTPException(
            status_code=400,
            detail=f"Too many inputs ({len(texts)}). Maximum is {MAX_BATCH_SIZE * 4}"
        )

    try:
        # Generate embeddings with batching
        embeddings = model.encode(
            texts,
            batch_size=MAX_BATCH_SIZE,
            normalize_embeddings=request.normalize,
            convert_to_numpy=True,
            show_progress_bar=False
        )

        # Convert to list format
        if isinstance(embeddings, np.ndarray):
            embeddings_list = embeddings.tolist()
        else:
            embeddings_list = [e.tolist() for e in embeddings]

        latency_ms = (time.time() - start_time) * 1000

        # Update metrics
        EMBEDDINGS_GENERATED.labels(model=MODEL_NAME).inc(len(texts))
        EMBEDDING_LATENCY.labels(
            model=MODEL_NAME,
            batch_size_bucket=get_batch_size_bucket(len(texts))
        ).observe(latency_ms / 1000)
        BATCH_SIZE_HISTOGRAM.labels(model=MODEL_NAME).observe(len(texts))

        return EmbedResponse(
            embeddings=embeddings_list,
            model=MODEL_NAME,
            dimensions=model_info.get("dimensions", 768),
            count=len(texts),
            latency_ms=round(latency_ms, 2)
        )

    except Exception as e:
        logger.error(f"Embedding generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/v1/embeddings", response_model=OpenAIEmbedResponse)
async def openai_embed(request: OpenAIEmbedRequest):
    """
    OpenAI-compatible embedding endpoint.

    Provides drop-in compatibility with OpenAI embedding API format.
    """
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    start_time = time.time()

    # Normalize input to list
    texts = request.input if isinstance(request.input, list) else [request.input]

    if not texts:
        raise HTTPException(status_code=400, detail="No input texts provided")

    try:
        # Generate embeddings
        embeddings = model.encode(
            texts,
            batch_size=MAX_BATCH_SIZE,
            normalize_embeddings=True,
            convert_to_numpy=True,
            show_progress_bar=False
        )

        # Convert to OpenAI format
        data = []
        for i, emb in enumerate(embeddings):
            data.append({
                "object": "embedding",
                "index": i,
                "embedding": emb.tolist() if isinstance(emb, np.ndarray) else emb
            })

        # Approximate token count (rough estimate)
        total_chars = sum(len(t) for t in texts)
        approx_tokens = total_chars // 4

        latency_ms = (time.time() - start_time) * 1000

        # Update metrics
        EMBEDDINGS_GENERATED.labels(model=MODEL_NAME).inc(len(texts))
        EMBEDDING_LATENCY.labels(
            model=MODEL_NAME,
            batch_size_bucket=get_batch_size_bucket(len(texts))
        ).observe(latency_ms / 1000)

        return OpenAIEmbedResponse(
            object="list",
            data=data,
            model=MODEL_NAME,
            usage={
                "prompt_tokens": approx_tokens,
                "total_tokens": approx_tokens
            }
        )

    except Exception as e:
        logger.error(f"Embedding generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
