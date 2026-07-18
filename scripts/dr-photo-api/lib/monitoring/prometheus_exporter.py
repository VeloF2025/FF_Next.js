"""
BOSS Prometheus Metrics Exporter

Purpose: Export system metrics for Prometheus scraping
Authority: Phase 8 - Production Deployment
Created: 2025-11-20

Metrics Categories:
- Event Bus: Event counts, queue depths, processing rates
- Hooks: Execution counts, latencies, failure rates
- Agents: Operation counts, success rates, performance
- Resources: Database connections, memory, CPU
- Costs: API usage, estimated monthly spend

Usage:
    >>> from lib.monitoring.prometheus_exporter import start_metrics_server
    >>> start_metrics_server(port=9090)
    >>> # Prometheus scrapes http://localhost:9090/metrics

Integration:
    - Add to docker-compose.yml
    - Configure Prometheus scraping
    - Import Grafana dashboard
    - Setup alerting rules
"""

import os
import sys
import time
import psutil
from pathlib import Path
from typing import Dict, Any, Optional
from datetime import datetime, timedelta

from prometheus_client import (
    start_http_server,
    Counter,
    Gauge,
    Histogram,
    Summary,
    CollectorRegistry,
    generate_latest,
    CONTENT_TYPE_LATEST
)

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from lib.events import RedisEventBus, EventType
from lib.events.event_store import get_event_store


# ============================================================================
# METRICS DEFINITIONS
# ============================================================================

# Event Bus Metrics
events_published_total = Counter(
    'boss_events_published_total',
    'Total events published to event bus',
    ['event_type', 'source']
)

events_consumed_total = Counter(
    'boss_events_consumed_total',
    'Total events consumed by hooks',
    ['event_type', 'consumer']
)

event_queue_depth = Gauge(
    'boss_event_queue_depth',
    'Current depth of event queue',
    ['stream']
)

event_processing_duration_seconds = Histogram(
    'boss_event_processing_duration_seconds',
    'Event processing duration in seconds',
    ['event_type', 'hook_name'],
    buckets=[.005, .01, .025, .05, .075, .1, .25, .5, .75, 1.0, 2.5, 5.0]
)

# Hook Execution Metrics
hook_executions_total = Counter(
    'boss_hook_executions_total',
    'Total hook executions',
    ['hook_name', 'status']  # status: success, failed
)

hook_failures_total = Counter(
    'boss_hook_failures_total',
    'Total hook execution failures',
    ['hook_name', 'error_type']
)

hook_duration_seconds = Histogram(
    'boss_hook_duration_seconds',
    'Hook execution duration in seconds',
    ['hook_name'],
    buckets=[.005, .01, .025, .05, .075, .1, .25, .5, .75, 1.0, 2.5, 5.0, 10.0]
)

# Agent Metrics
agent_operations_total = Counter(
    'boss_agent_operations_total',
    'Total agent operations',
    ['agent_name', 'operation', 'status']
)

agent_api_calls_total = Counter(
    'boss_agent_api_calls_total',
    'Total external API calls by agents',
    ['agent_name', 'api_provider', 'status']
)

# OCR Tier Metrics (cost optimization tracking)
ocr_tier_usage_total = Counter(
    'boss_ocr_tier_usage_total',
    'OCR processing by tier',
    ['tier']  # tier: tesseract, paddleocr, chandra, gemini
)

ocr_cost_savings_usd = Counter(
    'boss_ocr_cost_savings_usd',
    'Estimated cost savings from free OCR tiers',
    ['tier']
)

# Resource Metrics
database_connections_active = Gauge(
    'boss_database_connections_active',
    'Active database connections',
    ['database']  # postgres, redis, qdrant
)

memory_usage_bytes = Gauge(
    'boss_memory_usage_bytes',
    'Process memory usage in bytes',
    ['type']  # rss, vms, shared
)

cpu_usage_percent = Gauge(
    'boss_cpu_usage_percent',
    'CPU usage percentage'
)

# Cost Tracking Metrics
api_cost_usd_total = Counter(
    'boss_api_cost_usd_total',
    'Total API costs in USD',
    ['service']  # gemini, openai, ideogram, etc.
)

monthly_cost_usd = Gauge(
    'boss_monthly_cost_usd',
    'Estimated monthly cost in USD',
    ['category']  # ocr, image_gen, llm, financial, total
)

cost_budget_remaining_usd = Gauge(
    'boss_cost_budget_remaining_usd',
    'Remaining monthly budget in USD'
)

# Dead Letter Queue Metrics
dlq_events_total = Gauge(
    'boss_dlq_events_total',
    'Total events in dead letter queue',
    ['retry_count']
)

dlq_retry_attempts_total = Counter(
    'boss_dlq_retry_attempts_total',
    'Total retry attempts from DLQ',
    ['hook_name', 'status']
)


