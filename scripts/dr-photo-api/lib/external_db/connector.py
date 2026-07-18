"""
External Database Connector

Manages connections to external databases with connection pooling,
read-only enforcement, and timeout protection.
"""

import os
import time
import logging
from typing import Optional, List, Dict, Any, Generator
from contextlib import contextmanager

import psycopg2
from psycopg2 import pool, sql, OperationalError
from psycopg2.extras import RealDictCursor

from lib.external_db.models import (
    ExternalDatabaseConfig,
    AccessMode,
    QueryResult,
    TableInfo,
    ColumnInfo
)
from lib.external_db.registry import ExternalDBRegistry

logger = logging.getLogger(__name__)


class ExternalDBConnector:
    """
    Connector for external databases.

    Features:
    - Connection pooling via psycopg2.pool.ThreadedConnectionPool
    - Read-only enforcement at session level
    - Query timeout protection
    - SSL support for Neon connections
    """

    def __init__(self, database_name: str):
        """
        Initialize connector for a specific database.

        Args:
            database_name: Name of the database in the registry
        """
        self.database_name = database_name
        self.registry = ExternalDBRegistry()
        self.config: Optional[ExternalDatabaseConfig] = self.registry.get(database_name)

        if not self.config:
            raise ValueError(f"Database not found in registry: {database_name}")

        self.connection_url = self.registry.get_connection_url(database_name)
        if not self.connection_url:
            raise ValueError(
                f"Connection URL not found. Set environment variable: "
                f"{self.config.connection_url_env}"
            )

        self._pool: Optional[pool.ThreadedConnectionPool] = None
        self._init_pool()

    def _init_pool(self) -> None:
        """Initialize connection pool."""
        try:
            self._pool = pool.ThreadedConnectionPool(
                minconn=self.config.pool_min_size,
                maxconn=self.config.pool_max_size,
                dsn=self.connection_url,
                connect_timeout=self.config.connection_timeout
            )
            logger.info(
                f"Connection pool initialized for {self.database_name} "
                f"(min={self.config.pool_min_size}, max={self.config.pool_max_size})"
            )
        except OperationalError as e:
            logger.error(f"Failed to initialize connection pool: {e}")
            raise

    @contextmanager
    def get_connection(self) -> Generator[Any, None, None]:
        """
        Get a connection from the pool.

        Context manager that automatically returns connection to pool.
        Enforces read-only mode if configured.
        """
        conn = None
        try:
            conn = self._pool.getconn()

            # Set session characteristics
            with conn.cursor() as cur:
                # Set query timeout
                cur.execute(
                    f"SET statement_timeout = '{self.config.query_timeout * 1000}'"
                )

                # Enforce read-only if configured
                # Handle both enum objects and string values (Pydantic use_enum_values)
                access_mode = self.config.access_mode
                is_read_only = (
                    access_mode == AccessMode.READ_ONLY if hasattr(access_mode, 'value')
                    else access_mode == "read_only"
                )
                if is_read_only:
                    cur.execute(
                        "SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY"
                    )

            conn.commit()
            yield conn

        finally:
            if conn:
                self._pool.putconn(conn)

    def test_connection(self) -> Dict[str, Any]:
        """
        Test database connection.

        Returns:
            Dict with connection status and details
        """
        start_time = time.time()
        try:
            with self.get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT 1 as test, version() as version")
                    result = cur.fetchone()

                    # Get database name
                    cur.execute("SELECT current_database()")
                    db_name = cur.fetchone()[0]

            elapsed = (time.time() - start_time) * 1000

            # Handle both enum objects and string values (Pydantic use_enum_values)
            access_mode = self.config.access_mode
            access_mode_str = access_mode.value if hasattr(access_mode, 'value') else access_mode

            return {
                "success": True,
                "database": self.database_name,
                "db_name": db_name,
                "version": result[1] if result else "Unknown",
                "access_mode": access_mode_str,
                "connection_time_ms": round(elapsed, 2),
                "message": "Connection successful"
            }

        except Exception as e:
            elapsed = (time.time() - start_time) * 1000
            return {
                "success": False,
                "database": self.database_name,
                "error": str(e),
                "connection_time_ms": round(elapsed, 2),
                "message": f"Connection failed: {e}"
            }

    def execute_query(
        self,
        query: str,
        params: Optional[tuple] = None,
        max_rows: int = 1000
    ) -> QueryResult:
        """
        Execute a SQL query.

        Args:
            query: SQL query string
            params: Query parameters (for parameterized queries)
            max_rows: Maximum rows to return

        Returns:
            QueryResult with columns, rows, and metadata
        """
        start_time = time.time()

        try:
            with self.get_connection() as conn:
                with conn.cursor(cursor_factory=RealDictCursor) as cur:
                    cur.execute(query, params)

                    # Check if query returns results
                    if cur.description:
                        columns = [desc[0] for desc in cur.description]
                        rows = cur.fetchmany(max_rows)
                        row_count = len(rows)

                        # Check if more rows exist
                        if cur.fetchone():
                            logger.warning(
                                f"Query returned more than {max_rows} rows, "
                                f"results truncated"
                            )
                    else:
                        columns = []
                        rows = []
                        row_count = cur.rowcount if cur.rowcount >= 0 else 0

            elapsed = (time.time() - start_time) * 1000

            return QueryResult(
                success=True,
                database_name=self.database_name,
                query=query,
                columns=columns,
                rows=[dict(row) for row in rows],
                row_count=row_count,
                execution_time_ms=round(elapsed, 2)
            )

        except psycopg2.errors.ReadOnlySqlTransaction as e:
            elapsed = (time.time() - start_time) * 1000
            return QueryResult(
                success=False,
                database_name=self.database_name,
                query=query,
                error=f"Write operation blocked: Database is read-only",
                execution_time_ms=round(elapsed, 2)
            )

        except Exception as e:
            elapsed = (time.time() - start_time) * 1000
            return QueryResult(
                success=False,
                database_name=self.database_name,
                query=query,
                error=str(e),
                execution_time_ms=round(elapsed, 2)
            )

    def get_tables(self, schema: str = "public") -> List[TableInfo]:
        """
        Get list of tables in a schema.

        Args:
            schema: Schema name (default: public)

        Returns:
            List of TableInfo objects
        """
        query = """
            SELECT
                table_schema,
                table_name,
                table_type
            FROM information_schema.tables
            WHERE table_schema = %s
            ORDER BY table_name
        """

        result = self.execute_query(query, (schema,))

        if not result.success:
            logger.error(f"Failed to get tables: {result.error}")
            return []

        return [
            TableInfo(
                schema_name=row["table_schema"],
                table_name=row["table_name"],
                table_type=row["table_type"]
            )
            for row in result.rows
        ]

    def get_table_schema(
        self,
        table_name: str,
        schema: str = "public"
    ) -> List[ColumnInfo]:
        """
        Get column information for a table.

        Args:
            table_name: Name of the table
            schema: Schema name (default: public)

        Returns:
            List of ColumnInfo objects
        """
        query = """
            SELECT
                column_name,
                data_type,
                is_nullable,
                column_default,
                character_maximum_length
            FROM information_schema.columns
            WHERE table_schema = %s
                AND table_name = %s
            ORDER BY ordinal_position
        """

        result = self.execute_query(query, (schema, table_name))

        if not result.success:
            logger.error(f"Failed to get table schema: {result.error}")
            return []

        return [
            ColumnInfo(
                column_name=row["column_name"],
                data_type=row["data_type"],
                is_nullable=row["is_nullable"] == "YES",
                column_default=row["column_default"],
                character_maximum_length=row["character_maximum_length"]
            )
            for row in result.rows
        ]

    def get_row_count(self, table_name: str, schema: str = "public") -> int:
        """
        Get approximate row count for a table.

        Uses reltuples for performance (may be approximate).
        """
        query = """
            SELECT reltuples::bigint AS count
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relname = %s
                AND n.nspname = %s
        """

        result = self.execute_query(query, (table_name, schema))

        if result.success and result.rows:
            return int(result.rows[0]["count"])
        return 0

    def close(self) -> None:
        """Close connection pool."""
        if self._pool:
            self._pool.closeall()
            logger.info(f"Connection pool closed for {self.database_name}")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()
