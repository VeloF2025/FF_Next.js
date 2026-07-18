"""
Database Connection Pool Manager

Centralized connection pooling for BOSS internal PostgreSQL operations.
Provides thread-safe connection management with automatic pool maintenance.

Features:
- ThreadedConnectionPool for efficient connection reuse
- Singleton pattern for global pool access
- Automatic connection health checking (pool_pre_ping)
- Configurable pool sizes and timeouts
- Context manager for safe connection handling

Usage:
    from lib.db import get_connection

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM entities")
            results = cur.fetchall()

Generated: 2025-12-02
Authority: BOSS-EXEC Implementation Plan - Connection Pooling
"""

import os
import logging
import threading
from typing import Optional, Generator, Any
from contextlib import contextmanager
from dataclasses import dataclass
from urllib.parse import urlparse, parse_qs

import psycopg2
from psycopg2 import pool, OperationalError
from psycopg2.extras import RealDictCursor

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@dataclass
class PoolConfig:
    """Configuration for database connection pool."""

    # Connection settings
    host: str = "localhost"
    port: int = 5432
    database: str = "boss_production"
    user: str = "boss_admin"
    password: Optional[str] = None

    # Pool settings
    min_connections: int = 2
    max_connections: int = 10

    # Timeout settings (seconds)
    connection_timeout: int = 10
    query_timeout: int = 30

    # Health check
    pool_pre_ping: bool = True

    # SSL settings (for Neon Cloud and other cloud providers)
    sslmode: Optional[str] = None

    # Raw DATABASE_URL if provided (used for DSN generation)
    _database_url: Optional[str] = None

    @classmethod
    def from_env(cls) -> "PoolConfig":
        """Create config from environment variables.

        Supports two modes:
        1. DATABASE_URL - Single connection string (Neon Cloud, Supabase, etc.)
        2. Individual env vars - POSTGRES_HOST, POSTGRES_PORT, etc.

        DATABASE_URL takes precedence if both are provided.
        """
        database_url = os.getenv("DATABASE_URL")

        if database_url:
            return cls.from_database_url(database_url)

        return cls(
            host=os.getenv("POSTGRES_HOST", "localhost"),
            port=int(os.getenv("POSTGRES_PORT", "5432")),
            database=os.getenv("POSTGRES_DB", "boss_production"),
            user=os.getenv("POSTGRES_USER", "boss_admin"),
            password=os.getenv("POSTGRES_PASSWORD"),
            min_connections=int(os.getenv("DB_POOL_MIN", "2")),
            max_connections=int(os.getenv("DB_POOL_MAX", "10")),
            connection_timeout=int(os.getenv("DB_CONNECTION_TIMEOUT", "10")),
            query_timeout=int(os.getenv("DB_QUERY_TIMEOUT", "30")),
        )

    @classmethod
    def from_database_url(cls, database_url: str) -> "PoolConfig":
        """Create config from a DATABASE_URL connection string.

        Supports PostgreSQL URLs like:
        postgresql://user:password@host:port/database?sslmode=require

        Args:
            database_url: Full PostgreSQL connection URL

        Returns:
            PoolConfig instance with parsed values
        """
        parsed = urlparse(database_url)

        # Parse query parameters
        query_params = parse_qs(parsed.query)

        # Extract sslmode if present
        sslmode = query_params.get("sslmode", [None])[0]

        config = cls(
            host=parsed.hostname or "localhost",
            port=parsed.port or 5432,
            database=parsed.path.lstrip("/") if parsed.path else "boss_production",
            user=parsed.username or "boss_admin",
            password=parsed.password,
            min_connections=int(os.getenv("DB_POOL_MIN", "2")),
            max_connections=int(os.getenv("DB_POOL_MAX", "10")),
            connection_timeout=int(os.getenv("DB_CONNECTION_TIMEOUT", "10")),
            query_timeout=int(os.getenv("DB_QUERY_TIMEOUT", "30")),
            sslmode=sslmode,
        )
        # Store original URL for DSN generation
        config._database_url = database_url

        logger.info(
            f"Loaded DATABASE_URL config: {config.database}@{config.host}"
            f" (ssl={sslmode})"
        )

        return config

    @property
    def dsn(self) -> str:
        """Get DSN connection string.

        If DATABASE_URL was provided, returns it with query params.
        Otherwise constructs from individual settings.
        """
        # If we have a DATABASE_URL, use it directly (preserves all params)
        if self._database_url:
            return self._database_url

        if not self.password:
            raise ValueError("POSTGRES_PASSWORD not configured")

        dsn = (
            f"postgresql://{self.user}:{self.password}@"
            f"{self.host}:{self.port}/{self.database}"
        )

        # Add sslmode if specified
        if self.sslmode:
            dsn += f"?sslmode={self.sslmode}"

        return dsn


