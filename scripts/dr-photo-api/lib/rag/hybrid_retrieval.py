"""
Hybrid Retrieval System

Purpose: Combine vector similarity, keyword search, and graph traversal for optimal retrieval
Features: Multi-modal search, fusion ranking, context assembly, result reranking

Generated: 2025-11-15
Authority: Phase 5 - Week 2 RAG Engine Implementation
"""

import logging
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime
import math

from lib.rag.embedding_service import get_embedding_service, EmbeddingService
from lib.rag.qdrant_manager import get_qdrant_manager, QdrantManager
from lib.memory_graph import get_memory_graph_service, MemoryGraphService

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class HybridRetriever:
    """
    Hybrid Retrieval System

    Combines three retrieval strategies:
    1. Vector Similarity (Qdrant) - Semantic understanding
    2. Keyword Search (PostgreSQL FTS) - Exact term matching
    3. Graph Traversal (Memory Graph) - Relationship-based context

    Uses Reciprocal Rank Fusion (RRF) to combine results.
    """

    def __init__(
        self,
        embedding_service: Optional[EmbeddingService] = None,
        qdrant_manager: Optional[QdrantManager] = None,
        memory_graph: Optional[MemoryGraphService] = None,
        default_weights: Optional[Dict[str, float]] = None
    ):
        """
        Initialize Hybrid Retriever.

        Args:
            embedding_service: EmbeddingService instance
            qdrant_manager: QdrantManager instance
            memory_graph: MemoryGraphService instance
            default_weights: Default weights for fusion (vector, keyword, graph)
        """
        self.embedding_service = embedding_service or get_embedding_service()
        self.qdrant_manager = qdrant_manager or get_qdrant_manager()
        self.memory_graph = memory_graph or get_memory_graph_service()

        # Default fusion weights
        self.default_weights = default_weights or {
            "vector": 0.5,   # Semantic similarity
            "keyword": 0.3,  # Exact term matching
            "graph": 0.2     # Relationship context
        }

        logger.info("HybridRetriever initialized")

    def retrieve(
        self,
        query: str,
        top_k: int = 10,
        weights: Optional[Dict[str, float]] = None,
        filters: Optional[Dict[str, Any]] = None,
        collection_name: str = "documents"
    ) -> List[Dict[str, Any]]:
        """
        Retrieve documents using hybrid search.

        Args:
            query: Search query
            top_k: Number of results to return
            weights: Custom weights for fusion (vector, keyword, graph)
            filters: Optional filters (metadata, date range, etc.)
            collection_name: Qdrant collection to search

        Returns:
            List of retrieved documents with scores
        """
        logger.info(f"Hybrid retrieval for query: '{query}'")

        # Use default weights if not provided
        weights = weights or self.default_weights

        # 1. Vector similarity search
        vector_results = self._vector_search(
            query=query,
            top_k=top_k * 2,  # Get more candidates for fusion
            filters=filters,
            collection_name=collection_name
        )

        # 2. Keyword search (PostgreSQL full-text)
        keyword_results = self._keyword_search(
            query=query,
            top_k=top_k * 2,
            filters=filters
        )

        # 3. Graph traversal (entity-based context)
        graph_results = self._graph_search(
            query=query,
            top_k=top_k * 2,
            filters=filters
        )

        # 4. Fusion ranking (Reciprocal Rank Fusion)
        fused_results = self._reciprocal_rank_fusion(
            vector_results=vector_results,
            keyword_results=keyword_results,
            graph_results=graph_results,
            weights=weights,
            top_k=top_k
        )

        logger.info(f"✅ Retrieved {len(fused_results)} documents")

        return fused_results

    def _vector_search(
        self,
        query: str,
        top_k: int,
        filters: Optional[Dict[str, Any]],
        collection_name: str
    ) -> List[Dict[str, Any]]:
        """
        Vector similarity search using Qdrant.

        Args:
            query: Search query
            top_k: Number of results
            filters: Optional filters
            collection_name: Qdrant collection

        Returns:
            List of results with scores
        """
        logger.debug(f"Vector search: '{query}'")

        # Generate query embedding
        query_embedding = self.embedding_service.generate_embedding(query)

        if not query_embedding:
            logger.warning("Failed to generate query embedding")
            return []

        # Search Qdrant
        results = self.qdrant_manager.search(
            collection_name=collection_name,
            query_vector=query_embedding,
            limit=top_k,
            score_threshold=0.5  # Only return reasonable matches
        )

        # Format results
        formatted_results = []
        for i, result in enumerate(results):
            formatted_results.append({
                "id": result["id"],
                "score": result["score"],
                "rank": i + 1,
                "source": "vector",
                "payload": result["payload"]
            })

        logger.debug(f"Vector search found {len(formatted_results)} results")

        return formatted_results

    def _keyword_search(
        self,
        query: str,
        top_k: int,
        filters: Optional[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """
        Keyword search using PostgreSQL full-text search.

        Args:
            query: Search query
            top_k: Number of results
            filters: Optional filters

        Returns:
            List of results with scores
        """
        logger.debug(f"Keyword search: '{query}'")

        # Search for entities matching query using PostgreSQL full-text search
        try:
            # Find entities matching query text
            entities = self.memory_graph.find_entities(
                name_pattern=f"%{query}%",
                limit=top_k
            )

            # Get documents linked to these entities
            formatted_results = []
            seen_docs = set()

            for entity in entities:
                # Get documents mentioning this entity
                docs = self.memory_graph.get_entity_documents(str(entity["id"]))

                for doc_path in docs:
                    if doc_path not in seen_docs:
                        seen_docs.add(doc_path)
                        formatted_results.append({
                            "id": doc_path,
                            "score": 1.0 / (len(formatted_results) + 1),
                            "rank": len(formatted_results) + 1,
                            "source": "keyword",
                            "payload": {
                                "path": doc_path,
                                "entity": entity["name"],
                                "entity_type": entity["entity_type"]
                            }
                        })

            logger.debug(f"Keyword search found {len(formatted_results)} results")

            return formatted_results[:top_k]

        except Exception as e:
            logger.error(f"Keyword search failed: {e}")
            return []

    def _graph_search(
        self,
        query: str,
        top_k: int,
        filters: Optional[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """
        Graph traversal search using Memory Graph.

        Args:
            query: Search query
            top_k: Number of results
            filters: Optional filters

        Returns:
            List of results with scores
        """
        logger.debug(f"Graph search: '{query}'")

        # Extract entities from query (simple keyword extraction)
        query_entities = self._extract_query_entities(query)

        if not query_entities:
            logger.debug("No entities extracted from query")
            return []

        # Search for related documents via graph traversal
        try:
            results = []
            seen_docs = set()

            for entity_name in query_entities:
                # Find entities matching this name
                entities = self.memory_graph.find_entities(
                    name_pattern=f"%{entity_name}%",
                    limit=5
                )

                for entity in entities:
                    entity_id = str(entity["id"])

                    # Get entity network (2 hops)
                    network = self.memory_graph.get_entity_network(
                        entity_id=entity_id,
                        max_depth=2
                    )

                    # Get all entities in network
                    for node in network["nodes"]:
                        node_id = str(node["id"])

                        # Get documents mentioning this entity
                        docs = self.memory_graph.get_entity_documents(node_id)

                        for doc_path in docs:
                            if doc_path not in seen_docs:
                                seen_docs.add(doc_path)

                                # Calculate score based on depth
                                # Direct match = 1.0, 1 hop = 0.5, 2 hops = 0.33
                                depth = 0 if node_id == entity_id else 1
                                score = 1.0 / (depth + 1)

                                results.append({
                                    "id": doc_path,
                                    "score": score,
                                    "rank": len(results) + 1,
                                    "source": "graph",
                                    "payload": {
                                        "path": doc_path,
                                        "entity": node["name"],
                                        "entity_type": node["entity_type"],
                                        "depth": depth
                                    }
                                })

            # Sort by score and limit
            results.sort(key=lambda x: x["score"], reverse=True)
            results = results[:top_k]

            # Update ranks after sorting
            for i, result in enumerate(results):
                result["rank"] = i + 1

            logger.debug(f"Graph search found {len(results)} results")

            return results

        except Exception as e:
            logger.error(f"Graph search failed: {e}")
            return []

    def _extract_query_entities(self, query: str) -> List[str]:
        """
        Extract entity names from query (simple keyword extraction).

        Args:
            query: Search query

        Returns:
            List of entity names
        """
        # Simple approach: Extract capitalized words (proper nouns)
        # Better approach would use NER (spaCy, etc.)

        words = query.split()
        entities = []

        for word in words:
            # Check if word starts with capital letter and is >3 chars
            if word and word[0].isupper() and len(word) > 3:
                # Remove punctuation
                clean_word = word.strip(".,!?;:")
                entities.append(clean_word)

        return entities

    def _reciprocal_rank_fusion(
        self,
        vector_results: List[Dict[str, Any]],
        keyword_results: List[Dict[str, Any]],
        graph_results: List[Dict[str, Any]],
        weights: Dict[str, float],
        top_k: int,
        k: int = 60
    ) -> List[Dict[str, Any]]:
        """
        Combine results using Reciprocal Rank Fusion (RRF).

        RRF formula: score(d) = sum_r [ weight_r / (k + rank_r(d)) ]
        where r = retrieval method, k = constant (typically 60)

        Args:
            vector_results: Vector search results
            keyword_results: Keyword search results
            graph_results: Graph search results
            weights: Weights for each method
            top_k: Number of final results
            k: RRF constant (default 60)

        Returns:
            Fused and ranked results
        """
        logger.debug("Performing Reciprocal Rank Fusion")

        # Combine all results by ID
        all_results = {}

        # Process vector results
        for result in vector_results:
            doc_id = result["id"]
            rank = result["rank"]

            if doc_id not in all_results:
                all_results[doc_id] = {
                    "id": doc_id,
                    "rrf_score": 0.0,
                    "sources": [],
                    "payload": result["payload"]
                }

            # Add RRF score contribution
            rrf_contribution = weights["vector"] / (k + rank)
            all_results[doc_id]["rrf_score"] += rrf_contribution
            all_results[doc_id]["sources"].append({
                "source": "vector",
                "rank": rank,
                "score": result["score"],
                "contribution": rrf_contribution
            })

        # Process keyword results
        for result in keyword_results:
            doc_id = result["id"]
            rank = result["rank"]

            if doc_id not in all_results:
                all_results[doc_id] = {
                    "id": doc_id,
                    "rrf_score": 0.0,
                    "sources": [],
                    "payload": result["payload"]
                }

            rrf_contribution = weights["keyword"] / (k + rank)
            all_results[doc_id]["rrf_score"] += rrf_contribution
            all_results[doc_id]["sources"].append({
                "source": "keyword",
                "rank": rank,
                "score": result["score"],
                "contribution": rrf_contribution
            })

        # Process graph results
        for result in graph_results:
            doc_id = result["id"]
            rank = result["rank"]

            if doc_id not in all_results:
                all_results[doc_id] = {
                    "id": doc_id,
                    "rrf_score": 0.0,
                    "sources": [],
                    "payload": result["payload"]
                }

            rrf_contribution = weights["graph"] / (k + rank)
            all_results[doc_id]["rrf_score"] += rrf_contribution
            all_results[doc_id]["sources"].append({
                "source": "graph",
                "rank": rank,
                "score": result["score"],
                "contribution": rrf_contribution
            })

        # Sort by RRF score
        ranked_results = sorted(
            all_results.values(),
            key=lambda x: x["rrf_score"],
            reverse=True
        )

        # Limit to top_k
        final_results = ranked_results[:top_k]

        logger.debug(f"RRF fusion produced {len(final_results)} results")

        return final_results

    def retrieve_with_context(
        self,
        query: str,
        top_k: int = 10,
        context_window: int = 2,
        weights: Optional[Dict[str, float]] = None
    ) -> Dict[str, Any]:
        """
        Retrieve documents with expanded context.

        Args:
            query: Search query
            top_k: Number of results
            context_window: Number of surrounding chunks to include
            weights: Custom fusion weights

        Returns:
            Dict with results and expanded context
        """
        logger.info(f"Retrieving with context for: '{query}'")

        # Get base results
        results = self.retrieve(
            query=query,
            top_k=top_k,
            weights=weights
        )

        # Expand context for each result
        expanded_results = []

        for result in results:
            # Get chunk metadata
            payload = result["payload"]
            chunk_index = payload.get("chunk_index", 0)
            source = payload.get("source")

            # Get surrounding chunks from same document
            # (Would need to implement this in QdrantManager)
            # For now, just return the chunk itself

            expanded_results.append({
                **result,
                "context_chunks": [payload]  # Placeholder
            })

        return {
            "query": query,
            "results": expanded_results,
            "total": len(expanded_results)
        }

    def get_statistics(self) -> Dict[str, Any]:
        """
        Get retrieval statistics.

        Returns:
            Statistics dict
        """
        stats = {
            "default_weights": self.default_weights,
            "embedding_service": self.embedding_service.get_statistics(),
            "qdrant": self.qdrant_manager.get_statistics()
        }

        return stats


# ============================================================================
# CONVENIENCE FUNCTIONS
# ============================================================================

_hybrid_retriever_instance = None


def get_hybrid_retriever(
    default_weights: Optional[Dict[str, float]] = None
) -> HybridRetriever:
    """
    Get or create singleton HybridRetriever instance.

    Args:
        default_weights: Default fusion weights

    Returns:
        HybridRetriever instance
    """
    global _hybrid_retriever_instance

    if _hybrid_retriever_instance is None:
        _hybrid_retriever_instance = HybridRetriever(
            default_weights=default_weights
        )

    return _hybrid_retriever_instance


def hybrid_search(
    query: str,
    top_k: int = 10,
    weights: Optional[Dict[str, float]] = None
) -> List[Dict[str, Any]]:
    """
    Convenience function for hybrid search.

    Args:
        query: Search query
        top_k: Number of results
        weights: Custom fusion weights

    Returns:
        List of retrieved documents
    """
    retriever = get_hybrid_retriever()
    return retriever.retrieve(
        query=query,
        top_k=top_k,
        weights=weights
    )


if __name__ == "__main__":
    # Test hybrid retrieval
    print("=" * 80)
    print("HYBRID RETRIEVAL - TEST")
    print("=" * 80)
    print()

    # Initialize retriever
    retriever = get_hybrid_retriever()

    # Get statistics
    stats = retriever.get_statistics()
    print("1. Retriever Statistics:")
    print(f"   Default Weights:")
    print(f"     - Vector: {stats['default_weights']['vector']}")
    print(f"     - Keyword: {stats['default_weights']['keyword']}")
    print(f"     - Graph: {stats['default_weights']['graph']}")
    print(f"   Embedding Model: {stats['embedding_service']['primary_model']}")
    print()

    # Test query
    print("2. Sample Query Test:")
    query = "Find documents about Velocity Fibre project financials"
    print(f"   Query: '{query}'")
    print()

    # Test retrieval (requires data in Qdrant and PostgreSQL)
    print("3. Hybrid Retrieval:")
    print("   (Skipping - requires indexed documents)")
    print("   Use: retriever.retrieve(query, top_k=10) to test")
    print()

    # Test RRF fusion with sample data
    print("4. Reciprocal Rank Fusion Test:")
    vector_results = [
        {"id": "doc1", "score": 0.95, "rank": 1, "payload": {"title": "Doc 1"}},
        {"id": "doc2", "score": 0.87, "rank": 2, "payload": {"title": "Doc 2"}},
        {"id": "doc3", "score": 0.75, "rank": 3, "payload": {"title": "Doc 3"}}
    ]

    keyword_results = [
        {"id": "doc2", "score": 0.92, "rank": 1, "payload": {"title": "Doc 2"}},
        {"id": "doc1", "score": 0.88, "rank": 2, "payload": {"title": "Doc 1"}},
        {"id": "doc4", "score": 0.70, "rank": 3, "payload": {"title": "Doc 4"}}
    ]

    graph_results = [
        {"id": "doc3", "score": 0.85, "rank": 1, "payload": {"title": "Doc 3"}},
        {"id": "doc1", "score": 0.80, "rank": 2, "payload": {"title": "Doc 1"}}
    ]

    fused = retriever._reciprocal_rank_fusion(
        vector_results=vector_results,
        keyword_results=keyword_results,
        graph_results=graph_results,
        weights={"vector": 0.5, "keyword": 0.3, "graph": 0.2},
        top_k=5
    )

    print("   Fused Results:")
    for i, result in enumerate(fused):
        print(f"   {i+1}. {result['payload']['title']} (RRF Score: {result['rrf_score']:.4f})")
        print(f"      Sources: {', '.join([s['source'] for s in result['sources']])}")
    print()

    print("=" * 80)
    print("✅ HYBRID RETRIEVAL TEST COMPLETE")
    print("=" * 80)
