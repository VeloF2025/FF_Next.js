"""
Query Executor

Safe query execution with validation, SQL injection prevention,
and result formatting.
"""

import re
import logging
from typing import List, Dict, Any, Optional
from enum import Enum
from tabulate import tabulate
import json
import csv
import io

from lib.external_db.models import QueryResult, AccessMode
from lib.external_db.connector import ExternalDBConnector
from lib.external_db.registry import ExternalDBRegistry

logger = logging.getLogger(__name__)


class OutputFormat(str, Enum):
    """Output format for query results."""
    TABLE = "table"
    JSON = "json"
    CSV = "csv"


# SQL patterns that should be blocked for read-only databases
BLOCKED_PATTERNS = [
    r";\s*--",                          # Comment injection
    r";\s*(DROP|DELETE|TRUNCATE|ALTER|CREATE|INSERT|UPDATE)",  # Multi-statement
    r"UNION\s+ALL\s+SELECT",            # Union-based injection
    r"INTO\s+(OUTFILE|DUMPFILE)",       # File write attempts
    r"LOAD_FILE\s*\(",                  # File read attempts
    r"xp_cmdshell",                     # SQL Server command execution
    r"EXECUTE\s+IMMEDIATE",             # Dynamic SQL execution
    r"DBMS_SQL",                        # Oracle dynamic SQL
]

# Statements that modify data (blocked for read-only)
WRITE_STATEMENTS = [
    "INSERT",
    "UPDATE",
    "DELETE",
    "DROP",
    "CREATE",
    "ALTER",
    "TRUNCATE",
    "GRANT",
    "REVOKE",
]


class QueryExecutor:
    """
    Safe query executor with validation and formatting.

    Features:
    - SQL injection prevention
    - Write statement blocking for read-only databases
    - Multiple output formats (table, JSON, CSV)
    - Query logging for audit
    """

    def __init__(self, database_name: str):
        """
        Initialize executor for a specific database.

        Args:
            database_name: Name of the database in registry
        """
        self.database_name = database_name
        self.registry = ExternalDBRegistry()
        self.config = self.registry.get(database_name)

        if not self.config:
            raise ValueError(f"Database not found: {database_name}")

        # Handle both enum objects and string values (Pydantic use_enum_values)
        access_mode = self.config.access_mode
        if hasattr(access_mode, 'value'):
            self.is_read_only = access_mode == AccessMode.READ_ONLY
        else:
            self.is_read_only = access_mode == "read_only"

    def validate_query(self, query: str) -> tuple[bool, str]:
        """
        Validate a SQL query for safety.

        Args:
            query: SQL query string

        Returns:
            Tuple of (is_valid, error_message)
        """
        query_upper = query.upper().strip()

        # Check for blocked patterns
        for pattern in BLOCKED_PATTERNS:
            if re.search(pattern, query, re.IGNORECASE):
                return False, f"Blocked pattern detected: {pattern}"

        # Check for write statements in read-only mode
        if self.is_read_only:
            for stmt in WRITE_STATEMENTS:
                # Check if statement is at the beginning
                if query_upper.startswith(stmt):
                    return False, f"Write operation '{stmt}' blocked: database is read-only"

                # Check for statement in middle (after semicolon)
                if f"; {stmt}" in query_upper or f";{stmt}" in query_upper:
                    return False, f"Multiple statements with '{stmt}' blocked"

        return True, ""

    def execute(
        self,
        query: str,
        max_rows: int = 1000,
        output_format: OutputFormat = OutputFormat.TABLE
    ) -> Dict[str, Any]:
        """
        Execute a query with validation and formatting.

        Args:
            query: SQL query string
            max_rows: Maximum rows to return
            output_format: Output format (table, json, csv)

        Returns:
            Dict with result or error
        """
        # Validate query
        is_valid, error = self.validate_query(query)
        if not is_valid:
            logger.warning(f"Query validation failed: {error}")
            return {
                "success": False,
                "error": error,
                "database": self.database_name,
                "query": query
            }

        # Execute query
        try:
            with ExternalDBConnector(self.database_name) as connector:
                result = connector.execute_query(query, max_rows=max_rows)

            if not result.success:
                return {
                    "success": False,
                    "error": result.error,
                    "database": self.database_name,
                    "query": query,
                    "execution_time_ms": result.execution_time_ms
                }

            # Format output
            formatted = self.format_result(result, output_format)

            return {
                "success": True,
                "database": self.database_name,
                "query": query,
                "row_count": result.row_count,
                "columns": result.columns,
                "execution_time_ms": result.execution_time_ms,
                "output": formatted,
                "output_format": output_format.value
            }

        except Exception as e:
            logger.error(f"Query execution failed: {e}")
            return {
                "success": False,
                "error": str(e),
                "database": self.database_name,
                "query": query
            }

    def format_result(
        self,
        result: QueryResult,
        output_format: OutputFormat
    ) -> str:
        """
        Format query result for display.

        Args:
            result: QueryResult object
            output_format: Desired output format

        Returns:
            Formatted string
        """
        if not result.rows:
            return "(No rows returned)"

        if output_format == OutputFormat.TABLE:
            return self._format_table(result)
        elif output_format == OutputFormat.JSON:
            return self._format_json(result)
        elif output_format == OutputFormat.CSV:
            return self._format_csv(result)
        else:
            return self._format_table(result)

    def _format_table(self, result: QueryResult) -> str:
        """Format as ASCII table."""
        if not result.rows:
            return "(No rows)"

        return tabulate(
            result.rows,
            headers="keys",
            tablefmt="grid"
        )

    def _format_json(self, result: QueryResult) -> str:
        """Format as JSON."""
        return json.dumps(result.rows, indent=2, default=str)

    def _format_csv(self, result: QueryResult) -> str:
        """Format as CSV."""
        if not result.rows:
            return ""

        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=result.columns)
        writer.writeheader()
        writer.writerows(result.rows)
        return output.getvalue()


