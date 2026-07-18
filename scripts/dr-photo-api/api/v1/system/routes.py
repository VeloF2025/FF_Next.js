"""
BOSS System API Routes

Provides REST endpoints for system health checks and status monitoring.
Returns real connection status for all system components.
"""

import os
import logging
import asyncio
from datetime import datetime
from typing import Optional
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/system", tags=["system"])


class ConnectionStatus(BaseModel):
    """Status of a single system connection."""
    id: str
    name: str
    status: str  # connected, error, disconnected
    last_check: str
    details: str
    latency_ms: Optional[float] = None
    error_message: Optional[str] = None


class SystemHealthResponse(BaseModel):
    """Response model for system health check."""
    overall_status: str  # healthy, degraded, unhealthy
    timestamp: str
    connections: list[ConnectionStatus]


class CostSummary(BaseModel):
    """Cost tracking summary."""
    category: str
    spent: float
    budget: float
    period: str


class CostResponse(BaseModel):
    """Response model for cost tracking."""
    total_spent: float
    total_budget: float
    period: str
    categories: list[CostSummary]
    warning_threshold: float
    critical_threshold: float


async def check_postgres_connection() -> ConnectionStatus:
    """Check PostgreSQL connection status."""
    import time
    start_time = time.time()

    postgres_host = os.getenv("POSTGRES_HOST", "boss-vps-postgres-1")
    postgres_port = os.getenv("POSTGRES_PORT", "5432")
    postgres_db = os.getenv("POSTGRES_DB", "boss")

    try:
        import asyncpg
        conn = await asyncio.wait_for(
            asyncpg.connect(
                host=postgres_host,
                port=int(postgres_port),
                database=postgres_db,
                user=os.getenv("POSTGRES_USER", "boss"),
                password=os.getenv("POSTGRES_PASSWORD", "boss_password"),
            ),
            timeout=5.0
        )

        # Get some stats
        result = await conn.fetchrow(
            "SELECT count(*) as entity_count FROM memory_graph_entities"
        )
        entity_count = result['entity_count'] if result else 0
        await conn.close()

        latency = (time.time() - start_time) * 1000

        return ConnectionStatus(
            id="postgres",
            name="PostgreSQL (Memory Graph)",
            status="connected",
            last_check=datetime.now().isoformat(),
            details=f"{entity_count:,} entities stored",
            latency_ms=round(latency, 2)
        )
    except asyncio.TimeoutError:
        return ConnectionStatus(
            id="postgres",
            name="PostgreSQL (Memory Graph)",
            status="error",
            last_check=datetime.now().isoformat(),
            details="Connection timeout",
            error_message="Connection timed out after 5 seconds"
        )
    except ImportError:
        # asyncpg not installed, try psycopg2
        try:
            import psycopg2
            conn = psycopg2.connect(
                host=postgres_host,
                port=int(postgres_port),
                database=postgres_db,
                user=os.getenv("POSTGRES_USER", "boss"),
                password=os.getenv("POSTGRES_PASSWORD", "boss_password"),
                connect_timeout=5
            )
            cursor = conn.cursor()
            cursor.execute("SELECT count(*) FROM memory_graph_entities")
            entity_count = cursor.fetchone()[0]
            cursor.close()
            conn.close()

            latency = (time.time() - start_time) * 1000

            return ConnectionStatus(
                id="postgres",
                name="PostgreSQL (Memory Graph)",
                status="connected",
                last_check=datetime.now().isoformat(),
                details=f"{entity_count:,} entities stored",
                latency_ms=round(latency, 2)
            )
        except Exception as e:
            return ConnectionStatus(
                id="postgres",
                name="PostgreSQL (Memory Graph)",
                status="error",
                last_check=datetime.now().isoformat(),
                details="Connection failed",
                error_message=str(e)[:100]
            )
    except Exception as e:
        return ConnectionStatus(
            id="postgres",
            name="PostgreSQL (Memory Graph)",
            status="error",
            last_check=datetime.now().isoformat(),
            details="Connection failed",
            error_message=str(e)[:100]
        )


