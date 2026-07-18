"""
BOSS RAG (Retrieval-Augmented Generation) Engine

Purpose: Semantic search, document retrieval, and hybrid query capabilities
Components: Qdrant vectors, embeddings, chunking, hybrid retrieval

Generated: 2025-11-15
Authority: Phase 5 - Week 2 RAG Engine Implementation
"""

from lib.rag.qdrant_manager import (
    QdrantManager,
    get_qdrant_manager,
    initialize_qdrant_collections
)

from lib.rag.embedding_service import (
    EmbeddingService,
    get_embedding_service,
    generate_embedding,
    generate_embeddings_batch
)

from lib.rag.document_chunker import (
    DocumentChunker,
    get_document_chunker,
    index_document,
    index_documents_batch
)

from lib.rag.hybrid_retrieval import (
    HybridRetriever,
    get_hybrid_retriever,
    hybrid_search
)

from lib.rag.rag_engine import (
    RAGEngine,
    get_rag_engine,
    query_rag
)

__all__ = [
    # Qdrant vector database
    "QdrantManager",
    "get_qdrant_manager",
    "initialize_qdrant_collections",

    # Embedding generation
    "EmbeddingService",
    "get_embedding_service",
    "generate_embedding",
    "generate_embeddings_batch",

    # Document chunking and indexing
    "DocumentChunker",
    "get_document_chunker",
    "index_document",
    "index_documents_batch",

    # Hybrid retrieval
    "HybridRetriever",
    "get_hybrid_retriever",
    "hybrid_search",

    # RAG Engine (complete system)
    "RAGEngine",
    "get_rag_engine",
    "query_rag"
]
