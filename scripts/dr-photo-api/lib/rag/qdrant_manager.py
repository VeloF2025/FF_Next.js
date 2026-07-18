"""
Qdrant Vector Database Manager

Purpose: Manage Qdrant collections for vector storage and similarity search
Features: Collection creation, vector indexing, similarity search, batch operations

Generated: 2025-11-15
Authority: Phase 5 - Week 2 RAG Engine Implementation
"""

import logging
from typing import Dict, Any, List, Optional, Union
from datetime import datetime
import os
from pathlib import Path

from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    VectorParams,
    PointStruct,
    Filter,
    FieldCondition,
    MatchValue,
    SearchRequest,
    CollectionInfo,
    UpdateStatus,
    HnswConfigDiff,
    OptimizersConfigDiff,
    SearchParams
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class QdrantManager:
    """
    Qdrant Vector Database Manager

    Manages vector collections for BOSS knowledge layer:
    - Documents (chunked text embeddings)
    - Entities (entity embeddings from memory graph)
    - Conversations (email/WhatsApp thread embeddings)
    """

    # Collection configurations
    COLLECTIONS = {
        "documents": {
            "vector_size": 768,  # Gemini text-embedding-004 (FREE, PRIMARY)
            "distance": Distance.COSINE,
            "description": "Document chunks with embeddings"
        },
        "entities": {
            "vector_size": 768,  # Gemini text-embedding-004
            "distance": Distance.COSINE,
            "description": "Entity embeddings from memory graph"
        },
        "conversations": {
            "vector_size": 768,  # Gemini text-embedding-004
            "distance": Distance.COSINE,
            "description": "Email and WhatsApp conversation embeddings"
        }
    }

    # Optimized HNSW parameters for faster search with high recall
    # Reference: https://qdrant.tech/documentation/guides/optimize/
    HNSW_CONFIG = {
        "m": 32,              # Number of edges per node (default: 16)
                              # Higher = better recall, more memory
                              # 32 recommended for high-quality search
        "ef_construct": 200,  # Size of dynamic candidate list (default: 100)
                              # Higher = better index quality, slower indexing
                              # 200 recommended for production
        "full_scan_threshold": 10000,  # Use full scan for small collections
        "on_disk": False      # Keep index in RAM for faster search
    }

    # Optimizer configuration for better indexing performance
    OPTIMIZER_CONFIG = {
        "indexing_threshold": 20000,  # Start indexing after 20K vectors
        "memmap_threshold": 50000     # Use memory-mapped files after 50K vectors
    }

    def __init__(
        self,
        host: Optional[str] = None,
        port: Optional[int] = None,
        url: Optional[str] = None,
        api_key: Optional[str] = None
    ):
        """
        Initialize Qdrant client.

        Args:
            host: Qdrant host (default: localhost)
            port: Qdrant port (default: 6333)
            url: Full Qdrant URL (overrides host/port)
            api_key: Qdrant API key (for cloud)
        """
        self.host = host or os.getenv("QDRANT_HOST", "localhost")
        self.port = port or int(os.getenv("QDRANT_PORT", 6335))  # BOSS uses 6335 (mapped from container 6333)
        self.url = url or os.getenv("QDRANT_URL")
        self.api_key = api_key or os.getenv("QDRANT_API_KEY")

        # Connect to Qdrant
        if self.url:
            self.client = QdrantClient(url=self.url, api_key=self.api_key)
        else:
            # For local development: use HTTP (not HTTPS) to avoid SSL errors
            # prefer_grpc=False forces HTTP REST API instead of gRPC
            self.client = QdrantClient(
                host=self.host,
                port=self.port,
                api_key=self.api_key,
                https=False,  # Use HTTP, not HTTPS
                prefer_grpc=False  # Use REST API, not gRPC
            )

        logger.info(f"QdrantManager initialized (host: {self.host}, port: {self.port})")

    def create_collections(self, recreate: bool = False) -> Dict[str, bool]:
        """
        Create all required Qdrant collections.

        Args:
            recreate: If True, delete existing collections and recreate

        Returns:
            Dict of collection_name -> created (bool)
        """
        results = {}

        for collection_name, config in self.COLLECTIONS.items():
            try:
                # Check if collection exists
                collections = self.client.get_collections().collections
                exists = any(c.name == collection_name for c in collections)

                if exists and recreate:
                    logger.info(f"Deleting existing collection: {collection_name}")
                    self.client.delete_collection(collection_name)
                    exists = False

                if not exists:
                    logger.info(f"Creating collection: {collection_name} with optimized HNSW config")
                    self.client.create_collection(
                        collection_name=collection_name,
                        vectors_config=VectorParams(
                            size=config["vector_size"],
                            distance=config["distance"],
                            hnsw_config=HnswConfigDiff(
                                m=self.HNSW_CONFIG["m"],
                                ef_construct=self.HNSW_CONFIG["ef_construct"],
                                full_scan_threshold=self.HNSW_CONFIG["full_scan_threshold"],
                                on_disk=self.HNSW_CONFIG["on_disk"]
                            )
                        ),
                        optimizers_config=OptimizersConfigDiff(
                            indexing_threshold=self.OPTIMIZER_CONFIG["indexing_threshold"],
                            memmap_threshold=self.OPTIMIZER_CONFIG["memmap_threshold"]
                        )
                    )
                    logger.info(
                        f"✅ Created collection: {collection_name} "
                        f"(HNSW: m={self.HNSW_CONFIG['m']}, ef_construct={self.HNSW_CONFIG['ef_construct']})"
                    )
                    results[collection_name] = True
                else:
                    logger.info(f"Collection already exists: {collection_name}")
                    results[collection_name] = False

            except Exception as e:
                logger.error(f"Failed to create collection {collection_name}: {e}")
                results[collection_name] = False

        return results

    def get_collection_info(self, collection_name: str) -> Optional[CollectionInfo]:
        """
        Get information about a collection.

        Args:
            collection_name: Name of collection

        Returns:
            CollectionInfo or None if not found
        """
        try:
            return self.client.get_collection(collection_name)
        except Exception as e:
            logger.error(f"Failed to get collection info for {collection_name}: {e}")
            return None

    def upsert_vectors(
        self,
        collection_name: str,
        points: List[PointStruct],
        batch_size: int = 100
    ) -> Dict[str, Any]:
        """
        Upsert vectors to collection in batches.

        Args:
            collection_name: Collection to upsert into
            points: List of PointStruct objects
            batch_size: Batch size for upsert

        Returns:
            Dict with status and counts
        """
        total = len(points)
        logger.info(f"Upserting {total} points to {collection_name} (batch_size={batch_size})")

        try:
            # Process in batches
            for i in range(0, total, batch_size):
                batch = points[i:i + batch_size]
                self.client.upsert(
                    collection_name=collection_name,
                    points=batch
                )
                logger.debug(f"Upserted batch {i//batch_size + 1}/{(total + batch_size - 1)//batch_size}")

            logger.info(f"✅ Upserted {total} points to {collection_name}")

            return {
                "status": "success",
                "collection": collection_name,
                "total_points": total,
                "batch_size": batch_size
            }

        except Exception as e:
            # Get detailed error information
            error_msg = str(e)
            error_type = type(e).__name__

            # Try to extract more details from the exception
            detailed_info = f"{error_type}: {error_msg}"
            if hasattr(e, '__dict__'):
                detailed_info += f" | Details: {e.__dict__}"

            logger.error(f"Failed to upsert vectors to {collection_name}: {detailed_info}")
            logger.error(f"First point sample: {points[0] if points else 'No points'}")

            return {
                "status": "error",
                "error": str(e),
                "collection": collection_name,
                "points_attempted": len(points)
            }

    def search(
        self,
        collection_name: str,
        query_vector: List[float],
        limit: int = 10,
        score_threshold: Optional[float] = None,
        filter_conditions: Optional[Filter] = None,
        ef: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """
        Search for similar vectors in collection with optimized HNSW parameters.

        Args:
            collection_name: Collection to search
            query_vector: Query embedding vector
            limit: Maximum results to return
            score_threshold: Minimum similarity score (0.0 to 1.0)
            filter_conditions: Qdrant filter for metadata
            ef: HNSW search parameter (default: 128 for high recall)
                Higher = better recall, slower search
                Recommended: 128-512 for production

        Returns:
            List of search results with scores
        """
        try:
            # Use optimized ef parameter for better recall
            # ef should be >= limit and typically 128-512 for good quality
            search_ef = ef or max(128, limit * 2)

            search_result = self.client.search(
                collection_name=collection_name,
                query_vector=query_vector,
                limit=limit,
                score_threshold=score_threshold,
                query_filter=filter_conditions,
                search_params=SearchParams(
                    hnsw_ef=search_ef,  # Optimized for high recall
                    exact=False  # Use HNSW approximation (faster)
                )
            )

            results = []
            for hit in search_result:
                results.append({
                    "id": hit.id,
                    "score": hit.score,
                    "payload": hit.payload,
                    "vector": hit.vector if hasattr(hit, 'vector') else None
                })

            logger.debug(f"Found {len(results)} results in {collection_name}")

            return results

        except Exception as e:
            logger.error(f"Search failed in {collection_name}: {e}")
            return []

    def search_batch(
        self,
        collection_name: str,
        query_vectors: List[List[float]],
        limit: int = 10,
        score_threshold: Optional[float] = None
    ) -> List[List[Dict[str, Any]]]:
        """
        Batch search for multiple query vectors.

        Args:
            collection_name: Collection to search
            query_vectors: List of query embedding vectors
            limit: Maximum results per query
            score_threshold: Minimum similarity score

        Returns:
            List of search results for each query
        """
        try:
            search_requests = [
                SearchRequest(
                    vector=vector,
                    limit=limit,
                    score_threshold=score_threshold
                )
                for vector in query_vectors
            ]

            batch_results = self.client.search_batch(
                collection_name=collection_name,
                requests=search_requests
            )

            all_results = []
            for search_result in batch_results:
                results = []
                for hit in search_result:
                    results.append({
                        "id": hit.id,
                        "score": hit.score,
                        "payload": hit.payload
                    })
                all_results.append(results)

            return all_results

        except Exception as e:
            logger.error(f"Batch search failed: {e}")
            return [[] for _ in query_vectors]

    def delete_points(
        self,
        collection_name: str,
        point_ids: List[Union[str, int]]
    ) -> Dict[str, Any]:
        """
        Delete points from collection.

        Args:
            collection_name: Collection to delete from
            point_ids: List of point IDs to delete

        Returns:
            Status dict
        """
        try:
            self.client.delete(
                collection_name=collection_name,
                points_selector=point_ids
            )

            logger.info(f"✅ Deleted {len(point_ids)} points from {collection_name}")

            return {
                "status": "success",
                "deleted_count": len(point_ids)
            }

        except Exception as e:
            logger.error(f"Failed to delete points: {e}")
            return {
                "status": "error",
                "error": str(e)
            }

    def count_points(self, collection_name: str) -> int:
        """
        Count total points in collection.

        Args:
            collection_name: Collection name

        Returns:
            Point count
        """
        try:
            info = self.client.get_collection(collection_name)
            return info.points_count
        except Exception as e:
            logger.error(f"Failed to count points: {e}")
            return 0

    def scroll_points(
        self,
        collection_name: str,
        limit: int = 100,
        offset: Optional[str] = None,
        with_vectors: bool = False
    ) -> Dict[str, Any]:
        """
        Scroll through points in collection.

        Args:
            collection_name: Collection to scroll
            limit: Number of points to return
            offset: Offset for pagination
            with_vectors: Include vectors in response

        Returns:
            Dict with points and next_offset
        """
        try:
            result = self.client.scroll(
                collection_name=collection_name,
                limit=limit,
                offset=offset,
                with_vectors=with_vectors
            )

            points = []
            for point in result[0]:
                points.append({
                    "id": point.id,
                    "payload": point.payload,
                    "vector": point.vector if with_vectors else None
                })

            return {
                "points": points,
                "next_offset": result[1]
            }

        except Exception as e:
            logger.error(f"Failed to scroll points: {e}")
            return {
                "points": [],
                "next_offset": None
            }

    def get_statistics(self) -> Dict[str, Any]:
        """
        Get statistics for all collections.

        Returns:
            Dict with collection statistics
        """
        stats = {
            "collections": {},
            "total_points": 0
        }

        try:
            collections = self.client.get_collections().collections

            for collection in collections:
                info = self.client.get_collection(collection.name)

                stats["collections"][collection.name] = {
                    "points_count": info.points_count,
                    "vector_size": info.config.params.vectors.size,
                    "distance": info.config.params.vectors.distance.name
                }

                stats["total_points"] += info.points_count

        except Exception as e:
            logger.error(f"Failed to get statistics: {e}")

        return stats

    def health_check(self) -> Dict[str, Any]:
        """
        Check Qdrant connection health.

        Returns:
            Health status dict
        """
        try:
            collections = self.client.get_collections()

            return {
                "status": "healthy",
                "collections_count": len(collections.collections),
                "timestamp": datetime.now().isoformat()
            }

        except Exception as e:
            logger.error(f"Health check failed: {e}")
            return {
                "status": "unhealthy",
                "error": str(e),
                "timestamp": datetime.now().isoformat()
            }


# ============================================================================
# CONVENIENCE FUNCTIONS
# ============================================================================

_qdrant_manager_instance = None


def get_qdrant_manager() -> QdrantManager:
    """
    Get or create singleton QdrantManager instance.

    Returns:
        QdrantManager instance
    """
    global _qdrant_manager_instance

    if _qdrant_manager_instance is None:
        _qdrant_manager_instance = QdrantManager()

    return _qdrant_manager_instance


def initialize_qdrant_collections(recreate: bool = False) -> Dict[str, bool]:
    """
    Initialize all Qdrant collections.

    Args:
        recreate: If True, delete and recreate existing collections

    Returns:
        Dict of collection_name -> created (bool)
    """
    manager = get_qdrant_manager()
    return manager.create_collections(recreate=recreate)


if __name__ == "__main__":
    # Test Qdrant connection and create collections
    print("=" * 80)
    print("QDRANT MANAGER - INITIALIZATION TEST")
    print("=" * 80)
    print()

    manager = get_qdrant_manager()

    # Health check
    print("1. Health Check:")
    health = manager.health_check()
    print(f"   Status: {health['status']}")
    print()

    # Create collections
    print("2. Creating Collections:")
    results = manager.create_collections(recreate=False)
    for collection_name, created in results.items():
        status = "✅ Created" if created else "ℹ️  Already exists"
        print(f"   {status}: {collection_name}")
    print()

    # Get statistics
    print("3. Collection Statistics:")
    stats = manager.get_statistics()
    print(f"   Total Collections: {len(stats['collections'])}")
    print(f"   Total Points: {stats['total_points']}")
    print()
    for collection_name, info in stats["collections"].items():
        print(f"   {collection_name}:")
        print(f"     - Points: {info['points_count']}")
        print(f"     - Vector Size: {info['vector_size']}")
        print(f"     - Distance: {info['distance']}")

    print()
    print("=" * 80)
    print("✅ QDRANT INITIALIZATION COMPLETE")
    print("=" * 80)