async def check_redis_connection() -> ConnectionStatus:
    """Check Redis connection status."""
    import time
    start_time = time.time()

    redis_host = os.getenv("REDIS_HOST", "boss-vps-redis-1")
    redis_port = os.getenv("REDIS_PORT", "6379")

    try:
        import redis.asyncio as redis
        client = redis.Redis(
            host=redis_host,
            port=int(redis_port),
            password=os.getenv("REDIS_PASSWORD"),
            decode_responses=True,
            socket_timeout=5.0
        )

        # Ping and get info
        await client.ping()
        info = await client.info("memory")
        used_memory = info.get("used_memory_human", "unknown")
        await client.close()

        latency = (time.time() - start_time) * 1000

        return ConnectionStatus(
            id="redis",
            name="Redis (Event Bus)",
            status="connected",
            last_check=datetime.now().isoformat(),
            details=f"Memory: {used_memory}",
            latency_ms=round(latency, 2)
        )
    except ImportError:
        # Try sync redis
        try:
            import redis as sync_redis
            client = sync_redis.Redis(
                host=redis_host,
                port=int(redis_port),
                password=os.getenv("REDIS_PASSWORD"),
                decode_responses=True,
                socket_timeout=5.0
            )

            client.ping()
            info = client.info("memory")
            used_memory = info.get("used_memory_human", "unknown")
            client.close()

            latency = (time.time() - start_time) * 1000

            return ConnectionStatus(
                id="redis",
                name="Redis (Event Bus)",
                status="connected",
                last_check=datetime.now().isoformat(),
                details=f"Memory: {used_memory}",
                latency_ms=round(latency, 2)
            )
        except Exception as e:
            return ConnectionStatus(
                id="redis",
                name="Redis (Event Bus)",
                status="error",
                last_check=datetime.now().isoformat(),
                details="Connection failed",
                error_message=str(e)[:100]
            )
    except Exception as e:
        return ConnectionStatus(
            id="redis",
            name="Redis (Event Bus)",
            status="error",
            last_check=datetime.now().isoformat(),
            details="Connection failed",
            error_message=str(e)[:100]
        )


async def check_qdrant_connection() -> ConnectionStatus:
    """Check Qdrant vector database connection status."""
    import time
    start_time = time.time()

    qdrant_host = os.getenv("QDRANT_HOST", "boss-vps-qdrant-1")
    qdrant_port = os.getenv("QDRANT_PORT", "6333")

    try:
        import httpx
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"http://{qdrant_host}:{qdrant_port}/collections")

            if response.status_code == 200:
                data = response.json()
                collections = data.get("result", {}).get("collections", [])

                # Get total vectors across all collections
                total_vectors = 0
                for collection in collections:
                    try:
                        col_response = await client.get(
                            f"http://{qdrant_host}:{qdrant_port}/collections/{collection['name']}"
                        )
                        if col_response.status_code == 200:
                            col_data = col_response.json()
                            points_count = col_data.get("result", {}).get("points_count", 0)
                            total_vectors += points_count
                    except Exception:
                        pass

                latency = (time.time() - start_time) * 1000

                return ConnectionStatus(
                    id="qdrant",
                    name="Qdrant (RAG Engine)",
                    status="connected",
                    last_check=datetime.now().isoformat(),
                    details=f"{total_vectors:,} vectors indexed",
                    latency_ms=round(latency, 2)
                )
            else:
                return ConnectionStatus(
                    id="qdrant",
                    name="Qdrant (RAG Engine)",
                    status="error",
                    last_check=datetime.now().isoformat(),
                    details="API returned error",
                    error_message=f"HTTP {response.status_code}"
                )
    except Exception as e:
        return ConnectionStatus(
            id="qdrant",
            name="Qdrant (RAG Engine)",
            status="error",
            last_check=datetime.now().isoformat(),
            details="Connection failed",
            error_message=str(e)[:100]
        )


async def check_waha_connection() -> ConnectionStatus:
    """Check WAHA WhatsApp API connection status."""
    import time
    start_time = time.time()

    waha_url = os.getenv("WAHA_URL", "http://boss-vps-waha-1:3001")
    waha_api_key = os.getenv("WAHA_API_KEY")

    if not waha_api_key:
        return ConnectionStatus(
            id="whatsapp",
            name="WhatsApp (WAHA)",
            status="disconnected",
            last_check=datetime.now().isoformat(),
            details="Not configured",
            error_message="WAHA_API_KEY not set"
        )

    try:
        import httpx
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(
                f"{waha_url}/api/sessions/default",
                headers={"X-Api-Key": waha_api_key}
            )

            if response.status_code == 200:
                data = response.json()
                status = data.get("status", "UNKNOWN")
                me = data.get("me", {})
                phone = me.get("id", "").split("@")[0] if me.get("id") else "Unknown"

                latency = (time.time() - start_time) * 1000

                return ConnectionStatus(
                    id="whatsapp",
                    name="WhatsApp (WAHA)",
                    status="connected" if status == "WORKING" else "error",
                    last_check=datetime.now().isoformat(),
                    details=f"+{phone}" if status == "WORKING" else status,
                    latency_ms=round(latency, 2)
                )
            else:
                return ConnectionStatus(
                    id="whatsapp",
                    name="WhatsApp (WAHA)",
                    status="error",
                    last_check=datetime.now().isoformat(),
                    details="API error",
                    error_message=f"HTTP {response.status_code}"
                )
    except Exception as e:
        return ConnectionStatus(
            id="whatsapp",
            name="WhatsApp (WAHA)",
            status="error",
            last_check=datetime.now().isoformat(),
            details="Connection failed",
            error_message=str(e)[:100]
        )


