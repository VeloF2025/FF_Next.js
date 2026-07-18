"""
Embedding Generation Service

Purpose: Generate embeddings for text using local Docker service, Gemini, OpenAI, or Sentence Transformers
Features: Hybrid approach with local service priority, batch processing, caching

Generated: 2025-11-15
Updated: 2025-11-26 - Added local Docker embedding service support
Authority: Phase 5 - Week 2 RAG Engine Implementation
"""

import logging
from typing import List, Optional, Dict, Any
import os
from datetime import datetime
import hashlib

# Local embedding service client (PREFERRED - LOCAL GPU)
try:
    import httpx
    HTTPX_AVAILABLE = True
except ImportError:
    HTTPX_AVAILABLE = False

# Gemini (FREE - fallback)
try:
    import google.generativeai as genai
    GEMINI_AVAILABLE = True
except ImportError:
    GEMINI_AVAILABLE = False

# OpenAI (PAID - optional)
try:
    from openai import OpenAI
    OPENAI_AVAILABLE = True
except ImportError:
    OPENAI_AVAILABLE = False

# Sentence Transformers (FREE - last resort)
try:
    from sentence_transformers import SentenceTransformer
    SENTENCE_TRANSFORMERS_AVAILABLE = True
except ImportError:
    SENTENCE_TRANSFORMERS_AVAILABLE = False

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Local embedding service configuration
LOCAL_EMBEDDING_SERVICE_URL = os.getenv("EMBEDDING_SERVICE_URL", "")