# ============================================================================
# METRICS COLLECTOR
# ============================================================================

class BOSSMetricsCollector:
    """
    Collects metrics from BOSS components for Prometheus export.

    Responsibilities:
    - Query event store for statistics
    - Check Redis queue depths
    - Monitor database connections
    - Track resource usage (CPU, memory)
    - Calculate cost metrics
    - Update Prometheus gauges/counters

    Runs on scheduled interval (default: 15 seconds).
    """

    def __init__(
        self,
        collection_interval_seconds: int = 15,
        cost_budget_usd: float = 600.0
    ):
        """
        Initialize metrics collector.

        Args:
            collection_interval_seconds: How often to collect metrics
            cost_budget_usd: Monthly cost budget for alerts
        """
        self.collection_interval = collection_interval_seconds
        self.cost_budget = cost_budget_usd

        # Initialize connections
        try:
            self.event_bus = RedisEventBus(redis_url=os.getenv("REDIS_URL", "redis://localhost:6380"))
        except Exception as e:
            print(f"⚠️ Could not connect to Redis: {e}")
            self.event_bus = None

        try:
            self.event_store = get_event_store()
        except Exception as e:
            print(f"⚠️ Could not connect to event store: {e}")
            self.event_store = None

        # Process info for resource metrics
        self.process = psutil.Process()

        print(f"📊 BOSSMetricsCollector initialized (interval={collection_interval_seconds}s)")

    def collect_event_bus_metrics(self):
        """Collect metrics from Redis event bus."""
        if not self.event_bus:
            return

        try:
            # Get queue depths for all streams
            for event_type in EventType:
                stream_name = f"boss:events:{event_type.value}"

                # Get stream length (queue depth)
                try:
                    info = self.event_bus.redis.xinfo_stream(stream_name)
                    depth = info.get('length', 0)
                    event_queue_depth.labels(stream=event_type.value).set(depth)
                except Exception:
                    # Stream doesn't exist yet
                    event_queue_depth.labels(stream=event_type.value).set(0)

        except Exception as e:
            print(f"⚠️ Error collecting event bus metrics: {e}")

    def collect_hook_metrics(self):
        """Collect hook execution metrics from event store."""
        if not self.event_store:
            return

        try:
            # Get hook statistics from last hour
            stats = self.event_store.get_stats(hours=1)

            # Update hook execution counters
            for hook_stat in stats.get('hook_stats', []):
                hook_name = hook_stat['hook_name']

                # Success/failure counts
                hook_executions_total.labels(
                    hook_name=hook_name,
                    status='success'
                ).inc(hook_stat.get('success_count', 0))

                hook_executions_total.labels(
                    hook_name=hook_name,
                    status='failed'
                ).inc(hook_stat.get('failure_count', 0))

        except Exception as e:
            print(f"⚠️ Error collecting hook metrics: {e}")

    def collect_dlq_metrics(self):
        """Collect dead letter queue metrics."""
        if not self.event_store:
            return

        try:
            conn = self.event_store._get_connection()
            cursor = conn.cursor()

            # Count events by retry count
            cursor.execute("""
                SELECT retry_count, COUNT(*)
                FROM event_store.failed_events
                WHERE resolved = FALSE
                GROUP BY retry_count
            """)

            for retry_count, count in cursor.fetchall():
                dlq_events_total.labels(retry_count=str(retry_count)).set(count)

            cursor.close()

        except Exception as e:
            print(f"⚠️ Error collecting DLQ metrics: {e}")

    def collect_resource_metrics(self):
        """Collect system resource usage metrics."""
        try:
            # Memory usage
            mem_info = self.process.memory_info()
            memory_usage_bytes.labels(type='rss').set(mem_info.rss)
            memory_usage_bytes.labels(type='vms').set(mem_info.vms)

            # CPU usage
            cpu_percent = self.process.cpu_percent(interval=1.0)
            cpu_usage_percent.set(cpu_percent)

            # Database connections (mock - would need actual DB connection pooling)
            database_connections_active.labels(database='postgres').set(1 if self.event_store else 0)
            database_connections_active.labels(database='redis').set(1 if self.event_bus else 0)

        except Exception as e:
            print(f"⚠️ Error collecting resource metrics: {e}")

    def collect_cost_metrics(self):
        """Collect cost tracking metrics."""
        if not self.event_store:
            return

        try:
            # Get monthly costs (mock - would need actual cost tracking table)
            # For now, estimate based on event counts

            conn = self.event_store._get_connection()
            cursor = conn.cursor()

            # Get event counts for current month
            cursor.execute("""
                SELECT
                    COUNT(*) FILTER (WHERE source = 'ocr_agent') as ocr_count,
                    COUNT(*) FILTER (WHERE source = 'visual_agent') as visual_count
                FROM event_store.events
                WHERE timestamp >= DATE_TRUNC('month', CURRENT_DATE)
            """)

            result = cursor.fetchone()
            ocr_count = result[0] if result else 0
            visual_count = result[1] if result else 0

            # Estimate costs (5% of OCR uses paid API at $0.003/page)
            ocr_cost = (ocr_count * 0.05) * 0.003
            monthly_cost_usd.labels(category='ocr').set(ocr_cost)

            # Mock visual generation cost ($0.04/image)
            visual_cost = visual_count * 0.04
            monthly_cost_usd.labels(category='image_gen').set(visual_cost)

            # Total
            total_cost = ocr_cost + visual_cost
            monthly_cost_usd.labels(category='total').set(total_cost)

            # Remaining budget
            remaining = self.cost_budget - total_cost
            cost_budget_remaining_usd.set(remaining)

            cursor.close()

        except Exception as e:
            print(f"⚠️ Error collecting cost metrics: {e}")

    def collect_all_metrics(self):
        """Collect all metrics in one pass."""
        print(f"📊 Collecting metrics at {datetime.now().isoformat()}")

        self.collect_event_bus_metrics()
        self.collect_hook_metrics()
        self.collect_dlq_metrics()
        self.collect_resource_metrics()
        self.collect_cost_metrics()

        print(f"✅ Metrics collection complete")

    def run_forever(self):
        """Run collection loop indefinitely."""
        print(f"🚀 Starting metrics collection loop (interval={self.collection_interval}s)")
        print(f"   Metrics available at http://localhost:9090/metrics")

        while True:
            try:
                self.collect_all_metrics()
            except Exception as e:
                print(f"❌ Error in collection loop: {e}")

            time.sleep(self.collection_interval)


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def record_event_published(event_type: str, source: str):
    """Record an event publication."""
    events_published_total.labels(event_type=event_type, source=source).inc()