class DatabasePool:
    """
    Thread-safe database connection pool manager.

    Uses psycopg2.pool.ThreadedConnectionPool for efficient
    connection management across multiple threads.

    Features:
    - Lazy initialization (pool created on first use)
    - Connection health checking
    - Automatic connection return via context manager
    - Thread-safe singleton access
    """

    _instance: Optional["DatabasePool"] = None
    _lock = threading.Lock()

    def __new__(cls, config: Optional[PoolConfig] = None):
        """Singleton pattern - ensure only one pool instance."""
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(self, config: Optional[PoolConfig] = None):
        """Initialize pool with configuration."""
        if self._initialized:
            return

        self.config = config or PoolConfig.from_env()
        self._pool: Optional[pool.ThreadedConnectionPool] = None
        self._pool_lock = threading.Lock()
        self._initialized = True

        logger.info(
            f"DatabasePool configured: {self.config.database}@{self.config.host} "
            f"(pool: {self.config.min_connections}-{self.config.max_connections})"
        )

    def _create_pool(self) -> pool.ThreadedConnectionPool:
        """Create the connection pool."""
        try:
            new_pool = pool.ThreadedConnectionPool(
                minconn=self.config.min_connections,
                maxconn=self.config.max_connections,
                dsn=self.config.dsn,
                connect_timeout=self.config.connection_timeout
            )
            logger.info(
                f"Connection pool created: min={self.config.min_connections}, "
                f"max={self.config.max_connections}"
            )
            return new_pool
        except OperationalError as e:
            logger.error(f"Failed to create connection pool: {e}")
            raise

    def _get_pool(self) -> pool.ThreadedConnectionPool:
        """Get or create the connection pool (lazy initialization)."""
        if self._pool is None:
            with self._pool_lock:
                if self._pool is None:
                    self._pool = self._create_pool()
        return self._pool

    def _check_connection(self, conn) -> bool:
        """Check if connection is healthy."""
        if conn is None or conn.closed:
            return False
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
            return True
        except Exception:
            return False

    @contextmanager
    def get_connection(
        self,
        autocommit: bool = False,
        cursor_factory=None
    ) -> Generator[Any, None, None]:
        """
        Get a connection from the pool.

        Context manager that automatically returns connection to pool.
        Handles connection health checking if pool_pre_ping is enabled.

        Args:
            autocommit: Enable autocommit mode for this connection
            cursor_factory: Custom cursor factory (e.g., RealDictCursor)

        Yields:
            psycopg2 connection object

        Example:
            with pool.get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT * FROM entities")
        """
        conn = None
        the_pool = self._get_pool()

        try:
            conn = the_pool.getconn()

            # Health check if enabled
            if self.config.pool_pre_ping and not self._check_connection(conn):
                logger.warning("Connection unhealthy, getting new one")
                the_pool.putconn(conn, close=True)
                conn = the_pool.getconn()

            # Reset connection state - rollback any pending transaction
            try:
                conn.rollback()
            except Exception:
                pass

            # Configure connection - set autocommit mode
            conn.autocommit = autocommit

            # Only set query timeout if there's a non-zero value
            # and connection is in autocommit mode (safe for session settings)
            if self.config.query_timeout > 0 and autocommit:
                try:
                    with conn.cursor() as cur:
                        cur.execute(
                            f"SET statement_timeout = '{self.config.query_timeout * 1000}'"
                        )
                except Exception as e:
                    logger.debug(f"Could not set statement_timeout: {e}")

            yield conn

            # Commit if not in autocommit mode and no exceptions
            if not autocommit:
                conn.commit()

        except Exception as e:
            # Rollback on error
            if conn and not conn.closed and not autocommit:
                try:
                    conn.rollback()
                except Exception:
                    pass
            raise
        finally:
            if conn:
                the_pool.putconn(conn)

    def execute(
        self,
        query: str,
        params: tuple = None,
        fetch: str = "all"
    ) -> Any:
        """
        Execute a query and return results.

        Convenience method for simple queries.

        Args:
            query: SQL query string
            params: Query parameters
            fetch: "all", "one", or "none" (for INSERT/UPDATE/DELETE)

        Returns:
            Query results (list, dict, or rowcount)
        """
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(query, params)

                if fetch == "all":
                    return [dict(row) for row in cur.fetchall()]
                elif fetch == "one":
                    result = cur.fetchone()
                    return dict(result) if result else None
                else:
                    return cur.rowcount

    def test_connection(self) -> dict:
        """Test database connection and return status."""
        import time
        start = time.time()

        try:
            with self.get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT version(), current_database()")
                    version, db = cur.fetchone()

            elapsed = (time.time() - start) * 1000
            return {
                "success": True,
                "database": db,
                "version": version.split(",")[0],
                "pool_min": self.config.min_connections,
                "pool_max": self.config.max_connections,
                "latency_ms": round(elapsed, 2),
            }
        except Exception as e:
            elapsed = (time.time() - start) * 1000
            return {
                "success": False,
                "error": str(e),
                "latency_ms": round(elapsed, 2),
            }

    def get_pool_status(self) -> dict:
        """Get current pool status."""
        if self._pool is None:
            return {"initialized": False}

        # Note: ThreadedConnectionPool doesn't expose used/free counts directly
        # This is a limitation of psycopg2's pool
        return {
            "initialized": True,
            "min_connections": self.config.min_connections,
            "max_connections": self.config.max_connections,
            "database": self.config.database,
            "host": self.config.host,
        }

    def close(self) -> None:
        """Close all connections in the pool."""
        if self._pool:
            with self._pool_lock:
                if self._pool:
                    self._pool.closeall()
                    self._pool = None
                    logger.info("Connection pool closed")