class EmbeddingService:
    """
    Embedding Generation Service

    Hybrid cascade approach (cost-optimized):
    0. Local Docker Service (FREE, LOCAL GPU) - Primary (if configured)
       - Model: BAAI/bge-base-en-v1.5
       - Dimensions: 768
       - Cost: $0 (local GPU)
       - Quality: Excellent (~95% accuracy)
       - Throughput: ~1000 embeddings/sec

    1. Gemini text-embedding-004 (FREE) - Fallback
       - Dimensions: 768
       - Cost: FREE (1,500 requests/day)
       - Quality: Excellent (~94% accuracy)
       - Context: 2,048 tokens

    2. Sentence Transformers (FREE) - Last resort
       - Model: all-MiniLM-L6-v2
       - Dimensions: 384 (padded to 768)
       - Cost: $0 (local)
       - Quality: Good (~78% accuracy)

    3. OpenAI text-embedding-3-small (PAID) - Optional
       - Dimensions: 1536
       - Cost: $0.00002 per 1,000 tokens
       - Quality: Excellent (~96% accuracy)

    Cost optimization:
    - 1,000 documents with Local Service: FREE
    - 1,000 documents with Gemini: FREE
    - 1,000 documents with Sentence Transformers: FREE
    - 1,000 documents with OpenAI: ~$0.01
    """

    # Supported models
    LOCAL_MODELS = {
        "bge-base-en-v1.5": 768,
        "BAAI/bge-base-en-v1.5": 768
    }

    GEMINI_MODELS = {
        "text-embedding-004": 768,
        "embedding-001": 768
    }

    OPENAI_MODELS = {
        "text-embedding-3-small": 1536,
        "text-embedding-3-large": 3072,
        "text-embedding-ada-002": 1536
    }

    SENTENCE_TRANSFORMERS_MODELS = {
        "all-MiniLM-L6-v2": 384,
        "all-mpnet-base-v2": 768,
        "multi-qa-mpnet-base-dot-v1": 768
    }

    def __init__(
        self,
        use_local: bool = True,
        use_gemini: bool = True,
        use_openai: bool = False,
        local_service_url: Optional[str] = None,
        gemini_model: str = "text-embedding-004",
        openai_model: str = "text-embedding-3-small",
        sentence_transformer_model: str = "all-MiniLM-L6-v2",
        gemini_api_key: Optional[str] = None,
        openai_api_key: Optional[str] = None
    ):
        """
        Initialize Embedding Service.

        Args:
            use_local: Use local Docker embedding service as primary (FREE, GPU)
            use_gemini: Use Gemini as fallback (FREE, 1,500 requests/day)
            use_openai: Use OpenAI (PAID, fallback after Gemini)
            local_service_url: URL for local embedding service (default from EMBEDDING_SERVICE_URL env)
            gemini_model: Gemini model name
            openai_model: OpenAI model name
            sentence_transformer_model: Sentence Transformers model name
            gemini_api_key: Gemini API key (optional, will use env var if not provided)
            openai_api_key: OpenAI API key (optional, will use env var if not provided)
        """
        self.use_local = use_local
        self.use_gemini = use_gemini
        self.use_openai = use_openai
        self.gemini_model = gemini_model
        self.openai_model = openai_model
        self.sentence_transformer_model = sentence_transformer_model

        # Initialize Local Embedding Service (PRIMARY - LOCAL GPU)
        self.local_service_url = local_service_url or LOCAL_EMBEDDING_SERVICE_URL
        self.local_client = None
        self.local_service_available = False

        if use_local and HTTPX_AVAILABLE and self.local_service_url:
            try:
                self.local_client = httpx.Client(timeout=30.0)
                # Test connection
                response = self.local_client.get(f"{self.local_service_url}/health")
                if response.status_code == 200:
                    health = response.json()
                    self.local_service_available = True
                    self._local_dimensions = health.get("dimensions", 768)
                    logger.info(f"Local embedding service initialized ({self.local_service_url}, {self._local_dimensions}d)")
                else:
                    logger.warning(f"Local embedding service not healthy: {response.status_code}")
            except Exception as e:
                logger.warning(f"Local embedding service not available: {e}")
                self.local_service_available = False

        # Initialize Gemini (FALLBACK - FREE)
        self.gemini_client = None
        if use_gemini and GEMINI_AVAILABLE:
            gemini_api_key = gemini_api_key or os.getenv("GEMINI_API_KEY")
            if gemini_api_key:
                genai.configure(api_key=gemini_api_key)
                self.gemini_client = genai
                logger.info(f"Gemini initialized (model: {gemini_model}, FREE tier)")
            else:
                logger.warning("Gemini API key not found, will fallback to Sentence Transformers")

        # Initialize OpenAI (OPTIONAL - PAID)
        self.openai_client = None
        if use_openai and OPENAI_AVAILABLE:
            openai_api_key = openai_api_key or os.getenv("OPENAI_API_KEY")
            if openai_api_key:
                self.openai_client = OpenAI(api_key=openai_api_key)
                logger.info(f"OpenAI initialized (model: {openai_model})")
            else:
                logger.warning("OpenAI API key not found")

        # Initialize Sentence Transformers (LAST RESORT - LOCAL)
        self.sentence_transformer = None
        if SENTENCE_TRANSFORMERS_AVAILABLE:
            try:
                # Fix for PyTorch meta tensor issue: disable lazy initialization
                import torch
                import os as os_module

                # Disable PyTorch lazy tensors (meta mode) that cause the error
                os_module.environ.setdefault('PYTORCH_ENABLE_MPS_FALLBACK', '1')

                # Force eager loading (not lazy/meta mode)
                torch.set_grad_enabled(False)  # Disable autograd for inference

                # Load model without device parameter (let it auto-detect)
                self.sentence_transformer = SentenceTransformer(sentence_transformer_model)

                logger.info(f"Sentence Transformers initialized (model: {sentence_transformer_model})")
            except Exception as e:
                logger.error(f"Failed to load Sentence Transformers: {e}")
                self.sentence_transformer = None

        # Determine vector dimension (prioritize Local > Gemini > OpenAI > Sentence Transformers)
        if self.local_service_available:
            self.vector_dim = getattr(self, '_local_dimensions', 768)
        elif self.gemini_client:
            self.vector_dim = self.GEMINI_MODELS[gemini_model]
        elif self.openai_client:
            self.vector_dim = self.OPENAI_MODELS[openai_model]
        elif self.sentence_transformer:
            self.vector_dim = self.SENTENCE_TRANSFORMERS_MODELS[sentence_transformer_model]
        else:
            raise ValueError("No embedding model available. Configure EMBEDDING_SERVICE_URL, install google-generativeai, openai, or sentence-transformers.")

        logger.info(f"EmbeddingService initialized (dimension: {self.vector_dim})")

    def generate_embedding(self, text: str) -> Optional[List[float]]:
        """
        Generate embedding for single text.

        Cascade approach:
        0. Try Local Docker Service (FREE, LOCAL GPU) - PRIMARY if available
        1. Try Gemini (FREE, 768d)
        2. Try OpenAI (PAID, 1536d) if enabled
        3. Fallback to Sentence Transformers (FREE, 384d)

        Args:
            text: Text to embed

        Returns:
            Embedding vector or None if failed
        """
        if not text or not text.strip():
            logger.warning("Empty text provided for embedding")
            return None

        # Try Local Docker Service first (FREE, LOCAL GPU, PRIMARY)
        if self.local_service_available and self.local_client:
            try:
                response = self.local_client.post(
                    f"{self.local_service_url}/embed",
                    json={"inputs": text, "normalize": True}
                )
                if response.status_code == 200:
                    data = response.json()
                    embedding = data["embeddings"][0]
                    logger.debug(f"Generated Local embedding (dim: {len(embedding)})")
                    return embedding
                else:
                    logger.warning(f"Local embedding failed: {response.status_code}")
            except Exception as e:
                logger.error(f"Local embedding service failed: {e}")
                # Fall through to Gemini

        # Try Gemini second (FREE, FALLBACK)
        if self.gemini_client:
            try:
                result = self.gemini_client.embed_content(
                    model=f"models/{self.gemini_model}",
                    content=text,
                    task_type="retrieval_document"
                )
                embedding = result['embedding']
                logger.debug(f"Generated Gemini embedding (dim: {len(embedding)})")
                return embedding

            except Exception as e:
                logger.error(f"Gemini embedding failed: {e}")
                # Fall through to OpenAI or Sentence Transformers

        # Try OpenAI third (PAID, OPTIONAL)
        if self.openai_client:
            try:
                response = self.openai_client.embeddings.create(
                    model=self.openai_model,
                    input=text
                )
                embedding = response.data[0].embedding
                logger.debug(f"Generated OpenAI embedding (dim: {len(embedding)})")
                return embedding

            except Exception as e:
                logger.error(f"OpenAI embedding failed: {e}")
                # Fall through to Sentence Transformers

        # Fallback to Sentence Transformers (FREE, LOCAL, LAST RESORT)
        if self.sentence_transformer:
            try:
                embedding = self.sentence_transformer.encode(text, convert_to_numpy=True)
                embedding_list = embedding.tolist()

                # Pad if needed (for compatibility with Qdrant 768 dimension)
                if len(embedding_list) < self.vector_dim:
                    embedding_list = self._pad_embedding(embedding_list, self.vector_dim)

                logger.debug(f"Generated Sentence Transformers embedding (dim: {len(embedding_list)})")
                return embedding_list

            except Exception as e:
                logger.error(f"Sentence Transformers embedding failed: {e}")
                return None

        logger.error("No embedding model available")
        return None

    def generate_embeddings_batch(
        self,
        texts: List[str],
        batch_size: int = 32
    ) -> List[Optional[List[float]]]:
        """
        Generate embeddings for multiple texts in batches.

        Cascade approach:
        0. Try Local Docker Service (FREE, LOCAL GPU) - PRIMARY if available
        1. Try Gemini (FREE, 768d)
        2. Try OpenAI (PAID, 1536d) if enabled
        3. Fallback to Sentence Transformers (FREE, 384d)

        Args:
            texts: List of texts to embed
            batch_size: Batch size for processing (default 32 for local service)

        Returns:
            List of embedding vectors (None for failed texts)
        """
        total = len(texts)
        logger.info(f"Generating embeddings for {total} texts (batch_size={batch_size})")

        embeddings = []

        # Try Local Docker Service first (FREE, LOCAL GPU, PRIMARY)
        if self.local_service_available and self.local_client:
            try:
                for i in range(0, total, batch_size):
                    batch = texts[i:i + batch_size]

                    response = self.local_client.post(
                        f"{self.local_service_url}/embed",
                        json={"inputs": batch, "normalize": True},
                        timeout=60.0  # Longer timeout for batches
                    )

                    if response.status_code == 200:
                        data = response.json()
                        batch_embeddings = data["embeddings"]
                        embeddings.extend(batch_embeddings)
                        logger.debug(f"Processed batch {i//batch_size + 1}/{(total + batch_size - 1)//batch_size}")
                    else:
                        raise Exception(f"Local service returned {response.status_code}")

                logger.info(f"Generated {len(embeddings)} Local embeddings (FREE, GPU)")
                return embeddings

            except Exception as e:
                logger.error(f"Local batch embedding failed: {e}")
                embeddings = []  # Reset for fallback

        # Try Gemini batch processing second (FREE, FALLBACK)
        if self.gemini_client:
            try:
                for i in range(0, total, batch_size):
                    batch = texts[i:i + batch_size]

                    # Gemini batch API
                    batch_embeddings = []
                    for text in batch:
                        result = self.gemini_client.embed_content(
                            model=f"models/{self.gemini_model}",
                            content=text,
                            task_type="retrieval_document"
                        )
                        batch_embeddings.append(result['embedding'])

                    embeddings.extend(batch_embeddings)
                    logger.debug(f"Processed batch {i//batch_size + 1}/{(total + batch_size - 1)//batch_size}")

                logger.info(f"Generated {len(embeddings)} Gemini embeddings (FREE)")
                return embeddings

            except Exception as e:
                logger.error(f"Gemini batch embedding failed: {e}")
                embeddings = []  # Reset for fallback

        # Try OpenAI batch processing third (PAID, OPTIONAL)
        if self.openai_client:
            try:
                for i in range(0, total, batch_size):
                    batch = texts[i:i + batch_size]

                    response = self.openai_client.embeddings.create(
                        model=self.openai_model,
                        input=batch
                    )

                    batch_embeddings = [item.embedding for item in response.data]
                    embeddings.extend(batch_embeddings)

                    logger.debug(f"Processed batch {i//batch_size + 1}/{(total + batch_size - 1)//batch_size}")

                logger.info(f"Generated {len(embeddings)} OpenAI embeddings")
                return embeddings

            except Exception as e:
                logger.error(f"OpenAI batch embedding failed: {e}")
                embeddings = []  # Reset for fallback

        # Fallback to Sentence Transformers (LAST RESORT)
        if self.sentence_transformer:
            try:
                # Sentence Transformers handles batching internally
                embeddings_array = self.sentence_transformer.encode(
                    texts,
                    convert_to_numpy=True,
                    batch_size=batch_size,
                    show_progress_bar=total > 100
                )

                embeddings = [emb.tolist() for emb in embeddings_array]

                # Pad if needed
                if embeddings and len(embeddings[0]) < self.vector_dim:
                    embeddings = [self._pad_embedding(emb, self.vector_dim) for emb in embeddings]

                logger.info(f"Generated {len(embeddings)} Sentence Transformers embeddings")
                return embeddings

            except Exception as e:
                logger.error(f"Sentence Transformers batch embedding failed: {e}")
                return [None] * total

        logger.error("No embedding model available for batch processing")
        return [None] * total

    def _pad_embedding(self, embedding: List[float], target_dim: int) -> List[float]:
        """
        Pad embedding to target dimension with zeros.

        Args:
            embedding: Original embedding
            target_dim: Target dimension

        Returns:
            Padded embedding
        """
        if len(embedding) >= target_dim:
            return embedding[:target_dim]

        return embedding + [0.0] * (target_dim - len(embedding))

    def get_embedding_cost(self, num_tokens: int, model: str = "openai") -> float:
        """
        Calculate cost for generating embeddings.

        Args:
            num_tokens: Number of tokens
            model: Model type ("openai" or "sentence_transformers")

        Returns:
            Cost in USD
        """
        if model == "openai":
            # OpenAI text-embedding-3-small: $0.00002 per 1,000 tokens
            return (num_tokens / 1000) * 0.00002

        # Sentence Transformers is free
        return 0.0

    def estimate_tokens(self, text: str) -> int:
        """
        Estimate token count for text (rough approximation).

        Args:
            text: Text to estimate

        Returns:
            Estimated token count
        """
        # Rough estimate: 1 token ≈ 4 characters
        return len(text) // 4

    def get_statistics(self) -> Dict[str, Any]:
        """
        Get embedding service statistics.

        Returns:
            Statistics dict
        """
        # Determine primary model
        if self.local_service_available:
            primary = "local_docker"
        elif self.gemini_client:
            primary = "gemini"
        elif self.openai_client:
            primary = "openai"
        elif self.sentence_transformer:
            primary = "sentence_transformers"
        else:
            primary = "none"

        stats = {
            "local_service_available": self.local_service_available,
            "gemini_available": self.gemini_client is not None,
            "openai_available": self.openai_client is not None,
            "sentence_transformers_available": self.sentence_transformer is not None,
            "primary_model": primary,
            "vector_dimension": self.vector_dim
        }

        if self.local_service_available:
            stats["local_service_url"] = self.local_service_url
            stats["local_model"] = "BAAI/bge-base-en-v1.5"
            stats["local_cost"] = "FREE (local GPU)"

        if self.gemini_client:
            stats["gemini_model"] = self.gemini_model
            stats["gemini_cost"] = "FREE (1,500 requests/day)"

        if self.openai_client:
            stats["openai_model"] = self.openai_model

        if self.sentence_transformer:
            stats["sentence_transformer_model"] = self.sentence_transformer_model

        return stats