def list_databases() -> List[Dict[str, Any]]:
    """
    List all registered databases.

    Returns:
        List of database configurations
    """
    registry = ExternalDBRegistry()
    databases = registry.list_databases()

    result = []
    for db in databases:
        # Handle both enum objects and string values (Pydantic use_enum_values)
        db_type = db.database_type.value if hasattr(db.database_type, 'value') else db.database_type
        access_mode = db.access_mode.value if hasattr(db.access_mode, 'value') else db.access_mode

        result.append({
            "name": db.name,
            "display_name": db.display_name,
            "type": db_type,
            "access_mode": access_mode,
            "enabled": db.enabled,
            "description": db.description
        })

    return result


def test_database(database_name: str) -> Dict[str, Any]:
    """
    Test connection to a database.

    Args:
        database_name: Name of database in registry

    Returns:
        Connection test result
    """
    try:
        connector = ExternalDBConnector(database_name)
        result = connector.test_connection()
        connector.close()
        return result
    except Exception as e:
        return {
            "success": False,
            "database": database_name,
            "error": str(e),
            "message": f"Connection failed: {e}"
        }


def get_tables(database_name: str, schema: str = "public") -> List[Dict[str, str]]:
    """
    Get tables from a database.

    Args:
        database_name: Name of database in registry
        schema: Schema name

    Returns:
        List of table information
    """
    try:
        with ExternalDBConnector(database_name) as connector:
            tables = connector.get_tables(schema)
            return [
                {
                    "schema": t.schema_name,
                    "table": t.table_name,
                    "type": t.table_type
                }
                for t in tables
            ]
    except Exception as e:
        logger.error(f"Failed to get tables: {e}")
        return []


def describe_table(
    database_name: str,
    table_name: str,
    schema: str = "public"
) -> List[Dict[str, Any]]:
    """
    Describe a table's columns.

    Args:
        database_name: Name of database in registry
        table_name: Name of the table
        schema: Schema name

    Returns:
        List of column information
    """
    try:
        with ExternalDBConnector(database_name) as connector:
            columns = connector.get_table_schema(table_name, schema)
            return [
                {
                    "column": c.column_name,
                    "type": c.data_type,
                    "nullable": c.is_nullable,
                    "default": c.column_default,
                    "max_length": c.character_maximum_length
                }
                for c in columns
            ]
    except Exception as e:
        logger.error(f"Failed to describe table: {e}")
        return []
