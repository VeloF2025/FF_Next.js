"""
Reranker Module - Two-Stage Retrieval Enhancement

Purpose: Improve RAG retrieval accuracy by 15-20% using cross-encoder reranking
Model: BAAI/bge-reranker-v2-m3 (multilingual, high accuracy)
Strategy: Over-retrieve (50 candidates) → Rerank → Return top_k

Generated: 2025-12-02
Authority: BOSS-EXEC Implementation Plan Phase 1
"""

import logging
from typing import List, Dict, Any, Optional
from datetime import datetime

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class BGEReranker:
    """
    BGE Cross-Encoder Reranker

    Uses BAAI/bge-reranker-v2-m3 for accurate relevance scoring.
    Cross-encoders process (query, document) pairs together for better
    semantic understanding than bi-encoder retrieval alone.

    Expected improvement: 15-20% accuracy boost on retrieval relevance.
    """

    # Model configuration
    DEFAULT_MODEL = "BAAI/bge-reranker-v2-m3"
    FALLBACK_MODEL = "cross-encoder/ms-marco-MiniLM-L-6-v2"  # Lighter, faster

    def __init__(
        self,
        model_name: Optional[str] = None,
        device: Optional[str] = None,
        batch_size: int = 32,
        use_fp16: bool = True,
        lazy_load: bool = True
    ):
        """
        Initialize BGE Reranker.

        Args:
            model_name: Cross-encoder model name (default: BGE reranker v2)
            device: Device to use ('cpu', 'cuda', 'mps', or None for auto)
            batch_size: Batch size for prediction
            use_fp16: Use half precision for faster inference (GPU only)
            lazy_load: Defer model loading until first use
        """
        self.model_name = model_name or self.DEFAULT_MODEL
        self.device = device
        self.batch_size = batch_size
        self.use_fp16 = use_fp16
        self._model = None

        # Statistics tracking
        self.stats = {
            "total_rerank_calls": 0,
            "total_documents_reranked": 0,
            "total_time_ms": 0,
            "avg_time_per_doc_ms": 0
        }

        if not lazy_load:
            self._load_model()

        logger.info(f"BGEReranker initialized (model: {self.model_name}, lazy_load: {lazy_load})")

    def _load_model(self):
        """Load the cross-encoder model."""
        if self._model is not None:
            return

        try:
            from sentence_transformers import CrossEncoder

            logger.info(f"Loading reranker model: {self.model_name}")
            start = datetime.now()

            # Determine device
            if self.device is None:
                import torch
                if torch.cuda.is_available():
                    self.device = "cuda"
                elif hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
                    self.device = "mps"
                else:
                    self.device = "cpu"

            # Load model
            self._model = CrossEncoder(
                self.model_name,
                max_length=512,
                device=self.device
            )

            # Enable FP16 on GPU for faster inference
            if self.use_fp16 and self.device in ("cuda", "mps"):
                try:
                    self._model.model.half()
                    logger.info("Enabled FP16 for faster inference")
                except Exception as e:
                    logger.warning(f"Could not enable FP16: {e}")

            elapsed = (datetime.now() - start).total_seconds() * 1000
            logger.info(f"Reranker model loaded in {elapsed:.0f}ms (device: {self.device})")

        except ImportError:
            logger.error("sentence-transformers not installed. Run: pip install sentence-transformers")
            raise
        except Exception as e:
            logger.error(f"Failed to load primary model, trying fallback: {e}")
            try:
                from sentence_transformers import CrossEncoder
                self._model = CrossEncoder(self.FALLBACK_MODEL, device=self.device or "cpu")
                logger.info(f"Loaded fallback model: {self.FALLBACK_MODEL}")
            except Exception as e2:
                logger.error(f"Fallback model also failed: {e2}")
                raise

    @property
    def model(self):
        """Lazy load model on first access."""
        if self._model is None:
            self._load_model()
        return self._model

    def rerank(
        self,
        query: str,
        documents: List[Dict[str, Any]],
        top_k: int = 10,
        content_key: str = "chunk_text",
        return_scores: bool = True
    ) -> List[Dict[str, Any]]:
        """
        Rerank documents by relevance to query.

        Uses cross-encoder to score (query, document) pairs together,
        providing more accurate relevance than bi-encoder retrieval alone.

        Args:
            query: Search query
            documents: List of document dicts (must contain content_key in payload)
            top_k: Number of top documents to return
            content_key: Key to extract document text from payload
            return_scores: Include rerank scores in results

        Returns:
            Reranked documents (top_k most relevant)
        """
        if not documents:
            return []

        start = datetime.now()

        # Extract text from documents
        pairs = []
        valid_docs = []

        for doc in documents:
            # Handle both direct content and nested payload structure
            if "payload" in doc and content_key in doc["payload"]:
                text = doc["payload"][content_key]
            elif content_key in doc:
                text = doc[content_key]
            else:
                # Try common fallbacks
                text = doc.get("content", doc.get("text", doc.get("chunk_text", "")))

            if text:
                pairs.append((query, text))
                valid_docs.append(doc)

        if not pairs:
            logger.warning("No valid documents to rerank (missing content)")
            return documents[:top_k]

        # Get rerank scores
        try:
            scores = self.model.predict(
                pairs,
                batch_size=self.batch_size,
                show_progress_bar=False
            )
        except Exception as e:
            logger.error(f"Reranking failed: {e}")
            # Return original order on failure
            return documents[:top_k]

        # Attach scores to documents
        for doc, score in zip(valid_docs, scores):
            doc["rerank_score"] = float(score)
            if return_scores:
                # Also store in payload for context assembly
                if "payload" not in doc:
                    doc["payload"] = {}
                doc["payload"]["rerank_score"] = float(score)

        # Sort by rerank score (descending)
        reranked = sorted(valid_docs, key=lambda x: x.get("rerank_score", 0), reverse=True)

        # Take top_k
        result = reranked[:top_k]

        # Update statistics
        elapsed_ms = (datetime.now() - start).total_seconds() * 1000
        self.stats["total_rerank_calls"] += 1
        self.stats["total_documents_reranked"] += len(valid_docs)
        self.stats["total_time_ms"] += elapsed_ms
        self.stats["avg_time_per_doc_ms"] = (
            self.stats["total_time_ms"] / self.stats["total_documents_reranked"]
            if self.stats["total_documents_reranked"] > 0 else 0
        )

        logger.info(
            f"Reranked {len(valid_docs)} → {len(result)} documents in {elapsed_ms:.0f}ms "
            f"(top score: {result[0]['rerank_score']:.4f})"
        )

        return result

    def rerank_with_threshold(
        self,
        query: str,
        documents: List[Dict[str, Any]],
        threshold: float = 0.0,
        top_k: Optional[int] = None,
        content_key: str = "chunk_text"
    ) -> List[Dict[str, Any]]:
        """
        Rerank and filter documents below threshold.

        Args:
            query: Search query
            documents: List of document dicts
            threshold: Minimum rerank score (filter out low-relevance)
            top_k: Optional maximum results (None = return all above threshold)
            content_key: Key to extract document text

        Returns:
            Reranked and filtered documents
        """
        # Get all reranked results
        reranked = self.rerank(
            query=query,
            documents=documents,
            top_k=len(documents),  # Get all
            content_key=content_key
        )

        # Filter by threshold
        filtered = [doc for doc in reranked if doc.get("rerank_score", 0) >= threshold]

        logger.debug(f"Threshold filter: {len(reranked)} → {len(filtered)} (threshold: {threshold})")

        # Apply top_k if specified
        if top_k is not None:
            filtered = filtered[:top_k]

        return filtered

    def get_statistics(self) -> Dict[str, Any]:
        """Get reranker statistics."""
        return {
            **self.stats,
            "model_name": self.model_name,
            "device": self.device,
            "model_loaded": self._model is not None
        }

    def reset_statistics(self):
        """Reset statistics counters."""
        self.stats = {
            "total_rerank_calls": 0,
            "total_documents_reranked": 0,
            "total_time_ms": 0,
            "avg_time_per_doc_ms": 0
        }


