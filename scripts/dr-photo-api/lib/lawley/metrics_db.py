"""Database access layer for Lawley daily performance metrics."""

from datetime import date, timedelta, datetime
from typing import Dict, List, Optional, Any
from pydantic import BaseModel, Field
from lib.db import get_connection
from psycopg2.extras import RealDictCursor
import logging

logger = logging.getLogger(__name__)


class LawleyDailyMetrics(BaseModel):
    """Pydantic model for Lawley daily metrics validation."""
    report_date: date
    homes_connected: int
    homes_change: Optional[int] = None
    revenue: Optional[float] = None
    true_revenue: Optional[float] = None
    trphc: Optional[float] = None
    active_bundles: Optional[int] = None
    ab_hc_ratio: Optional[float] = None
    bundle_gap: Optional[int] = None

    avg_21day_trphc: Optional[float] = None
    avg_21day_homes: Optional[float] = None
    avg_21day_revenue: Optional[float] = None
    avg_21day_bundles: Optional[float] = None
    avg_21day_ab_ratio: Optional[float] = None
    avg_21day_true_revenue: Optional[float] = None

    avg_30day_trphc: Optional[float] = None
    avg_30day_homes: Optional[float] = None
    avg_30day_revenue: Optional[float] = None
    avg_30day_bundles: Optional[float] = None
    avg_30day_ab_ratio: Optional[float] = None
    avg_30day_true_revenue: Optional[float] = None

    homes_7day_growth: Optional[int] = None
    homes_7day_growth_pct: Optional[float] = None
    homes_30day_growth: Optional[int] = None
    homes_30day_growth_pct: Optional[float] = None

    total_pons: Optional[int] = None
    avg_pon_age: Optional[float] = None
    avg_homes_per_pon: Optional[float] = None

    ai_commentary: Optional[str] = None
    ai_source: Optional[str] = None
    source_file: Optional[str] = None
    processing_duration_seconds: Optional[int] = None