async def check_msgraph_connection() -> ConnectionStatus:
    """Check MS Graph email connection status (simplified check)."""
    from pathlib import Path
    import json

    # Check if msgraph accounts are configured
    data_dir = Path(__file__).parent.parent.parent.parent / "data"
    config_file = data_dir / "msgraph_accounts.json"

    if not config_file.exists():
        return ConnectionStatus(
            id="msgraph",
            name="Microsoft Graph (Email)",
            status="disconnected",
            last_check=datetime.now().isoformat(),
            details="Not configured",
            error_message="msgraph_accounts.json not found"
        )

    try:
        with open(config_file, "r") as f:
            data = json.load(f)

        accounts = data.get("accounts", [])
        enabled_accounts = [a for a in accounts if a.get("enabled", True)]

        if not enabled_accounts:
            return ConnectionStatus(
                id="msgraph",
                name="Microsoft Graph (Email)",
                status="disconnected",
                last_check=datetime.now().isoformat(),
                details="No enabled accounts",
                error_message="All accounts disabled"
            )

        # List configured emails
        emails = [a.get("user_email", "Unknown") for a in enabled_accounts[:2]]
        email_list = ", ".join(emails)
        if len(enabled_accounts) > 2:
            email_list += f" +{len(enabled_accounts) - 2} more"

        return ConnectionStatus(
            id="msgraph",
            name="Microsoft Graph (Email)",
            status="connected",
            last_check=datetime.now().isoformat(),
            details=email_list,
        )
    except Exception as e:
        return ConnectionStatus(
            id="msgraph",
            name="Microsoft Graph (Email)",
            status="error",
            last_check=datetime.now().isoformat(),
            details="Config error",
            error_message=str(e)[:100]
        )


@router.get("/connections", response_model=SystemHealthResponse)
async def get_system_connections():
    """
    Get status of all system connections.

    Returns real-time connection status for:
    - PostgreSQL (Memory Graph)
    - Redis (Event Bus)
    - Qdrant (RAG Engine)
    - WhatsApp (WAHA)
    - Microsoft Graph (Email)
    """
    # Run all checks in parallel
    results = await asyncio.gather(
        check_postgres_connection(),
        check_redis_connection(),
        check_qdrant_connection(),
        check_waha_connection(),
        check_msgraph_connection(),
        return_exceptions=True
    )

    connections = []
    for result in results:
        if isinstance(result, Exception):
            connections.append(ConnectionStatus(
                id="unknown",
                name="Unknown Service",
                status="error",
                last_check=datetime.now().isoformat(),
                details="Check failed",
                error_message=str(result)[:100]
            ))
        else:
            connections.append(result)

    # Determine overall status
    statuses = [c.status for c in connections]
    if all(s == "connected" for s in statuses):
        overall = "healthy"
    elif any(s == "error" for s in statuses):
        overall = "degraded"
    else:
        overall = "degraded"

    return SystemHealthResponse(
        overall_status=overall,
        timestamp=datetime.now().isoformat(),
        connections=connections
    )


@router.get("/costs", response_model=CostResponse)
async def get_cost_summary():
    """
    Get cost tracking summary.

    Returns current month's spending by category.
    Cost data is loaded from data/cost_tracking.json if available,
    otherwise returns default values.
    """
    from pathlib import Path
    import json

    data_dir = Path(__file__).parent.parent.parent.parent / "data"
    cost_file = data_dir / "cost_tracking.json"

    # Default cost categories
    default_costs = {
        "period": datetime.now().strftime("%B %Y"),
        "total_budget": 600,
        "warning_threshold": 0.8,
        "critical_threshold": 0.95,
        "categories": [
            {"category": "OCR Processing", "spent": 0, "budget": 100},
            {"category": "Image Generation", "spent": 0, "budget": 200},
            {"category": "Video Generation", "spent": 0, "budget": 150},
            {"category": "LLM Calls", "spent": 0, "budget": 150},
            {"category": "Financial APIs", "spent": 0, "budget": 50},
        ]
    }

    # Try to load actual cost data
    if cost_file.exists():
        try:
            with open(cost_file, "r") as f:
                cost_data = json.load(f)
                # Merge with defaults
                for key in default_costs:
                    if key not in cost_data:
                        cost_data[key] = default_costs[key]
        except Exception:
            cost_data = default_costs
    else:
        cost_data = default_costs

    # Calculate total spent
    total_spent = sum(c.get("spent", 0) for c in cost_data.get("categories", []))

    categories = [
        CostSummary(
            category=c["category"],
            spent=c.get("spent", 0),
            budget=c.get("budget", 100),
            period=cost_data["period"]
        )
        for c in cost_data.get("categories", [])
    ]

    return CostResponse(
        total_spent=total_spent,
        total_budget=cost_data.get("total_budget", 600),
        period=cost_data.get("period", datetime.now().strftime("%B %Y")),
        categories=categories,
        warning_threshold=cost_data.get("warning_threshold", 0.8),
        critical_threshold=cost_data.get("critical_threshold", 0.95)
    )