# ============================================================================
# LIGHTWEIGHT RERANKER (No ML Dependencies)
# ============================================================================

class LightweightReranker:
    """
    Lightweight reranker using BM25 + TF-IDF scoring.

    Use when:
    - sentence-transformers not available
    - Need faster inference without ML
    - CPU-only environment

    Less accurate than BGE but still improves over first-stage retrieval.
    """

    def __init__(self):
        """Initialize lightweight reranker."""
        logger.info("LightweightReranker initialized (no ML dependencies)")

    def rerank(
        self,
        query: str,
        documents: List[Dict[str, Any]],
        top_k: int = 10,
        content_key: str = "chunk_text"
    ) -> List[Dict[str, Any]]:
        """
        Rerank using simple BM25-style scoring.

        Args:
            query: Search query
            documents: List of document dicts
            top_k: Number of top documents to return
            content_key: Key to extract document text

        Returns:
            Reranked documents
        """
        import math
        from collections import Counter

        if not documents:
            return []

        query_terms = query.lower().split()

        scored_docs = []
        for doc in documents:
            # Extract text
            if "payload" in doc and content_key in doc["payload"]:
                text = doc["payload"][content_key]
            elif content_key in doc:
                text = doc[content_key]
            else:
                text = doc.get("content", doc.get("text", ""))

            if not text:
                scored_docs.append((doc, 0.0))
                continue

            # Simple BM25-ish scoring
            text_lower = text.lower()
            text_terms = text_lower.split()
            term_freq = Counter(text_terms)
            doc_len = len(text_terms)
            avg_len = 100  # Approximate average

            k1 = 1.2
            b = 0.75

            score = 0.0
            for term in query_terms:
                tf = term_freq.get(term, 0)
                if tf > 0:
                    # BM25 term frequency component
                    tf_score = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * doc_len / avg_len))
                    score += tf_score

            # Boost for exact phrase match
            if query.lower() in text_lower:
                score *= 1.5

            # Combine with original score if available
            original_score = doc.get("rrf_score", doc.get("score", 0))
            combined_score = score * 0.6 + original_score * 0.4

            doc["rerank_score"] = combined_score
            scored_docs.append((doc, combined_score))

        # Sort by score
        scored_docs.sort(key=lambda x: x[1], reverse=True)

        result = [doc for doc, _ in scored_docs[:top_k]]
        logger.info(f"Lightweight rerank: {len(documents)} → {len(result)} documents")

        return result

    def get_statistics(self) -> Dict[str, Any]:
        """Get reranker statistics."""
        return {"type": "lightweight", "model": "BM25-style"}