# Module-level convenience functions

_pool_instance: Optional[DatabasePool] = None
_pool_lock = threading.Lock()


def get_pool(config: Optional[PoolConfig] = None) -> DatabasePool:
    """
    Get the global database pool instance.

    Creates pool on first call (singleton pattern).

    Args:
        config: Optional pool configuration (only used on first call)

    Returns:
        DatabasePool instance
    """
    global _pool_instance
    if _pool_instance is None:
        with _pool_lock:
            if _pool_instance is None:
                _pool_instance = DatabasePool(config)
    return _pool_instance


@contextmanager
def get_connection(
    autocommit: bool = False,
    cursor_factory=None
) -> Generator[Any, None, None]:
    """
    Get a database connection from the global pool.

    Convenience function that gets connection from singleton pool.

    Args:
        autocommit: Enable autocommit mode
        cursor_factory: Custom cursor factory

    Yields:
        psycopg2 connection object

    Example:
        from lib.db import get_connection

        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM entities")
                count = cur.fetchone()[0]
    """
    pool_instance = get_pool()
    with pool_instance.get_connection(
        autocommit=autocommit,
        cursor_factory=cursor_factory
    ) as conn:
        yield conn


def close_pool() -> None:
    """Close the global connection pool."""
    global _pool_instance
    if _pool_instance:
        _pool_instance.close()
        _pool_instance = None


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()

    print("=" * 80)
    print("DATABASE CONNECTION POOL - TEST")
    print("=" * 80)
    print()

    # Test connection
    pool_instance = get_pool()
    status = pool_instance.test_connection()

    print("Connection Test:")
    for key, value in status.items():
        print(f"  {key}: {value}")
    print()

    # Test query
    if status["success"]:
        print("Test Query:")
        result = pool_instance.execute(
            "SELECT COUNT(*) as count FROM entities WHERE deleted_at IS NULL",
            fetch="one"
        )
        if result:
            print(f"  Entity count: {result['count']}")

        # Test context manager
        print("\nContext Manager Test:")
        with get_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("SELECT entity_type, COUNT(*) as count FROM entities WHERE deleted_at IS NULL GROUP BY entity_type LIMIT 5")
                rows = cur.fetchall()
                for row in rows:
                    print(f"  {row['entity_type']}: {row['count']}")

    print()
    print("Pool Status:")
    pool_status = pool_instance.get_pool_status()
    for key, value in pool_status.items():
        print(f"  {key}: {value}")

    # Cleanup
    close_pool()
    print()
    print("=" * 80)
    print("TEST COMPLETE")
    print("=" * 80)
