"""
BOSS External Database Connectivity Module

Purpose: Connect to and query external databases (FibreFlow Neon, etc.)
Features: Connection pooling, read-only enforcement, query validation
Architecture: Generic database connector with registry-based configuration

Generated: 2025-12-02
Authority: BOSS-EXEC Architecture - Component 11
"""

from lib.external_db.models import (
    DatabaseType,
    AccessMode,
    ExternalDatabaseConfig,
    QueryResult
)
from lib.external_db.registry import ExternalDBRegistry
from lib.external_db.connector import ExternalDBConnector
from lib.external_db.query_executor import QueryExecutor

__all__ = [
    "DatabaseType",
    "AccessMode",
    "ExternalDatabaseConfig",
    "QueryResult",
    "ExternalDBRegistry",
    "ExternalDBConnector",
    "QueryExecutor",
]

__version__ = "1.0.0"
