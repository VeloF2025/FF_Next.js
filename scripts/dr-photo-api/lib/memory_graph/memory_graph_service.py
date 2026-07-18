"""
Memory Graph Service for BOSS

Manages entities, relationships, and graph traversal in PostgreSQL.
Integrates with RAG engine for hybrid semantic + graph search.

Author: BOSS Development Team
Date: 2025-11-15
Updated: 2025-12-02 (Connection pooling integration)
"""

import logging
from typing import Dict, List, Optional, Tuple, Any
from datetime import datetime
import json
import uuid

import psycopg2
import psycopg2.extras
from psycopg2.extensions import register_adapter, AsIs
import numpy as np

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Connection pool integration
try:
    from lib.db import get_connection as get_pooled_connection
    POOL_AVAILABLE = True
except ImportError:
    POOL_AVAILABLE = False
    logger.debug("Connection pool not available, using direct connections")

# Register numpy array adapter for pgvector
def adapt_numpy_array(numpy_array):
    return AsIs(f"'[{','.join(map(str, numpy_array))}]'")

register_adapter(np.ndarray, adapt_numpy_array)


class MemoryGraphService:
    """
    Service for managing knowledge graph entities and relationships.

    Features:
    - Entity CRUD (people, companies, projects, documents, locations, dates, amounts)
    - Relationship management (typed edges between entities)
    - Graph traversal (BFS, DFS, shortest path)
    - Semantic search on entities (vector similarity)
    - Integration with RAG engine
    """

    def __init__(
        self,
        host: str = "localhost",
        port: int = 5432,
        database: str = "boss_production",
        user: str = "boss_admin",
        password: str = None,
        use_pool: bool = True
    ):
        """Initialize Memory Graph Service."""
        self.host = host
        self.port = port
        self.database = database
        self.user = user
        self.password = password
        self.use_pool = use_pool and POOL_AVAILABLE

        self.conn = None
        self._pool_context = None
        self._connect()

        logger.info(f"MemoryGraphService initialized (database: {database}, pool={self.use_pool})")

    def _connect(self):
        """Establish database connection (from pool or direct)."""
        try:
            if self.use_pool:
                # Use connection pool
                self._pool_context = get_pooled_connection(autocommit=True)
                self.conn = self._pool_context.__enter__()
                logger.debug("Got connection from pool")
            else:
                # Direct connection (fallback)
                self.conn = psycopg2.connect(
                    host=self.host,
                    port=self.port,
                    database=self.database,
                    user=self.user,
                    password=self.password
                )
                self.conn.autocommit = True
                logger.info("Connected to PostgreSQL memory graph (direct)")
        except Exception as e:
            logger.error(f"Failed to connect to PostgreSQL: {e}")
            raise

    def _close(self):
        """Close/return database connection."""
        if self.use_pool and self._pool_context:
            self._pool_context.__exit__(None, None, None)
            self._pool_context = None
            self.conn = None
            logger.debug("Returned connection to pool")
        elif self.conn and not self.conn.closed:
            self.conn.close()
            logger.info("Closed PostgreSQL connection")

    def _execute(self, query: str, params: tuple = None, fetch: str = "all") -> Any:
        """Execute SQL query with error handling."""
        try:
            cursor = self.conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cursor.execute(query, params)

            if fetch == "one":
                return cursor.fetchone()
            elif fetch == "all":
                return cursor.fetchall()
            else:  # No fetch (INSERT/UPDATE/DELETE)
                return cursor.rowcount

        except Exception as e:
            logger.error(f"SQL error: {e}")
            logger.error(f"Query: {query}")
            raise

    # ========================================================================
    # ENTITY MANAGEMENT
    # ========================================================================

    def create_entity(
        self,
        entity_type: str,
        name: str,
        attributes: Dict[str, Any] = None,
        embedding: np.ndarray = None,
        source: str = None,
        confidence: float = 1.0
    ) -> str:
        """
        Create new entity in memory graph.

        Args:
            entity_type: person, company, project, document, location, date, amount
            name: Entity name
            attributes: JSONB attributes (email, phone, role, etc.)
            embedding: 384-dim vector (Sentence Transformers)
            source: Document/source where entity was extracted
            confidence: Extraction confidence (0.0-1.0)

        Returns:
            UUID of created entity
        """
        query = """
            INSERT INTO entities (
                entity_type, name, attributes, embedding, source, confidence
            )
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id
        """

        params = (
            entity_type,
            name,
            json.dumps(attributes or {}),
            embedding.tolist() if embedding is not None else None,
            source,
            confidence
        )

        result = self._execute(query, params, fetch="one")
        entity_id = str(result['id'])

        logger.info(f"✓ Created entity: {entity_type}/{name} ({entity_id})")
        return entity_id

    def get_entity(self, entity_id: str) -> Optional[Dict[str, Any]]:
        """Get entity by ID."""
        query = "SELECT * FROM entities WHERE id = %s AND deleted_at IS NULL"
        result = self._execute(query, (entity_id,), fetch="one")

        if result:
            return dict(result)
        return None

    def find_entities(
        self,
        entity_type: str = None,
        name_pattern: str = None,
        attributes_filter: Dict[str, Any] = None,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """
        Find entities matching criteria.

        Args:
            entity_type: Filter by type
            name_pattern: SQL LIKE pattern for name
            attributes_filter: JSONB containment filter
            limit: Max results

        Returns:
            List of entities
        """
        conditions = ["deleted_at IS NULL"]
        params = []

        if entity_type:
            conditions.append("entity_type = %s")
            params.append(entity_type)

        if name_pattern:
            conditions.append("name ILIKE %s")
            params.append(name_pattern)

        if attributes_filter:
            conditions.append("attributes @> %s")
            params.append(json.dumps(attributes_filter))

        query = f"""
            SELECT * FROM entities
            WHERE {' AND '.join(conditions)}
            ORDER BY created_at DESC
            LIMIT %s
        """
        params.append(limit)

        results = self._execute(query, tuple(params), fetch="all")
        return [dict(r) for r in results]

    def update_entity(
        self,
        entity_id: str,
        name: str = None,
        attributes: Dict[str, Any] = None,
        embedding: np.ndarray = None
    ) -> bool:
        """Update entity attributes."""
        updates = []
        params = []

        if name:
            updates.append("name = %s")
            params.append(name)

        if attributes:
            updates.append("attributes = attributes || %s")
            params.append(json.dumps(attributes))

        if embedding is not None:
            updates.append("embedding = %s")
            params.append(embedding.tolist())

        if not updates:
            return False

        query = f"""
            UPDATE entities
            SET {', '.join(updates)}
            WHERE id = %s AND deleted_at IS NULL
        """
        params.append(entity_id)

        rowcount = self._execute(query, tuple(params), fetch=None)
        return rowcount > 0

    def delete_entity(self, entity_id: str, soft: bool = True) -> bool:
        """
        Delete entity (soft or hard delete).

        Args:
            entity_id: Entity to delete
            soft: If True, set deleted_at timestamp; if False, remove from DB

        Returns:
            True if deleted
        """
        if soft:
            query = "UPDATE entities SET deleted_at = CURRENT_TIMESTAMP WHERE id = %s"
        else:
            query = "DELETE FROM entities WHERE id = %s"

        rowcount = self._execute(query, (entity_id,), fetch=None)
        logger.info(f"✓ Deleted entity: {entity_id} (soft={soft})")
        return rowcount > 0

    # ========================================================================
    # RELATIONSHIP MANAGEMENT
    # ========================================================================

    def create_relationship(
        self,
        from_entity_id: str,
        to_entity_id: str,
        relationship_type: str,
        attributes: Dict[str, Any] = None,
        source: str = None,
        confidence: float = 1.0,
        strength: float = 0.5
    ) -> str:
        """
        Create relationship between entities.

        Args:
            from_entity_id: Source entity UUID
            to_entity_id: Target entity UUID
            relationship_type: works_for, manages, owns, client_of, etc.
            attributes: JSONB attributes (context, start_date, etc.)
            source: Document where relationship was found
            confidence: Extraction confidence (0.0-1.0)
            strength: Relationship strength (0.0-1.0)

        Returns:
            UUID of created relationship
        """
        query = """
            INSERT INTO relationships (
                from_entity_id, to_entity_id, relationship_type,
                attributes, source, confidence, strength
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (from_entity_id, to_entity_id, relationship_type)
            DO UPDATE SET
                attributes = relationships.attributes || EXCLUDED.attributes,
                updated_at = CURRENT_TIMESTAMP
            RETURNING id
        """

        params = (
            from_entity_id,
            to_entity_id,
            relationship_type,
            json.dumps(attributes or {}),
            source,
            confidence,
            strength
        )

        result = self._execute(query, params, fetch="one")
        relationship_id = str(result['id'])

        logger.info(f"✓ Created relationship: {relationship_type} ({relationship_id})")
        return relationship_id

    def get_relationships(
        self,
        entity_id: str,
        direction: str = "both",
        relationship_type: str = None
    ) -> List[Dict[str, Any]]:
        """
        Get relationships for an entity.

        Args:
            entity_id: Entity UUID
            direction: "outgoing", "incoming", or "both"
            relationship_type: Filter by relationship type

        Returns:
            List of relationships
        """
        conditions = ["r.deleted_at IS NULL"]
        params = []

        if direction == "outgoing":
            conditions.append("r.from_entity_id = %s")
            params.append(entity_id)
        elif direction == "incoming":
            conditions.append("r.to_entity_id = %s")
            params.append(entity_id)
        else:  # both
            conditions.append("(r.from_entity_id = %s OR r.to_entity_id = %s)")
            params.extend([entity_id, entity_id])

        if relationship_type:
            conditions.append("r.relationship_type = %s")
            params.append(relationship_type)

        query = f"""
            SELECT
                r.*,
                e_from.name AS from_entity_name,
                e_from.entity_type AS from_entity_type,
                e_to.name AS to_entity_name,
                e_to.entity_type AS to_entity_type
            FROM relationships r
            JOIN entities e_from ON r.from_entity_id = e_from.id
            JOIN entities e_to ON r.to_entity_id = e_to.id
            WHERE {' AND '.join(conditions)}
            ORDER BY r.created_at DESC
        """

        results = self._execute(query, tuple(params), fetch="all")
        return [dict(r) for r in results]

    def delete_relationship(self, relationship_id: str, soft: bool = True) -> bool:
        """Delete relationship (soft or hard)."""
        if soft:
            query = "UPDATE relationships SET deleted_at = CURRENT_TIMESTAMP WHERE id = %s"
        else:
            query = "DELETE FROM relationships WHERE id = %s"

        rowcount = self._execute(query, (relationship_id,), fetch=None)
        logger.info(f"✓ Deleted relationship: {relationship_id} (soft={soft})")
        return rowcount > 0

    # ========================================================================
    # GRAPH TRAVERSAL
    # ========================================================================

    def traverse_graph(
        self,
        start_entity_id: str,
        max_depth: int = 3,
        relationship_filter: str = None
    ) -> List[Dict[str, Any]]:
        """
        Traverse graph from starting entity using BFS.

        Args:
            start_entity_id: Starting entity UUID
            max_depth: Maximum traversal depth
            relationship_filter: Filter by relationship type

        Returns:
            List of connected entities with depth and path
        """
        query = "SELECT * FROM traverse_graph(%s, %s, %s)"
        params = (start_entity_id, max_depth, relationship_filter)

        results = self._execute(query, params, fetch="all")
        return [dict(r) for r in results]

    def find_shortest_path(
        self,
        start_entity_id: str,
        end_entity_id: str,
        max_depth: int = 5
    ) -> Optional[Dict[str, Any]]:
        """
        Find shortest path between two entities.

        Args:
            start_entity_id: Source entity UUID
            end_entity_id: Target entity UUID
            max_depth: Maximum path length

        Returns:
            Path dict with length, entity_path, relationship_types
        """
        query = "SELECT * FROM find_shortest_path(%s, %s, %s)"
        params = (start_entity_id, end_entity_id, max_depth)

        result = self._execute(query, params, fetch="one")
        return dict(result) if result else None

    def get_entity_network(
        self,
        entity_id: str,
        max_depth: int = 2
    ) -> Dict[str, Any]:
        """
        Get complete network around an entity.

        Returns:
            Dict with nodes (entities) and edges (relationships)
        """
        # Get all connected entities
        traversal = self.traverse_graph(entity_id, max_depth=max_depth)

        entity_ids = [str(entity_id)] + [str(row['entity_id']) for row in traversal]

        # Get all relationships between these entities
        query = """
            SELECT * FROM relationships
            WHERE deleted_at IS NULL
            AND from_entity_id = ANY(%s::uuid[])
            AND to_entity_id = ANY(%s::uuid[])
        """
        relationships = self._execute(query, (entity_ids, entity_ids), fetch="all")

        # Get full entity data
        query = "SELECT * FROM entities WHERE id = ANY(%s::uuid[]) AND deleted_at IS NULL"
        entities = self._execute(query, (entity_ids,), fetch="all")

        return {
            "nodes": [dict(e) for e in entities],
            "edges": [dict(r) for r in relationships],
            "center_entity_id": str(entity_id),
            "max_depth": max_depth
        }

    # ========================================================================
    # SEMANTIC SEARCH
    # ========================================================================

    def search_entities_semantic(
        self,
        query_embedding: np.ndarray,
        similarity_threshold: float = 0.7,
        entity_type: str = None,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """
        Search entities by vector similarity.

        Args:
            query_embedding: 384-dim query vector
            similarity_threshold: Minimum cosine similarity
            entity_type: Filter by type
            limit: Max results

        Returns:
            List of entities with similarity scores
        """
        # Use database function for semantic search
        if entity_type:
            query = """
                SELECT * FROM search_entities_semantic(%s, %s, %s)
                WHERE entity_type = %s
            """
            params = (query_embedding.tolist(), similarity_threshold, limit, entity_type)
        else:
            query = "SELECT * FROM search_entities_semantic(%s, %s, %s)"
            params = (query_embedding.tolist(), similarity_threshold, limit)

        results = self._execute(query, params, fetch="all")
        return [dict(r) for r in results]

    # ========================================================================
    # DOCUMENT INTEGRATION
    # ========================================================================

    def link_document_entity(
        self,
        document_path: str,
        entity_id: str,
        mention_count: int = 1,
        extraction_method: str = "autonomous",
        confidence: float = 1.0
    ) -> str:
        """
        Link document to extracted entity.

        Args:
            document_path: Path to source document
            entity_id: Entity UUID
            mention_count: How many times entity mentioned
            extraction_method: autonomous, claude_enhanced, manual
            confidence: Extraction confidence

        Returns:
            UUID of document_entity record
        """
        query = """
            INSERT INTO document_entities (
                document_path, entity_id, mention_count, extraction_method, confidence
            )
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (document_path, entity_id)
            DO UPDATE SET
                mention_count = document_entities.mention_count + EXCLUDED.mention_count
            RETURNING id
        """

        params = (document_path, entity_id, mention_count, extraction_method, confidence)
        result = self._execute(query, params, fetch="one")
        return str(result['id'])

    def get_document_entities(self, document_path: str) -> List[Dict[str, Any]]:
        """Get all entities extracted from a document."""
        query = """
            SELECT
                de.*,
                e.entity_type,
                e.name AS entity_name,
                e.attributes
            FROM document_entities de
            JOIN entities e ON de.entity_id = e.id
            WHERE de.document_path = %s AND e.deleted_at IS NULL
            ORDER BY de.mention_count DESC
        """

        results = self._execute(query, (document_path,), fetch="all")
        return [dict(r) for r in results]

    def get_entity_documents(self, entity_id: str) -> List[str]:
        """Get all documents mentioning an entity."""
        query = """
            SELECT DISTINCT document_path, created_at
            FROM document_entities
            WHERE entity_id = %s
            ORDER BY created_at DESC
        """

        results = self._execute(query, (entity_id,), fetch="all")
        return [r['document_path'] for r in results]

    # ========================================================================
    # STATISTICS & ANALYTICS
    # ========================================================================

    def get_stats(self) -> Dict[str, Any]:
        """Get memory graph statistics."""
        query = """
            SELECT
                (SELECT COUNT(*) FROM entities WHERE deleted_at IS NULL) AS total_entities,
                (SELECT COUNT(*) FROM relationships WHERE deleted_at IS NULL) AS total_relationships,
                (SELECT COUNT(DISTINCT document_path) FROM document_entities) AS total_documents,
                (SELECT COUNT(*) FROM events) AS total_events
        """

        result = self._execute(query, fetch="one")
        stats = dict(result)

        # Count by entity type
        query = """
            SELECT entity_type, COUNT(*) AS count
            FROM entities
            WHERE deleted_at IS NULL
            GROUP BY entity_type
            ORDER BY count DESC
        """
        type_counts = self._execute(query, fetch="all")
        stats["entities_by_type"] = {row['entity_type']: row['count'] for row in type_counts}

        # Count by relationship type
        query = """
            SELECT relationship_type, COUNT(*) AS count
            FROM relationships
            WHERE deleted_at IS NULL
            GROUP BY relationship_type
            ORDER BY count DESC
        """
        rel_counts = self._execute(query, fetch="all")
        stats["relationships_by_type"] = {row['relationship_type']: row['count'] for row in rel_counts}

        return stats

    def close(self):
        """Close database connection."""
        if self.conn:
            self.conn.close()
            logger.info("Memory graph connection closed")


def get_memory_graph_service() -> MemoryGraphService:
    """Factory function to get MemoryGraphService instance."""
    import os
    from dotenv import load_dotenv
    load_dotenv()

    return MemoryGraphService(
        host=os.getenv("POSTGRES_HOST", "localhost"),
        port=int(os.getenv("POSTGRES_PORT", "5432")),
        database=os.getenv("POSTGRES_DB", "boss_production"),
        user=os.getenv("POSTGRES_USER", "boss_admin"),
        password=os.getenv("POSTGRES_PASSWORD")
    )


if __name__ == "__main__":
    # Test the service
    mg = get_memory_graph_service()

    print("\n" + "="*80)
    print("MEMORY GRAPH SERVICE TEST")
    print("="*80)

    # Get stats
    stats = mg.get_stats()
    print("\nCurrent Statistics:")
    print(f"  Entities: {stats['total_entities']}")
    print(f"  Relationships: {stats['total_relationships']}")
    print(f"  Documents: {stats['total_documents']}")
    print(f"  Events: {stats['total_events']}")

    print("\n" + "="*80)
    print("SERVICE READY")
    print("="*80)

    mg.close()
