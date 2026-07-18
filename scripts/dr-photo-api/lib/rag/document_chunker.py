"""
Document Chunking and Indexing Pipeline

Purpose: Split documents into chunks, generate embeddings, and index to Qdrant
Features: Smart chunking with overlap, metadata extraction, batch processing, parallel indexing

Generated: 2025-11-15
Authority: Phase 5 - Week 2 RAG Engine Implementation
"""

import logging
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime
from pathlib import Path
import hashlib
import re
import uuid

from qdrant_client.models import PointStruct

from lib.rag.embedding_service import get_embedding_service, EmbeddingService
from lib.rag.qdrant_manager import get_qdrant_manager, QdrantManager

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class DocumentChunker:
    """
    Document Chunking and Indexing Service

    Features:
    - Smart text chunking (500 tokens, 50 overlap)
    - Metadata extraction (title, source, entities)
    - Embedding generation (hybrid OpenAI/Sentence Transformers)
    - Vector indexing to Qdrant
    - Batch processing for efficiency
    - Progress tracking
    """

    def __init__(
        self,
        chunk_size: int = 500,
        chunk_overlap: int = 50,
        embedding_service: Optional[EmbeddingService] = None,
        qdrant_manager: Optional[QdrantManager] = None
    ):
        """
        Initialize Document Chunker.

        Args:
            chunk_size: Target chunk size in tokens
            chunk_overlap: Overlap between chunks in tokens
            embedding_service: EmbeddingService instance (creates if None)
            qdrant_manager: QdrantManager instance (creates if None)
        """
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap

        # Initialize services
        self.embedding_service = embedding_service or get_embedding_service()
        self.qdrant_manager = qdrant_manager or get_qdrant_manager()

        logger.info(f"DocumentChunker initialized (chunk_size={chunk_size}, overlap={chunk_overlap})")

    def chunk_text(
        self,
        text: str,
        metadata: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """
        Split text into chunks with overlap.

        Args:
            text: Text to chunk
            metadata: Optional metadata to attach to chunks

        Returns:
            List of chunk dicts with text and metadata
        """
        if not text or not text.strip():
            logger.warning("Empty text provided for chunking")
            return []

        # Split into sentences (rough approximation)
        sentences = self._split_sentences(text)

        chunks = []
        current_chunk = []
        current_length = 0

        for sentence in sentences:
            sentence_length = self._estimate_tokens(sentence)

            # If adding this sentence exceeds chunk_size, save current chunk
            if current_length + sentence_length > self.chunk_size and current_chunk:
                chunk_text = " ".join(current_chunk)
                chunks.append({
                    "text": chunk_text,
                    "tokens": current_length,
                    "metadata": metadata or {}
                })

                # Keep overlap sentences
                overlap_sentences = self._get_overlap_sentences(
                    current_chunk,
                    self.chunk_overlap
                )

                current_chunk = overlap_sentences
                current_length = sum(self._estimate_tokens(s) for s in current_chunk)

            current_chunk.append(sentence)
            current_length += sentence_length

        # Add final chunk if not empty
        if current_chunk:
            chunk_text = " ".join(current_chunk)
            chunks.append({
                "text": chunk_text,
                "tokens": current_length,
                "metadata": metadata or {}
            })

        logger.debug(f"Chunked text into {len(chunks)} chunks")

        return chunks

    def _split_sentences(self, text: str) -> List[str]:
        """
        Split text into sentences.

        Args:
            text: Text to split

        Returns:
            List of sentences
        """
        # Simple sentence splitting (handles common cases)
        # Regex: Split on . ! ? followed by whitespace and capital letter
        sentences = re.split(r'(?<=[.!?])\s+(?=[A-Z])', text)

        # Clean up whitespace
        sentences = [s.strip() for s in sentences if s.strip()]

        return sentences

    def _get_overlap_sentences(
        self,
        sentences: List[str],
        target_tokens: int
    ) -> List[str]:
        """
        Get sentences from end of list to reach target token count.

        Args:
            sentences: List of sentences
            target_tokens: Target token count

        Returns:
            List of sentences from end
        """
        overlap_sentences = []
        token_count = 0

        # Work backwards from end
        for sentence in reversed(sentences):
            sentence_tokens = self._estimate_tokens(sentence)

            if token_count + sentence_tokens > target_tokens:
                break

            overlap_sentences.insert(0, sentence)
            token_count += sentence_tokens

        return overlap_sentences

    def _estimate_tokens(self, text: str) -> int:
        """
        Estimate token count for text (rough approximation).

        Args:
            text: Text to estimate

        Returns:
            Estimated token count
        """
        # Rough estimate: 1 token ≈ 4 characters
        return len(text) // 4

    def extract_metadata(
        self,
        document_path: str,
        text: str,
        additional_metadata: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Extract metadata from document.

        Args:
            document_path: Path to document
            text: Document text
            additional_metadata: Optional additional metadata

        Returns:
            Metadata dict
        """
        path = Path(document_path)

        metadata = {
            "source": str(path),
            "filename": path.name,
            "extension": path.suffix,
            "size_bytes": len(text),
            "indexed_at": datetime.now().isoformat(),
            "chunk_count": 0  # Will be updated later
        }

        # Extract title (first line or filename)
        first_line = text.split("\n")[0].strip()
        if first_line and len(first_line) < 200:
            metadata["title"] = first_line
        else:
            metadata["title"] = path.stem

        # Add additional metadata
        if additional_metadata:
            metadata.update(additional_metadata)

        return metadata

    def generate_chunk_id(self, chunk_text: str, source: str, chunk_index: int) -> str:
        """
        Generate unique ID for chunk.

        Args:
            chunk_text: Chunk text
            source: Source document path
            chunk_index: Index of chunk in document

        Returns:
            Unique chunk ID (UUID format compatible with Qdrant)
        """
        # Create deterministic UUID from source and chunk index
        content = f"{source}_{chunk_index}_{chunk_text[:100]}"
        # Use UUID5 (namespace + name) for deterministic UUIDs
        return str(uuid.uuid5(uuid.NAMESPACE_DNS, content))

    def index_document(
        self,
        document_path: str,
        text: str,
        collection_name: str = "documents",
        metadata: Optional[Dict[str, Any]] = None,
        batch_size: int = 100,
        use_claude_enhanced: bool = False,
        claude_analysis: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Index document to Qdrant (chunk, embed, store).

        Args:
            document_path: Path to document
            text: Document text
            collection_name: Qdrant collection name
            metadata: Optional metadata
            batch_size: Batch size for embedding generation
            use_claude_enhanced: Use Claude sub-agent for enhanced analysis
            claude_analysis: Pre-computed Claude analysis (if available)

        Returns:
            Indexing result dict
        """
        logger.info(f"Indexing document: {document_path}")

        # Check if Claude-enhanced mode is requested
        if use_claude_enhanced and claude_analysis:
            logger.info("Using Claude-enhanced analysis for indexing")
            return self._index_with_claude_analysis(
                document_path=document_path,
                text=text,
                claude_analysis=claude_analysis,
                collection_name=collection_name,
                metadata=metadata,
                batch_size=batch_size
            )

        # Standard autonomous indexing
        # Extract metadata
        doc_metadata = self.extract_metadata(document_path, text, metadata)

        # Chunk text
        chunks = self.chunk_text(text, metadata=doc_metadata)

        if not chunks:
            logger.warning(f"No chunks generated for {document_path}")
            return {
                "status": "skipped",
                "reason": "no_chunks",
                "document": document_path
            }

        logger.info(f"Generated {len(chunks)} chunks for {document_path}")

        # Update chunk count in metadata
        doc_metadata["chunk_count"] = len(chunks)

        # Generate embeddings for all chunks
        chunk_texts = [chunk["text"] for chunk in chunks]
        embeddings = self.embedding_service.generate_embeddings_batch(
            chunk_texts,
            batch_size=batch_size
        )

        # Create Qdrant points
        points = []
        for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
            if embedding is None:
                logger.warning(f"Failed to generate embedding for chunk {i}")
                continue

            chunk_id = self.generate_chunk_id(
                chunk["text"],
                document_path,
                i
            )

            # Combine document metadata with chunk-specific metadata
            chunk_metadata = {
                **doc_metadata,
                "chunk_index": i,
                "chunk_text": chunk["text"],
                "chunk_tokens": chunk["tokens"]
            }

            point = PointStruct(
                id=chunk_id,
                vector=embedding,
                payload=chunk_metadata
            )

            points.append(point)

        logger.info(f"Created {len(points)} points for indexing")

        # Index to Qdrant
        if points:
            result = self.qdrant_manager.upsert_vectors(
                collection_name=collection_name,
                points=points,
                batch_size=batch_size
            )

            logger.info(f"✅ Indexed {len(points)} chunks from {document_path}")

            return {
                "status": "success",
                "document": document_path,
                "chunks_indexed": len(points),
                "collection": collection_name,
                "metadata": doc_metadata
            }
        else:
            return {
                "status": "error",
                "document": document_path,
                "error": "no_valid_embeddings"
            }

    def _index_with_claude_analysis(
        self,
        document_path: str,
        text: str,
        claude_analysis: Dict[str, Any],
        collection_name: str = "documents",
        metadata: Optional[Dict[str, Any]] = None,
        batch_size: int = 100
    ) -> Dict[str, Any]:
        """
        Index document using Claude-enhanced analysis.

        Args:
            document_path: Path to document
            text: Document text
            claude_analysis: Claude sub-agent analysis output
            collection_name: Qdrant collection name
            metadata: Optional metadata
            batch_size: Batch size for processing

        Returns:
            Indexing result dict with enhanced metadata
        """
        if not claude_analysis.get("success"):
            logger.error(f"Claude analysis failed: {claude_analysis.get('error')}")
            # Fall back to standard indexing
            return self.index_document(
                document_path=document_path,
                text=text,
                collection_name=collection_name,
                metadata=metadata,
                batch_size=batch_size,
                use_claude_enhanced=False
            )

        logger.info(f"Indexing with Claude-enhanced analysis: {document_path}")

        # Extract enhanced metadata from Claude analysis
        analysis_data = claude_analysis["analysis"]
        doc_metadata = metadata or {}

        # Import memory graph service
        try:
            from lib.memory_graph import get_memory_graph_service
            memory_graph = get_memory_graph_service()
            logger.info("Memory graph service loaded for entity extraction")
        except Exception as e:
            logger.warning(f"Memory graph service not available: {e}")
            memory_graph = None

        # Enrich metadata with Claude's understanding
        doc_metadata.update({
            "document_type": analysis_data["classification"]["type"],
            "urgency": analysis_data["classification"]["urgency"],
            "sensitivity": analysis_data["classification"]["sensitivity"],
            "action_required": analysis_data["classification"]["action_required"],
            "executive_summary": analysis_data["executive_summary"],
            "key_topics": analysis_data["metadata"].get("key_topics", []),
            "sentiment": analysis_data["metadata"].get("sentiment", "neutral"),
            "complexity": analysis_data["metadata"].get("complexity", "medium"),
            "claude_enhanced": True
        })

        # Use Claude's semantic chunks or fall back to standard chunking
        semantic_chunks = claude_analysis.get("semantic_chunks", [])

        if semantic_chunks:
            # Use Claude's enhanced chunks
            logger.info(f"Using {len(semantic_chunks)} Claude-generated semantic chunks")
            chunks = []

            for chunk_data in semantic_chunks:
                # Generate embedding using enhanced context
                embeddings_context = claude_analysis.get("embeddings_context", {})
                enhanced_text = f"{embeddings_context.get('use_for_embeddings', '')} {chunk_data['text']}"

                embedding = self.embedding_service.generate_embedding(enhanced_text[:1000])

                if embedding is None:
                    logger.warning(f"Failed to generate embedding for chunk {chunk_data['chunk_index']}")
                    continue

                chunk_id = self.generate_chunk_id(
                    chunk_data["text"],
                    document_path,
                    chunk_data["chunk_index"]
                )

                # Enhanced chunk metadata
                chunk_metadata = {
                    **doc_metadata,
                    "chunk_index": chunk_data["chunk_index"],
                    "chunk_text": chunk_data["text"],
                    "semantic_summary": chunk_data.get("semantic_summary", ""),
                    "importance": chunk_data.get("importance", 0.5),
                    "topics": chunk_data.get("topics", []),
                    "entities_mentioned": chunk_data.get("entities_mentioned", [])
                }

                point = PointStruct(
                    id=chunk_id,
                    vector=embedding,
                    payload=chunk_metadata
                )

                chunks.append(point)
        else:
            # Fall back to standard chunking
            logger.warning("No semantic chunks in Claude analysis, using standard chunking")
            standard_chunks = self.chunk_text(text, metadata=doc_metadata)
            chunks = []

            for i, chunk in enumerate(standard_chunks):
                embedding = self.embedding_service.generate_embedding(chunk["text"])

                if embedding is None:
                    continue

                chunk_id = self.generate_chunk_id(chunk["text"], document_path, i)

                point = PointStruct(
                    id=chunk_id,
                    vector=embedding,
                    payload={**doc_metadata, **chunk}
                )

                chunks.append(point)

        logger.info(f"Created {len(chunks)} enhanced points for indexing")

        # Index to Qdrant
        if chunks:
            result = self.qdrant_manager.upsert_vectors(
                collection_name=collection_name,
                points=chunks,
                batch_size=batch_size
            )

            logger.info(f"✅ Indexed {len(chunks)} Claude-enhanced chunks from {document_path}")

            # Extract entities and relationships to memory graph
            entities_created = 0
            relationships_created = 0
            entity_map = {}  # Map entity names to UUIDs

            if memory_graph:
                try:
                    logger.info("Extracting entities to memory graph...")

                    # Extract people
                    for person in analysis_data.get("entities", {}).get("people", []):
                        entity_id = memory_graph.create_entity(
                            entity_type="person",
                            name=person["name"],
                            attributes={
                                "role": person.get("role"),
                                "email": person.get("email"),
                                "phone": person.get("phone"),
                                "company": person.get("company")
                            },
                            source=document_path,
                            confidence=0.9
                        )
                        entity_map[person["name"]] = entity_id
                        memory_graph.link_document_entity(document_path, entity_id, extraction_method="claude_enhanced")
                        entities_created += 1

                    # Extract companies
                    for company in analysis_data.get("entities", {}).get("companies", []):
                        entity_id = memory_graph.create_entity(
                            entity_type="company",
                            name=company["name"],
                            attributes={"role": company.get("role")},
                            source=document_path,
                            confidence=0.9
                        )
                        entity_map[company["name"]] = entity_id
                        memory_graph.link_document_entity(document_path, entity_id, extraction_method="claude_enhanced")
                        entities_created += 1

                    # Extract projects
                    for project in analysis_data.get("entities", {}).get("projects", []):
                        if isinstance(project, dict):
                            project_name = project.get("name", str(project))
                        else:
                            project_name = str(project)

                        entity_id = memory_graph.create_entity(
                            entity_type="project",
                            name=project_name,
                            attributes=project if isinstance(project, dict) else {},
                            source=document_path,
                            confidence=0.85
                        )
                        entity_map[project_name] = entity_id
                        memory_graph.link_document_entity(document_path, entity_id, extraction_method="claude_enhanced")
                        entities_created += 1

                    # Extract locations
                    for location in analysis_data.get("entities", {}).get("locations", []):
                        location_name = location.get("name") if isinstance(location, dict) else str(location)
                        entity_id = memory_graph.create_entity(
                            entity_type="location",
                            name=location_name,
                            attributes={"type": location.get("type")} if isinstance(location, dict) else {},
                            source=document_path,
                            confidence=0.8
                        )
                        entity_map[location_name] = entity_id
                        memory_graph.link_document_entity(document_path, entity_id, extraction_method="claude_enhanced")
                        entities_created += 1

                    # Extract dates
                    for date_info in analysis_data.get("entities", {}).get("dates", []):
                        date_name = f"{date_info.get('type', 'date')}: {date_info.get('date', 'unknown')}"
                        entity_id = memory_graph.create_entity(
                            entity_type="date",
                            name=date_name,
                            attributes=date_info,
                            source=document_path,
                            confidence=0.95
                        )
                        memory_graph.link_document_entity(document_path, entity_id, extraction_method="claude_enhanced")
                        entities_created += 1

                    # Extract amounts
                    for amount in analysis_data.get("entities", {}).get("amounts", []):
                        amount_name = f"{amount.get('currency', '')} {amount.get('value', 0):,.0f}"
                        entity_id = memory_graph.create_entity(
                            entity_type="amount",
                            name=amount_name,
                            attributes=amount,
                            source=document_path,
                            confidence=0.95
                        )
                        memory_graph.link_document_entity(document_path, entity_id, extraction_method="claude_enhanced")
                        entities_created += 1

                    logger.info(f"✓ Created {entities_created} entities in memory graph")

                    # Extract relationships
                    for relationship in analysis_data.get("relationships", []):
                        from_name = relationship.get("from")
                        to_name = relationship.get("to")

                        # Try to find entity IDs
                        from_id = entity_map.get(from_name)
                        to_id = entity_map.get(to_name)

                        if from_id and to_id:
                            memory_graph.create_relationship(
                                from_entity_id=from_id,
                                to_entity_id=to_id,
                                relationship_type=relationship.get("type", "related_to"),
                                attributes={"context": relationship.get("context")},
                                source=document_path,
                                confidence=0.85
                            )
                            relationships_created += 1
                        else:
                            logger.debug(f"Skipping relationship {from_name} → {to_name} (entities not found)")

                    logger.info(f"✓ Created {relationships_created} relationships in memory graph")

                    # Close memory graph connection
                    memory_graph.close()

                except Exception as e:
                    logger.error(f"Error extracting entities to memory graph: {e}")
                    if memory_graph:
                        memory_graph.close()

            return {
                "status": "success",
                "document": document_path,
                "chunks_indexed": len(chunks),
                "collection": collection_name,
                "metadata": doc_metadata,
                "claude_enhanced": True,
                "entities_extracted": entities_created,
                "relationships_found": relationships_created,
                "action_items": len(analysis_data.get("action_items", [])),
                "memory_graph_populated": entities_created > 0
            }
        else:
            return {
                "status": "error",
                "document": document_path,
                "error": "no_valid_embeddings"
            }

    def index_documents_batch(
        self,
        documents: List[Tuple[str, str]],
        collection_name: str = "documents",
        batch_size: int = 100
    ) -> Dict[str, Any]:
        """
        Index multiple documents in batch.

        Args:
            documents: List of (path, text) tuples
            collection_name: Qdrant collection name
            batch_size: Batch size for processing

        Returns:
            Batch indexing result
        """
        total = len(documents)
        logger.info(f"Starting batch indexing of {total} documents")

        results = {
            "total": total,
            "successful": 0,
            "failed": 0,
            "skipped": 0,
            "details": []
        }

        for i, (path, text) in enumerate(documents):
            try:
                result = self.index_document(
                    document_path=path,
                    text=text,
                    collection_name=collection_name,
                    batch_size=batch_size
                )

                results["details"].append(result)

                if result["status"] == "success":
                    results["successful"] += 1
                elif result["status"] == "skipped":
                    results["skipped"] += 1
                else:
                    results["failed"] += 1

                logger.info(f"Progress: {i+1}/{total} documents processed")

            except Exception as e:
                logger.error(f"Failed to index {path}: {e}")
                results["failed"] += 1
                results["details"].append({
                    "status": "error",
                    "document": path,
                    "error": str(e)
                })

        logger.info(f"✅ Batch indexing complete: {results['successful']}/{total} successful")

        return results

    def reindex_document(
        self,
        document_path: str,
        text: str,
        collection_name: str = "documents"
    ) -> Dict[str, Any]:
        """
        Reindex document (delete old chunks, index new).

        Args:
            document_path: Path to document
            text: Document text
            collection_name: Qdrant collection name

        Returns:
            Reindexing result
        """
        logger.info(f"Reindexing document: {document_path}")

        # Find existing chunks for this document
        # (Would need to implement search by metadata in qdrant_manager)
        # For now, just index (upsert will replace if IDs match)

        result = self.index_document(
            document_path=document_path,
            text=text,
            collection_name=collection_name
        )

        return result

    def get_statistics(self) -> Dict[str, Any]:
        """
        Get chunking and indexing statistics.

        Returns:
            Statistics dict
        """
        stats = {
            "chunk_size": self.chunk_size,
            "chunk_overlap": self.chunk_overlap,
            "embedding_service": self.embedding_service.get_statistics(),
            "qdrant": self.qdrant_manager.get_statistics()
        }

        return stats


# ============================================================================
# CONVENIENCE FUNCTIONS
# ============================================================================

_document_chunker_instance = None


def get_document_chunker(
    chunk_size: int = 500,
    chunk_overlap: int = 50
) -> DocumentChunker:
    """
    Get or create singleton DocumentChunker instance.

    Args:
        chunk_size: Target chunk size in tokens
        chunk_overlap: Overlap between chunks in tokens

    Returns:
        DocumentChunker instance
    """
    global _document_chunker_instance

    if _document_chunker_instance is None:
        _document_chunker_instance = DocumentChunker(
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap
        )

    return _document_chunker_instance


def index_document(
    document_path: str,
    text: str,
    collection_name: str = "documents",
    metadata: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Convenience function to index a document.

    Args:
        document_path: Path to document
        text: Document text
        collection_name: Qdrant collection name
        metadata: Optional metadata

    Returns:
        Indexing result
    """
    chunker = get_document_chunker()
    return chunker.index_document(
        document_path=document_path,
        text=text,
        collection_name=collection_name,
        metadata=metadata
    )


def index_documents_batch(
    documents: List[Tuple[str, str]],
    collection_name: str = "documents"
) -> Dict[str, Any]:
    """
    Convenience function to index multiple documents.

    Args:
        documents: List of (path, text) tuples
        collection_name: Qdrant collection name

    Returns:
        Batch indexing result
    """
    chunker = get_document_chunker()
    return chunker.index_documents_batch(
        documents=documents,
        collection_name=collection_name
    )


if __name__ == "__main__":
    # Test document chunking and indexing
    print("=" * 80)
    print("DOCUMENT CHUNKER - TEST")
    print("=" * 80)
    print()

    # Initialize chunker
    chunker = get_document_chunker(chunk_size=500, chunk_overlap=50)

    # Get statistics
    stats = chunker.get_statistics()
    print("1. Service Statistics:")
    print(f"   Chunk Size: {stats['chunk_size']} tokens")
    print(f"   Chunk Overlap: {stats['chunk_overlap']} tokens")
    print(f"   Embedding Model: {stats['embedding_service']['primary_model']}")
    print(f"   Vector Dimension: {stats['embedding_service']['vector_dimension']}")
    print()

    # Test chunking
    print("2. Text Chunking Test:")
    sample_text = """
    This is a sample document about the BOSS project. BOSS is a Business Operating System
    Solution that provides intelligent automation for business operations. It includes
    email management, WhatsApp integration, document processing, and financial intelligence.

    The system uses a memory graph to track relationships between people, projects, and companies.
    It also uses RAG (Retrieval-Augmented Generation) for semantic search across documents.

    BOSS is built using PostgreSQL, Qdrant, and various AI models for natural language processing.
    The architecture is designed to be cost-effective, using free tools where possible and
    paid APIs only when necessary.
    """

    chunks = chunker.chunk_text(
        sample_text,
        metadata={"type": "sample", "project": "BOSS"}
    )

    print(f"   ✅ Generated {len(chunks)} chunks")
    for i, chunk in enumerate(chunks):
        print(f"   Chunk {i+1}: {chunk['tokens']} tokens")
        print(f"      Preview: {chunk['text'][:100]}...")
    print()

    # Test metadata extraction
    print("3. Metadata Extraction Test:")
    metadata = chunker.extract_metadata(
        document_path="/docs/boss_overview.txt",
        text=sample_text
    )
    print(f"   Title: {metadata['title']}")
    print(f"   Source: {metadata['source']}")
    print(f"   Size: {metadata['size_bytes']} bytes")
    print()

    # Test document indexing (if Qdrant is available)
    print("4. Document Indexing Test:")
    print("   (Skipping - requires Qdrant connection)")
    print("   Use: chunker.index_document(path, text) to test")
    print()

    print("=" * 80)
    print("✅ DOCUMENT CHUNKER TEST COMPLETE")
    print("=" * 80)
