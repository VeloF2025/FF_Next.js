"""
Database Connection Pool Module

Centralized connection pooling for internal PostgreSQL operations.
Uses psycopg2.pool.ThreadedConnectionPool for efficient connection management.

Usage:
    from lib.db import get_connection, get_pool

    # Context manager (recommended)
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1")

    # Direct pool access for advanced use
    pool = get_pool()
"""

from lib.db.pool import (
    DatabasePool,
    get_pool,
    get_connection,
    close_pool,
    PoolConfig,
)

__all__ = [
    "DatabasePool",
    "get_pool",
    "get_connection",
    "close_pool",
    "PoolConfig",
]