class LawleyMetricsDB:
    """Database operations for Lawley metrics tracking."""

    def __init__(self):
        """Initialize database access."""
        logger.debug(f"LawleyMetricsDB initialized")

    def save_daily_metrics(self, metrics: Dict[str, Any]) -> bool:
        """
        Save or update metrics for a specific date (UPSERT).

        Args:
            metrics: Dictionary with metric values (keys match column names)

        Returns:
            True if successful, False otherwise
        """
        try:
            # Validate with Pydantic (if report_date is string, convert to date)
            if isinstance(metrics.get('report_date'), str):
                metrics['report_date'] = datetime.strptime(metrics['report_date'], '%Y-%m-%d').date()

            validated = LawleyDailyMetrics(**metrics)

            # Build UPSERT query
            columns = [k for k, v in metrics.items() if v is not None and k != 'id']
            placeholders = [f"%({col})s" for col in columns]

            # Update clause for ON CONFLICT
            update_clause = ", ".join([f"{col} = EXCLUDED.{col}" for col in columns if col != 'report_date'])

            sql = f"""
                INSERT INTO lawley.daily_metrics ({', '.join(columns)})
                VALUES ({', '.join(placeholders)})
                ON CONFLICT (report_date)
                DO UPDATE SET {update_clause}
                RETURNING id, report_date
            """

            with get_connection() as conn:
                with conn.cursor(cursor_factory=RealDictCursor) as cur:
                    cur.execute(sql, metrics)
                    result = cur.fetchone()

                    if result:
                        logger.info(f"✅ Saved metrics for {result['report_date']} (ID: {result['id']})")
                        return True
                    else:
                        logger.warning(f"⚠️  No result returned from INSERT")
                        return False

        except Exception as e:
            logger.error(f"❌ Error saving metrics: {e}", exc_info=True)
            return False

    def get_metrics_by_date(self, report_date: date) -> Optional[Dict]:
        """
        Retrieve metrics for a specific date.

        Args:
            report_date: Date to query

        Returns:
            Dictionary with metrics or None if not found
        """
        try:
            sql = """
                SELECT * FROM lawley.daily_metrics
                WHERE report_date = %s
            """

            with get_connection() as conn:
                with conn.cursor(cursor_factory=RealDictCursor) as cur:
                    cur.execute(sql, (report_date,))
                    result = cur.fetchone()

                    if result:
                        return dict(result)
                    else:
                        logger.debug(f"No metrics found for {report_date}")
                        return None

        except Exception as e:
            logger.error(f"Error querying metrics for {report_date}: {e}")
            return None

    def get_metrics_range(self, start_date: date, end_date: date) -> List[Dict]:
        """
        Get metrics for a date range (inclusive).

        Args:
            start_date: Start date (inclusive)
            end_date: End date (inclusive)

        Returns:
            List of metric dictionaries, ordered by date DESC
        """
        try:
            sql = """
                SELECT * FROM lawley.daily_metrics
                WHERE report_date BETWEEN %s AND %s
                ORDER BY report_date DESC
            """

            with get_connection() as conn:
                with conn.cursor(cursor_factory=RealDictCursor) as cur:
                    cur.execute(sql, (start_date, end_date))
                    results = cur.fetchall()

                    return [dict(row) for row in results]

        except Exception as e:
            logger.error(f"Error querying metrics range {start_date} to {end_date}: {e}")
            return []

    def get_last_n_days(self, n: int = 30) -> List[Dict]:
        """
        Get metrics for the last N days.

        Args:
            n: Number of days to retrieve (default 30)

        Returns:
            List of metric dictionaries, ordered by date DESC
        """
        try:
            sql = """
                SELECT * FROM lawley.daily_metrics
                ORDER BY report_date DESC
                LIMIT %s
            """

            with get_connection() as conn:
                with conn.cursor(cursor_factory=RealDictCursor) as cur:
                    cur.execute(sql, (n,))
                    results = cur.fetchall()

                    logger.debug(f"Retrieved {len(results)} days of metrics")
                    return [dict(row) for row in results]

        except Exception as e:
            logger.error(f"Error querying last {n} days: {e}")
            return []

    def get_rolling_average_history(
        self,
        metric_name: str,
        days: int = 30,
        include_daily: bool = False
    ) -> Dict:
        """
        Get 21-day and 30-day rolling average history for a metric.

        Args:
            metric_name: 'trphc', 'homes', 'revenue', 'bundles', 'ab_ratio', 'true_revenue'
            days: Number of days to retrieve (default 30)
            include_daily: Also include daily actual values

        Returns:
            {
                'dates': ['2025-12-01', '2025-12-02', ...],
                'avg_21day': [2.54, 2.58, ...],
                'avg_30day': [2.64, 2.71, ...],
                'daily': [3.44, 3.21, ...]  # if include_daily=True
            }
        """
        try:
            # Map friendly names to column names
            metric_mapping = {
                'trphc': ('trphc', 'avg_21day_trphc', 'avg_30day_trphc'),
                'homes': ('homes_connected', 'avg_21day_homes', 'avg_30day_homes'),
                'revenue': ('revenue', 'avg_21day_revenue', 'avg_30day_revenue'),
                'true_revenue': ('true_revenue', 'avg_21day_true_revenue', 'avg_30day_true_revenue'),
                'bundles': ('active_bundles', 'avg_21day_bundles', 'avg_30day_bundles'),
                'ab_ratio': ('ab_hc_ratio', 'avg_21day_ab_ratio', 'avg_30day_ab_ratio'),
            }

            if metric_name not in metric_mapping:
                logger.error(f"Unknown metric: {metric_name}")
                return {}

            daily_col, avg_21_col, avg_30_col = metric_mapping[metric_name]

            # Build query
            select_cols = f"report_date, {avg_21_col}, {avg_30_col}"
            if include_daily:
                select_cols += f", {daily_col}"

            sql = f"""
                SELECT {select_cols}
                FROM lawley.daily_metrics
                WHERE {avg_21_col} IS NOT NULL AND {avg_30_col} IS NOT NULL
                ORDER BY report_date ASC
                LIMIT %s
            """

            with get_connection() as conn:
                with conn.cursor(cursor_factory=RealDictCursor) as cur:
                    cur.execute(sql, (days,))
                    results = cur.fetchall()

                    if not results:
                        logger.warning(f"No rolling average history found for {metric_name}")
                        return {}

                    # Convert to output format
                    output = {
                        'dates': [str(row['report_date']) for row in results],
                        'avg_21day': [float(row[avg_21_col]) if row[avg_21_col] is not None else None for row in results],
                        'avg_30day': [float(row[avg_30_col]) if row[avg_30_col] is not None else None for row in results],
                    }

                    if include_daily:
                        output['daily'] = [float(row[daily_col]) if row[daily_col] is not None else None for row in results]

                    logger.debug(f"Retrieved {len(results)} days of rolling average history for {metric_name}")
                    return output

        except Exception as e:
            logger.error(f"Error querying rolling average history for {metric_name}: {e}", exc_info=True)
            return {}

    def get_latest_metrics(self) -> Optional[Dict]:
        """
        Get the most recent metrics entry.

        Returns:
            Dictionary with latest metrics or None
        """
        try:
            sql = """
                SELECT * FROM lawley.daily_metrics
                ORDER BY report_date DESC
                LIMIT 1
            """

            with get_connection() as conn:
                with conn.cursor(cursor_factory=RealDictCursor) as cur:
                    cur.execute(sql)
                    result = cur.fetchone()

                    if result:
                        return dict(result)
                    else:
                        return None

        except Exception as e:
            logger.error(f"Error querying latest metrics: {e}")
            return None

    def count_records(self) -> int:
        """Get total number of records in the table."""
        try:
            sql = "SELECT COUNT(*) as count FROM lawley.daily_metrics"

            with get_connection() as conn:
                with conn.cursor(cursor_factory=RealDictCursor) as cur:
                    cur.execute(sql)
                    result = cur.fetchone()
                    return result['count'] if result else 0

        except Exception as e:
            logger.error(f"Error counting records: {e}")
            return 0
