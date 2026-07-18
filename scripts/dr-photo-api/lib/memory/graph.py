"""
BOSS Memory Graph Service

Purpose: Python interface for PostgreSQL-based memory graph
Features: Entity management, relationship creation, graph traversal
Architecture: Connection pooling with pgvector support

Generated: 2025-11-15
Updated: 2025-12-02 (Connection pooling integration)
Authority: Phase 5 - Knowledge Layer Implementation
"""

import os
import uuid
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime
import psycopg2
from psycopg2 import sql
from psycopg2.extras import RealDictCursor, Json
import logging

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


class MemoryGraph:
    """
    Memory Graph Service - PostgreSQL-based graph database

    Provides CRUD operations for entities, relationships, and events.
    Supports semantic search via pgvector and graph traversal via recursive CTEs.
    """

    def __init__(self, database_url: Optional[str] = None, use_pool: bool = True):
        """
        Initialize Memory Graph connection.

        Args:
            database_url: PostgreSQL connection string (defaults to env var DATABASE_URL)
            use_pool: Use connection pool if available (default: True)
        """
        self.use_pool = use_pool and POOL_AVAILABLE
        self.database_url = database_url or os.getenv("DATABASE_URL")

        if not self.database_url:
            # Construct from individual env vars
            host = os.getenv("POSTGRES_HOST", "localhost")
            port = os.getenv("POSTGRES_PORT", "5432")
            db = os.getenv("POSTGRES_DB", "boss_production")
            user = os.getenv("POSTGRES_USER", "boss_admin")
            password = os.getenv("POSTGRES_PASSWORD")

            if not password:
                raise ValueError("POSTGRES_PASSWORD not found in environment")

            self.database_url = f"postgresql://{user}:{password}@{host}:{port}/{db}"

        self.conn = None
        self._pool_context = None
        logger.info(f"Memory Graph initialized (pool={self.use_pool})")

    def connect(self):
        """Establish database connection (from pool or direct)."""
        if self.use_pool:
            # Use connection pool - get context manager
            self._pool_context = get_pooled_connection()
            self.conn = self._pool_context.__enter__()
            logger.debug("Got connection from pool")
        else:
            # Direct connection (fallback)
            if self.conn is None or self.conn.closed:
                self.conn = psycopg2.connect(self.database_url)
                logger.info("Connected to PostgreSQL memory graph (direct)")

    def close(self):
        """Close/return database connection."""
        if self.use_pool and self._pool_context:
            # Return connection to pool
            self._pool_context.__exit__(None, None, None)
            self._pool_context = None
            self.conn = None
            logger.debug("Returned connection to pool")
        elif self.conn and not self.conn.closed:
            self.conn.close()
            logger.info("Closed PostgreSQL connection")

    def __enter__(self):
        """Context manager entry."""
        self.connect()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit."""
        self.close()

    # ========================================================================
    # ENTITY OPERATIONS
    # ========================================================================

    def create_entity(
        self,
        entity_type: str,
        name: str,
        metadata: Optional[Dict[str, Any]] = None,
        embedding: Optional[List[float]] = None
    ) -> str:
        """
        Create a new entity in the memory graph.

        Args:
            entity_type: Type of entity (person, project, company, document, etc.)
            name: Entity name
            metadata: Optional metadata dict (stored as JSONB)
            embedding: Optional vector embedding (1536 dimensions)

        Returns:
            UUID of created entity

        Example:
            entity_id = graph.create_entity(
                entity_type="person",
                name="John Smith",
                metadata={"email": "john@example.com", "role": "CFO"}
            )
        """
        self.connect()

        entity_id = str(uuid.uuid4())
        metadata = metadata or {}

        try:
            with self.conn.cursor() as cursor:
                cursor.execute("""
                    INSERT INTO entities (id, entity_type, name, attributes, embedding)
                    VALUES (%s, %s, %s, %s, %s)
                    RETURNING id
                """, (entity_id, entity_type, name, Json(metadata), embedding))

                self.conn.commit()
                result = cursor.fetchone()[0]

                logger.info(f"Created entity: {entity_type}/{name} ({result})")
                return result
        except Exception as e:
            self.conn.rollback()
            logger.error(f"Failed to create entity {entity_type}/{name}: {e}")
            raise

    def get_or_create_entity(
        self,
        entity_type: str,
        name: str,
        metadata: Optional[Dict[str, Any]] = None,
        embedding: Optional[List[float]] = None,
        match_email: bool = True,
        match_phone: bool = True
    ) -> Tuple[str, bool]:
        """
        Get existing entity or create new one with deduplication.

        Deduplication strategy:
        1. Exact match on (entity_type, normalized_name)
        2. Match on email if provided and match_email=True
        3. Match on phone if provided and match_phone=True
        4. Fuzzy match on name variants (handles "John Smith" vs "J. Smith")

        Args:
            entity_type: Type of entity
            name: Entity name
            metadata: Optional metadata dict
            embedding: Optional vector embedding
            match_email: Whether to match on email address
            match_phone: Whether to match on phone number

        Returns:
            Tuple of (entity_id, created) where created is True if new entity
        """
        self.connect()
        metadata = metadata or {}

        # Normalize name for comparison
        normalized_name = self._normalize_name(name)

        try:
            with self.conn.cursor(cursor_factory=RealDictCursor) as cursor:
                # Strategy 1: Exact match on type and normalized name
                cursor.execute("""
                    SELECT id, name, attributes FROM entities
                    WHERE entity_type = %s
                    AND LOWER(TRIM(name)) = LOWER(%s)
                    AND deleted_at IS NULL
                    LIMIT 1
                """, (entity_type, normalized_name))

                existing = cursor.fetchone()
                if existing:
                    # Merge metadata
                    self._merge_entity_metadata(existing['id'], metadata, cursor)
                    return existing['id'], False

                # Strategy 2: Match on email
                email = metadata.get('email')
                if match_email and email:
                    cursor.execute("""
                        SELECT id, name, attributes FROM entities
                        WHERE entity_type = %s
                        AND attributes->>'email' = %s
                        AND deleted_at IS NULL
                        LIMIT 1
                    """, (entity_type, email.lower()))

                    existing = cursor.fetchone()
                    if existing:
                        self._merge_entity_metadata(existing['id'], metadata, cursor)
                        # Update name if current one is more complete
                        if len(name) > len(existing['name']):
                            cursor.execute("""
                                UPDATE entities SET name = %s WHERE id = %s
                            """, (name, existing['id']))
                        self.conn.commit()
                        return existing['id'], False

                # Strategy 3: Match on phone
                phone = metadata.get('phone')
                if match_phone and phone:
                    # Normalize phone for comparison (remove non-digits)
                    normalized_phone = ''.join(filter(str.isdigit, phone))[-10:]
                    cursor.execute("""
                        SELECT id, name, attributes FROM entities
                        WHERE entity_type = %s
                        AND REGEXP_REPLACE(attributes->>'phone', '[^0-9]', '', 'g') LIKE %s
                        AND deleted_at IS NULL
                        LIMIT 1
                    """, (entity_type, f'%{normalized_phone}'))

                    existing = cursor.fetchone()
                    if existing:
                        self._merge_entity_metadata(existing['id'], metadata, cursor)
                        self.conn.commit()
                        return existing['id'], False

                # Strategy 4: Fuzzy name match for persons
                if entity_type == 'person' and ' ' in normalized_name:
                    # Try matching on email domain + first name
                    name_parts = normalized_name.lower().split()
                    if len(name_parts) >= 2:
                        cursor.execute("""
                            SELECT id, name, attributes FROM entities
                            WHERE entity_type = 'person'
                            AND (
                                LOWER(name) LIKE %s
                                OR LOWER(name) LIKE %s
                            )
                            AND deleted_at IS NULL
                            LIMIT 1
                        """, (
                            f'{name_parts[0]}%{name_parts[-1]}%',
                            f'%{name_parts[-1]}%, {name_parts[0]}%'
                        ))

                        existing = cursor.fetchone()
                        if existing:
                            self._merge_entity_metadata(existing['id'], metadata, cursor)
                            self.conn.commit()
                            return existing['id'], False

                # No match found - create new entity
                entity_id = str(uuid.uuid4())
                cursor.execute("""
                    INSERT INTO entities (id, entity_type, name, attributes, embedding)
                    VALUES (%s, %s, %s, %s, %s)
                    RETURNING id
                """, (entity_id, entity_type, name, Json(metadata), embedding))

                self.conn.commit()
                result = cursor.fetchone()['id']
                logger.info(f"Created new entity: {entity_type}/{name} ({result})")
                return result, True

        except Exception as e:
            self.conn.rollback()
            logger.error(f"Failed to get_or_create entity {entity_type}/{name}: {e}")
            raise

    def _normalize_name(self, name: str) -> str:
        """Normalize name for comparison."""
        if not name:
            return ""
        # Remove extra whitespace, lowercase
        normalized = ' '.join(name.split()).strip()
        return normalized

    def _merge_entity_metadata(self, entity_id: str, new_metadata: Dict[str, Any], cursor) -> None:
        """Merge new metadata into existing entity (non-destructive)."""
        if not new_metadata:
            return

        # Get existing metadata
        cursor.execute("""
            SELECT attributes FROM entities WHERE id = %s
        """, (entity_id,))
        result = cursor.fetchone()
        if not result:
            return

        existing = result['attributes'] or {}

        # Merge: keep existing values, add new ones
        merged = {**new_metadata, **existing}  # existing takes precedence

        # But for arrays like 'emails' or 'phones', merge the lists
        for key in ['emails', 'phones', 'sources']:
            if key in new_metadata and key in existing:
                existing_list = existing.get(key, [])
                new_list = new_metadata.get(key, [])
                merged[key] = list(set(existing_list + new_list))

        cursor.execute("""
            UPDATE entities SET attributes = %s, updated_at = CURRENT_TIMESTAMP
            WHERE id = %s
        """, (Json(merged), entity_id))

    def get_entity(self, entity_id: str) -> Optional[Dict[str, Any]]:
        """
        Get entity by ID.

        Args:
            entity_id: UUID of entity

        Returns:
            Dict with entity data or None if not found
        """
        self.connect()

        with self.conn.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute("""
                SELECT id, entity_type as type, name, attributes as metadata, created_at, updated_at
                FROM entities
                WHERE id = %s AND deleted_at IS NULL
            """, (entity_id,))

            result = cursor.fetchone()
            return dict(result) if result else None

    def get_entity_by_name(
        self,
        name: str,
        entity_type: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """
        Get entity by name (optionally filtered by type).

        Args:
            name: Entity name
            entity_type: Optional entity type filter

        Returns:
            Dict with entity data or None if not found
        """
        self.connect()

        with self.conn.cursor(cursor_factory=RealDictCursor) as cursor:
            if entity_type:
                cursor.execute("""
                    SELECT id, entity_type as type, name, attributes as metadata, created_at, updated_at
                    FROM entities
                    WHERE name = %s AND entity_type = %s AND deleted_at IS NULL
                    LIMIT 1
                """, (name, entity_type))
            else:
                cursor.execute("""
                    SELECT id, entity_type as type, name, attributes as metadata, created_at, updated_at
                    FROM entities
                    WHERE name = %s AND deleted_at IS NULL
                    LIMIT 1
                """, (name,))

            result = cursor.fetchone()
            return dict(result) if result else None

    def update_entity(
        self,
        entity_id: str,
        name: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        embedding: Optional[List[float]] = None
    ) -> bool:
        """
        Update entity properties.

        Args:
            entity_id: UUID of entity to update
            name: New name (optional)
            metadata: New metadata dict (optional, merges with existing)
            embedding: New embedding vector (optional)

        Returns:
            True if entity was updated, False if not found
        """
        self.connect()

        updates = []
        params = []

        if name is not None:
            updates.append("name = %s")
            params.append(name)

        if metadata is not None:
            # Merge with existing metadata
            updates.append("attributes = attributes || %s::jsonb")
            params.append(Json(metadata))

        if embedding is not None:
            updates.append("embedding = %s")
            params.append(embedding)

        if not updates:
            return False

        params.append(entity_id)

        with self.conn.cursor() as cursor:
            query = sql.SQL("""
                UPDATE entities
                SET {updates}
                WHERE id = %s AND deleted_at IS NULL
            """).format(updates=sql.SQL(", ").join(map(sql.SQL, updates)))

            cursor.execute(query, params)
            self.conn.commit()

            updated = cursor.rowcount > 0
            if updated:
                logger.info(f"Updated entity: {entity_id}")

            return updated

    def delete_entity(self, entity_id: str) -> bool:
        """
        Soft-delete an entity.

        Args:
            entity_id: UUID of entity to delete

        Returns:
            True if entity was deleted, False if not found
        """
        self.connect()

        with self.conn.cursor() as cursor:
            cursor.execute("""
                UPDATE entities
                SET deleted_at = CURRENT_TIMESTAMP
                WHERE id = %s AND deleted_at IS NULL
            """, (entity_id,))

            self.conn.commit()
            deleted = cursor.rowcount > 0

            if deleted:
                logger.info(f"Deleted entity: {entity_id}")

            return deleted

    # ========================================================================
    # RELATIONSHIP OPERATIONS
    # ========================================================================

    def create_relationship(
        self,
        from_entity_id: str,
        to_entity_id: str,
        relationship_type: str,
        strength: float = 1.0,
        metadata: Optional[Dict[str, Any]] = None
    ) -> str:
        """
        Create a relationship between two entities.

        Args:
            from_entity_id: UUID of source entity
            to_entity_id: UUID of target entity
            relationship_type: Type of relationship (works_on, owns, etc.)
            strength: Relationship strength (0.0 to 1.0)
            metadata: Optional metadata dict

        Returns:
            UUID of created relationship

        Example:
            rel_id = graph.create_relationship(
                from_entity_id=person_id,
                to_entity_id=project_id,
                relationship_type="works_on",
                strength=0.9,
                metadata={"role": "Lead Developer", "since": "2024-01-01"}
            )
        """
        self.connect()

        relationship_id = str(uuid.uuid4())
        metadata = metadata or {}

        try:
            with self.conn.cursor() as cursor:
                cursor.execute("""
                    INSERT INTO relationships (id, from_entity_id, to_entity_id, relationship_type, strength, attributes)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    RETURNING id
                """, (relationship_id, from_entity_id, to_entity_id, relationship_type, strength, Json(metadata)))

                self.conn.commit()
                result = cursor.fetchone()[0]

                logger.info(f"Created relationship: {relationship_type} ({result})")
                return result
        except Exception as e:
            self.conn.rollback()
            logger.error(f"Failed to create relationship {relationship_type}: {e}")
            raise

    def get_relationships(
        self,
        entity_id: str,
        direction: str = "both",
        relationship_type: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Get relationships for an entity.

        Args:
            entity_id: UUID of entity
            direction: "outgoing", "incoming", or "both"
            relationship_type: Optional filter by relationship type

        Returns:
            List of relationship dicts
        """
        self.connect()

        with self.conn.cursor(cursor_factory=RealDictCursor) as cursor:
            if direction == "outgoing":
                where_clause = "r.from_entity_id = %s"
            elif direction == "incoming":
                where_clause = "r.to_entity_id = %s"
            else:  # both
                where_clause = "(r.from_entity_id = %s OR r.to_entity_id = %s)"

            type_clause = "AND r.relationship_type = %s" if relationship_type else ""

            query = f"""
                SELECT
                    r.id,
                    r.from_entity_id,
                    r.to_entity_id,
                    r.relationship_type,
                    r.strength,
                    r.attributes as metadata,
                    r.created_at,
                    e_from.name AS from_entity_name,
                    e_from.entity_type AS from_entity_type,
                    e_to.name AS to_entity_name,
                    e_to.entity_type AS to_entity_type
                FROM relationships r
                JOIN entities e_from ON r.from_entity_id = e_from.id
                JOIN entities e_to ON r.to_entity_id = e_to.id
                WHERE {where_clause} {type_clause}
                AND r.deleted_at IS NULL
                AND e_from.deleted_at IS NULL
                AND e_to.deleted_at IS NULL
                ORDER BY r.created_at DESC
            """

            params = [entity_id] * (2 if direction == "both" else 1)
            if relationship_type:
                params.append(relationship_type)

            cursor.execute(query, params)
            results = cursor.fetchall()

            return [dict(row) for row in results]

    # ========================================================================
    # GRAPH TRAVERSAL
    # ========================================================================

    def find_related_entities(
        self,
        entity_id: str,
        relationship_type: Optional[str] = None,
        max_depth: int = 2
    ) -> List[Dict[str, Any]]:
        """
        Find entities related to given entity using graph traversal.

        Args:
            entity_id: UUID of starting entity
            relationship_type: Optional filter by relationship type
            max_depth: Maximum traversal depth (default: 2)

        Returns:
            List of related entities with path information

        Example:
            # Find all projects connected to a person (up to 2 hops away)
            related = graph.find_related_entities(person_id, max_depth=2)
        """
        self.connect()

        with self.conn.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute("""
                SELECT * FROM find_related_entities(%s, %s, %s)
            """, (entity_id, relationship_type, max_depth))

            results = cursor.fetchall()
            return [dict(row) for row in results]

    # ========================================================================
    # SEARCH OPERATIONS
    # ========================================================================

    def search_fulltext(
        self,
        query: str,
        entity_type: Optional[str] = None,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """
        Full-text search across entity names and metadata.

        Args:
            query: Search query string
            entity_type: Optional filter by entity type
            limit: Maximum results to return

        Returns:
            List of matching entities with rank scores
        """
        self.connect()

        with self.conn.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute("""
                SELECT * FROM search_entities_fulltext(%s, %s, %s)
            """, (query, entity_type, limit))

            results = cursor.fetchall()
            return [dict(row) for row in results]

    def search_semantic(
        self,
        query_embedding: List[float],
        entity_type: Optional[str] = None,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """
        Semantic search using vector similarity (pgvector).

        Args:
            query_embedding: Query vector (1536 dimensions)
            entity_type: Optional filter by entity type
            limit: Maximum results to return

        Returns:
            List of matching entities with similarity scores
        """
        self.connect()

        with self.conn.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute("""
                SELECT * FROM search_entities_semantic(%s::vector, %s, %s)
            """, (query_embedding, entity_type, limit))

            results = cursor.fetchall()
            return [dict(row) for row in results]

    # ========================================================================
    # EVENT LOGGING
    # ========================================================================

    def log_event(
        self,
        event_type: str,
        event_data: Dict[str, Any],
        entity_id: Optional[str] = None,
        relationship_id: Optional[str] = None,
        actor_id: Optional[str] = None,
        actor_type: str = "system"
    ) -> str:
        """
        Log an event to the audit trail.

        Args:
            event_type: Type of event (email_sent, document_indexed, etc.)
            event_data: Event data dict
            entity_id: Optional related entity ID
            relationship_id: Optional related relationship ID
            actor_id: Optional actor entity ID
            actor_type: Actor type (user, agent, system)

        Returns:
            UUID of created event
        """
        self.connect()

        event_id = str(uuid.uuid4())

        with self.conn.cursor() as cursor:
            cursor.execute("""
                INSERT INTO events (id, entity_id, relationship_id, event_type, event_data, actor_id, actor_type)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (event_id, entity_id, relationship_id, event_type, Json(event_data), actor_id, actor_type))

            self.conn.commit()
            result = cursor.fetchone()[0]

            logger.info(f"Logged event: {event_type} ({result})")
            return result

    def get_entity_timeline(
        self,
        entity_id: str,
        limit: int = 50
    ) -> List[Dict[str, Any]]:
        """
        Get event timeline for an entity.

        Args:
            entity_id: UUID of entity
            limit: Maximum events to return

        Returns:
            List of events ordered by timestamp (newest first)
        """
        self.connect()

        with self.conn.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute("""
                SELECT
                    id,
                    event_type,
                    event_data,
                    actor_type,
                    created_at
                FROM events
                WHERE entity_id = %s
                ORDER BY created_at DESC
                LIMIT %s
            """, (entity_id, limit))

            results = cursor.fetchall()
            return [dict(row) for row in results]


# ============================================================================
# CONVENIENCE FUNCTIONS
# ============================================================================

def get_graph() -> MemoryGraph:
    """Get a Memory Graph instance (use as context manager)."""
    return MemoryGraph()
