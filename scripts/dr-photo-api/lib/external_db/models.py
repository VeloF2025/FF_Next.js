"""
External Database Models

Pydantic models for external database configuration and query results.
"""

from enum import Enum
from typing import Dict, Any, Optional, List
from pydantic import BaseModel, Field
from datetime import datetime


class DatabaseType(str, Enum):
    """Supported database types."""
    POSTGRESQL = "postgresql"
    MYSQL = "mysql"
    SQLITE = "sqlite"


class AccessMode(str, Enum):
    """Database access mode."""
    READ_ONLY = "read_only"
    READ_WRITE = "read_write"


class ExternalDatabaseConfig(BaseModel):
    """Configuration for an external database connection."""

    name: str = Field(..., description="Unique identifier for this database")
    display_name: str = Field(..., description="Human-readable name")
    database_type: DatabaseType = Field(default=DatabaseType.POSTGRESQL)
    connection_url_env: str = Field(
        ...,
        description="Environment variable name containing connection URL"
    )
    access_mode: AccessMode = Field(default=AccessMode.READ_ONLY)
    allowed_schemas: List[str] = Field(
        default=["public"],
        description="Schemas accessible for queries"
    )
    pool_min_size: int = Field(default=1, ge=1, le=10)
    pool_max_size: int = Field(default=5, ge=1, le=20)
    connection_timeout: int = Field(default=30, description="Connection timeout in seconds")
    query_timeout: int = Field(default=60, description="Query timeout in seconds")
    description: Optional[str] = None
    owner: Optional[str] = None
    enabled: bool = Field(default=True)
    rag_indexing: bool = Field(
        default=False,
        description="Whether to index this database content to RAG"
    )

    class Config:
        use_enum_values = True


class QueryResult(BaseModel):
    """Result of a database query."""

    success: bool
    database_name: str
    query: str
    columns: List[str] = Field(default_factory=list)
    rows: List[Dict[str, Any]] = Field(default_factory=list)
    row_count: int = 0
    execution_time_ms: float = 0.0
    error: Optional[str] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }


class TableInfo(BaseModel):
    """Information about a database table."""

    schema_name: str
    table_name: str
    table_type: str  # TABLE, VIEW, etc.
    row_count: Optional[int] = None


class ColumnInfo(BaseModel):
    """Information about a table column."""

    column_name: str
    data_type: str
    is_nullable: bool
    column_default: Optional[str] = None
    character_maximum_length: Optional[int] = None


class DatabaseRegistryConfig(BaseModel):
    """Root configuration for the external database registry."""

    version: str = "1.0.0"
    description: str = "External database registry for BOSS"
    databases: List[ExternalDatabaseConfig] = Field(default_factory=list)