# ============================================================================
# SINGLETON ACCESS
# ============================================================================

_reranker_instance = None
_lightweight_reranker_instance = None


def get_reranker(use_lightweight: bool = False, **kwargs) -> BGEReranker:
    """
    Get or create singleton reranker instance.

    Args:
        use_lightweight: Use lightweight BM25 reranker instead of BGE
        **kwargs: Additional arguments for reranker initialization

    Returns:
        Reranker instance
    """
    global _reranker_instance, _lightweight_reranker_instance

    if use_lightweight:
        if _lightweight_reranker_instance is None:
            _lightweight_reranker_instance = LightweightReranker()
        return _lightweight_reranker_instance

    if _reranker_instance is None:
        try:
            _reranker_instance = BGEReranker(**kwargs)
        except ImportError:
            logger.warning("sentence-transformers not available, using lightweight reranker")
            _lightweight_reranker_instance = LightweightReranker()
            return _lightweight_reranker_instance

    return _reranker_instance


# ============================================================================
# TESTING
# ============================================================================

if __name__ == "__main__":
    print("=" * 80)
    print("RERANKER MODULE - TEST")
    print("=" * 80)
    print()

    # Create mock documents
    mock_docs = [
        {
            "id": "doc1",
            "rrf_score": 0.8,
            "payload": {
                "chunk_text": "Velocity Fibre project achieved Q4 revenue of $2.5M, up 15% YoY.",
                "title": "Velocity Q4 Report"
            }
        },
        {
            "id": "doc2",
            "rrf_score": 0.9,
            "payload": {
                "chunk_text": "The weather forecast for today shows sunny skies with mild temperatures.",
                "title": "Weather Update"
            }
        },
        {
            "id": "doc3",
            "rrf_score": 0.75,
            "payload": {
                "chunk_text": "Velocity Fibre's network expansion reached 50,000 new homes in Q4.",
                "title": "Velocity Expansion"
            }
        },
        {
            "id": "doc4",
            "rrf_score": 0.85,
            "payload": {
                "chunk_text": "Financial highlights include strong EBITDA margins for the fibre division.",
                "title": "Financial Summary"
            }
        }
    ]

    query = "What is Velocity Fibre's financial performance?"

    # Test lightweight reranker (no dependencies)
    print("1. Testing Lightweight Reranker:")
    lightweight = LightweightReranker()
    light_results = lightweight.rerank(query, mock_docs, top_k=3)
    print(f"   Query: '{query}'")
    print(f"   Results:")
    for i, doc in enumerate(light_results, 1):
        print(f"   {i}. {doc['payload']['title']} (score: {doc['rerank_score']:.4f})")
    print()

    # Test BGE reranker if available
    print("2. Testing BGE Reranker:")
    try:
        reranker = get_reranker(lazy_load=True)
        bge_results = reranker.rerank(query, mock_docs, top_k=3)
        print(f"   Query: '{query}'")
        print(f"   Results:")
        for i, doc in enumerate(bge_results, 1):
            print(f"   {i}. {doc['payload']['title']} (score: {doc['rerank_score']:.4f})")
        print()
        print(f"   Statistics: {reranker.get_statistics()}")
    except ImportError:
        print("   (sentence-transformers not installed - skipping BGE test)")
    print()

    print("=" * 80)
    print("RERANKER TEST COMPLETE")
    print("=" * 80)