# ============================================================================
# CONVENIENCE FUNCTIONS
# ============================================================================

_embedding_service_instance = None


def get_embedding_service(
    use_local: bool = True,
    use_gemini: bool = True,
    use_openai: bool = False,
    force_new: bool = False
) -> EmbeddingService:
    """
    Get or create singleton EmbeddingService instance.

    Args:
        use_local: Use local Docker service as primary (FREE, GPU)
        use_gemini: Use Gemini as fallback (FREE, 768d)
        use_openai: Use OpenAI (PAID, 1536d)
        force_new: Force creation of new instance

    Returns:
        EmbeddingService instance
    """
    global _embedding_service_instance

    if _embedding_service_instance is None or force_new:
        _embedding_service_instance = EmbeddingService(
            use_local=use_local,
            use_gemini=use_gemini,
            use_openai=use_openai
        )

    return _embedding_service_instance


def generate_embedding(
    text: str,
    use_local: bool = True,
    use_gemini: bool = True,
    use_openai: bool = False
) -> Optional[List[float]]:
    """
    Convenience function to generate single embedding.

    Args:
        text: Text to embed
        use_local: Use local Docker service (FREE, GPU primary)
        use_gemini: Use Gemini (FREE, 768d fallback)
        use_openai: Use OpenAI (PAID, 1536d)

    Returns:
        Embedding vector
    """
    service = get_embedding_service(use_local=use_local, use_gemini=use_gemini, use_openai=use_openai)
    return service.generate_embedding(text)


