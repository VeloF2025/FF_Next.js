"""
BOSS Embedding Client - HTTP Client for Local Embedding Service

Provides a simple interface to call the local embedding service.
Includes automatic retry, batching, and fallback support.
"""

import os
import time
from typing import Optional

import httpx
from loguru import logger

# ============================================================================
# Configuration
# ============================================================================

DEFAULT_URL = os.getenv("EMBEDDING_SERVICE_URL", "http://localhost:8001")
DEFAULT_TIMEOUT = float(os.getenv("EMBEDDING_TIMEOUT", "30"))
DEFAULT_MAX_RETRIES = int(os.getenv("EMBEDDING_MAX_RETRIES", "3"))
DEFAULT_BATCH_SIZE = int(os.getenv("EMBEDDING_BATCH_SIZE", "32"))


class EmbeddingClient:
    """
    HTTP client for the local BOSS embedding service.

    Features:
    - Automatic batching for large inputs
    - Retry logic with exponential backoff
    - Connection pooling
    - Health checking
    - Prometheus metrics integration ready

    Usage:
        client = EmbeddingClient()

        # Single text
        embedding = client.embed("Hello world")

        # Multiple texts
        embeddings = client.embed_batch(["Hello", "World"])

        # Check health
        if client.is_healthy():
            print("Service is ready")
    """

    def __init__(
        self,
        url: str = DEFAULT_URL,
        timeout: float = DEFAULT_TIMEOUT,
        max_retries: int = DEFAULT_MAX_RETRIES,
        batch_size: int = DEFAULT_BATCH_SIZE
    ):
        """
        Initialize the embedding client.

        Args:
            url: Base URL of the embedding service
            timeout: Request timeout in seconds
            max_retries: Maximum retry attempts
            batch_size: Maximum batch size for embedding requests
        """
        self.url = url.rstrip("/")
        self.timeout = timeout
        self.max_retries = max_retries
        self.batch_size = batch_size
        self._client: Optional[httpx.Client] = None
        self._dimensions: Optional[int] = None

    def _get_client(self) -> httpx.Client:
        """Get or create HTTP client."""
        if self._client is None:
            self._client = httpx.Client(
                timeout=self.timeout,
                follow_redirects=True,
                limits=httpx.Limits(max_keepalive_connections=10, max_connections=20)
            )
        return self._client

    def close(self):
        """Close the HTTP client."""
        if self._client is not None:
            self._client.close()
            self._client = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()

    def is_healthy(self) -> bool:
        """Check if the embedding service is healthy."""
        try:
            response = self._get_client().get(f"{self.url}/health")
            return response.status_code == 200
        except Exception as e:
            logger.warning(f"Health check failed: {e}")
            return False

    def get_dimensions(self) -> int:
        """Get the embedding dimensions from the service."""
        if self._dimensions is not None:
            return self._dimensions

        try:
            response = self._get_client().get(f"{self.url}/info")
            if response.status_code == 200:
                info = response.json()
                self._dimensions = info.get("dimensions", 768)
                return self._dimensions
        except Exception as e:
            logger.warning(f"Failed to get dimensions: {e}")

        # Default to bge-base-en-v1.5 dimensions
        return 768

    def embed(self, text: str, normalize: bool = True) -> list[float]:
        """
        Generate embedding for a single text.

        Args:
            text: Text to embed
            normalize: Normalize embedding to unit length

        Returns:
            Embedding vector as list of floats

        Raises:
            EmbeddingError: If embedding generation fails
        """
        embeddings = self.embed_batch([text], normalize=normalize)
        return embeddings[0]

    def embed_batch(
        self,
        texts: list[str],
        normalize: bool = True
    ) -> list[list[float]]:
        """
        Generate embeddings for multiple texts.

        Automatically batches large inputs and handles retries.

        Args:
            texts: List of texts to embed
            normalize: Normalize embeddings to unit length

        Returns:
            List of embedding vectors

        Raises:
            EmbeddingError: If embedding generation fails
        """
        if not texts:
            return []

        all_embeddings = []

        # Process in batches
        for i in range(0, len(texts), self.batch_size):
            batch = texts[i:i + self.batch_size]
            batch_embeddings = self._embed_with_retry(batch, normalize)
            all_embeddings.extend(batch_embeddings)

        return all_embeddings

    def _embed_with_retry(
        self,
        texts: list[str],
        normalize: bool = True
    ) -> list[list[float]]:
        """Embed with retry logic."""
        last_error = None

        for attempt in range(self.max_retries):
            try:
                return self._embed_request(texts, normalize)
            except Exception as e:
                last_error = e
                wait_time = 2 ** attempt  # Exponential backoff
                logger.warning(
                    f"Embedding attempt {attempt + 1}/{self.max_retries} failed: {e}. "
                    f"Retrying in {wait_time}s..."
                )
                time.sleep(wait_time)

        raise EmbeddingError(f"Embedding failed after {self.max_retries} attempts: {last_error}")

    def _embed_request(
        self,
        texts: list[str],
        normalize: bool = True
    ) -> list[list[float]]:
        """Make embedding request to service."""
        response = self._get_client().post(
            f"{self.url}/embed",
            json={
                "inputs": texts,
                "normalize": normalize
            }
        )

        if response.status_code != 200:
            raise EmbeddingError(f"Embedding request failed: {response.status_code} - {response.text}")

        data = response.json()
        return data["embeddings"]

    def embed_openai_compatible(
        self,
        texts: list[str]
    ) -> dict:
        """
        Generate embeddings using OpenAI-compatible format.

        Args:
            texts: List of texts to embed

        Returns:
            OpenAI-format response dict
        """
        response = self._get_client().post(
            f"{self.url}/v1/embeddings",
            json={
                "input": texts,
                "model": "bge-base-en-v1.5"
            }
        )

        if response.status_code != 200:
            raise EmbeddingError(f"Embedding request failed: {response.status_code} - {response.text}")

        return response.json()


class EmbeddingError(Exception):
    """Raised when embedding generation fails."""
    pass


# ============================================================================
# Convenience Functions
# ============================================================================

_default_client: Optional[EmbeddingClient] = None


def get_client() -> EmbeddingClient:
    """Get the default embedding client singleton."""
    global _default_client
    if _default_client is None:
        _default_client = EmbeddingClient()
    return _default_client


def embed(text: str) -> list[float]:
    """Generate embedding for a single text using default client."""
    return get_client().embed(text)


def embed_batch(texts: list[str]) -> list[list[float]]:
    """Generate embeddings for multiple texts using default client."""
    return get_client().embed_batch(texts)


def is_service_available() -> bool:
    """Check if the embedding service is available."""
    return get_client().is_healthy()