def record_event_consumed(event_type: str, consumer: str):
    """Record an event consumption."""
    events_consumed_total.labels(event_type=event_type, consumer=consumer).inc()


def record_hook_execution(hook_name: str, duration_seconds: float, status: str, error_type: Optional[str] = None):
    """Record a hook execution."""
    hook_executions_total.labels(hook_name=hook_name, status=status).inc()
    hook_duration_seconds.labels(hook_name=hook_name).observe(duration_seconds)

    if status == 'failed' and error_type:
        hook_failures_total.labels(hook_name=hook_name, error_type=error_type).inc()


def record_agent_operation(agent_name: str, operation: str, status: str):
    """Record an agent operation."""
    agent_operations_total.labels(agent_name=agent_name, operation=operation, status=status).inc()


def record_api_call(agent_name: str, api_provider: str, status: str, cost_usd: Optional[float] = None):
    """Record an external API call."""
    agent_api_calls_total.labels(agent_name=agent_name, api_provider=api_provider, status=status).inc()

    if cost_usd:
        api_cost_usd_total.labels(service=api_provider).inc(cost_usd)


def record_ocr_tier_usage(tier: str, cost_usd: float = 0.0, savings_usd: float = 0.0):
    """Record OCR tier usage for cost tracking."""
    ocr_tier_usage_total.labels(tier=tier).inc()

    if savings_usd > 0:
        ocr_cost_savings_usd.labels(tier=tier).inc(savings_usd)

    if cost_usd > 0:
        api_cost_usd_total.labels(service='gemini_ocr').inc(cost_usd)


# ============================================================================
# MAIN SERVER
# ============================================================================

def start_metrics_server(port: int = 9090, collection_interval: int = 15):
    """
    Start Prometheus metrics HTTP server.

    Args:
        port: Port to listen on (default: 9090)
        collection_interval: Metrics collection interval in seconds

    Usage:
        >>> start_metrics_server(port=9090)
        >>> # Prometheus scrapes http://localhost:9090/metrics
    """
    print(f"🚀 Starting BOSS Prometheus Metrics Exporter on port {port}")

    # Start HTTP server for Prometheus scraping
    start_http_server(port)

    print(f"✅ Metrics server running on http://localhost:{port}/metrics")
    print(f"   Configure Prometheus to scrape this endpoint")

    # Start metrics collector
    collector = BOSSMetricsCollector(collection_interval_seconds=collection_interval)
    collector.run_forever()


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="BOSS Prometheus Metrics Exporter")
    parser.add_argument("--port", type=int, default=9090, help="HTTP server port (default: 9090)")
    parser.add_argument("--interval", type=int, default=15, help="Collection interval in seconds (default: 15)")

    args = parser.parse_args()

    try:
        start_metrics_server(port=args.port, collection_interval=args.interval)
    except KeyboardInterrupt:
        print("\n🛑 Metrics server stopped by user")
    except Exception as e:
        print(f"❌ Metrics server failed: {e}")
        sys.exit(1)