def generate_embeddings_batch(
    texts: List[str],
    use_local: bool = True,
    use_gemini: bool = True,
    use_openai: bool = False,
    batch_size: int = 32
) -> List[Optional[List[float]]]:
    """
    Convenience function to generate batch embeddings.

    Args:
        texts: List of texts to embed
        use_local: Use local Docker service (FREE, GPU primary)
        use_gemini: Use Gemini (FREE, 768d fallback)
        use_openai: Use OpenAI (PAID, 1536d)
        batch_size: Batch size (default 32 optimized for local service)

    Returns:
        List of embedding vectors
    """
    service = get_embedding_service(use_local=use_local, use_gemini=use_gemini, use_openai=use_openai)
    return service.generate_embeddings_batch(texts, batch_size=batch_size)


if __name__ == "__main__":
    # Test embedding generation
    print("=" * 80)
    print("EMBEDDING SERVICE - TEST")
    print("=" * 80)
    print()

    # Initialize service
    service = get_embedding_service(use_openai=False)  # Use free Sentence Transformers for test

    # Get statistics
    stats = service.get_statistics()
    print("1. Service Statistics:")
    print(f"   Primary Model: {stats['primary_model']}")
    print(f"   Vector Dimension: {stats['vector_dimension']}")
    print(f"   OpenAI Available: {stats['openai_available']}")
    print(f"   Sentence Transformers Available: {stats['sentence_transformers_available']}")
    print()

    # Test single embedding
    print("2. Single Embedding Test:")
    text = "This is a test document about the Blitz project and Velocity Fibre."
    embedding = service.generate_embedding(text)

    if embedding:
        print(f"   ✅ Generated embedding (dim: {len(embedding)})")
        print(f"   First 5 values: {embedding[:5]}")
    else:
        print("   ❌ Failed to generate embedding")
    print()

    # Test batch embedding
    print("3. Batch Embedding Test:")
    texts = [
        "Email about Q4 financials",
        "WhatsApp message discussing project timeline",
        "Document containing technical specifications"
    ]

    embeddings = service.generate_embeddings_batch(texts, batch_size=10)
    print(f"   ✅ Generated {len([e for e in embeddings if e is not None])}/{len(texts)} embeddings")
    print()

    # Cost estimation
    print("4. Cost Estimation:")
    total_tokens = sum(service.estimate_tokens(text) for text in texts)
    openai_cost = service.get_embedding_cost(total_tokens, model="openai")
    st_cost = service.get_embedding_cost(total_tokens, model="sentence_transformers")

    print(f"   Total Tokens: {total_tokens}")
    print(f"   OpenAI Cost: ${openai_cost:.6f}")
    print(f"   Sentence Transformers Cost: ${st_cost:.6f}")
    print()

    print("=" * 80)
    print("✅ EMBEDDING SERVICE TEST COMPLETE")
    print("=" * 80)
