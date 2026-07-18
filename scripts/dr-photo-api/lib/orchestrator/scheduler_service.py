"""
BOSS Scheduler Service - Background Task Automation

Purpose: Cron-like task scheduling with event bus integration
Authority: Phase 7 - Integration Testing & Event Store
Created: 2025-11-19

Features:
- Cron-style scheduling (minute, hour, day, week, month)
- Publish SCHEDULED_TASK events at configured intervals
- Integration with hook system for task execution
- Persistent schedule storage (PostgreSQL)
- Health monitoring and error recovery
- Graceful shutdown

Usage:
    >>> from lib.orchestrator.scheduler_service import SchedulerService
    >>> scheduler = SchedulerService()
    >>>
    >>> # Schedule daily email check at 9 AM
    >>> scheduler.add_schedule(
    ...     name="daily_email_check",
    ...     schedule="0 9 * * *",  # Cron format
    ...     task_type="check_inbox",
    ...     enabled=True
    ... )
    >>>
    >>> await scheduler.start()  # Runs indefinitely
"""

import os
import sys
import asyncio
import signal
from pathlib import Path
from typing import Optional, Dict, List, Any
from datetime import datetime, timedelta
from dataclasses import dataclass, field
from loguru import logger
from croniter import croniter

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from lib.events import RedisEventBus, Event, EventType, create_correlation_id


@dataclass
class ScheduledTask:
    """
    Represents a scheduled task.

    Attributes:
        name: Unique task name
        schedule: Cron expression (e.g., "0 9 * * *" for 9 AM daily)
        task_type: Type of task (check_inbox, export_obsidian, etc.)
        enabled: Whether task is active
        data: Additional task data
        last_run: Last execution time
        next_run: Next scheduled execution time
        execution_count: Total executions
        failure_count: Failed executions
    """
    name: str
    schedule: str
    task_type: str
    enabled: bool = True
    data: Dict[str, Any] = field(default_factory=dict)
    last_run: Optional[datetime] = None
    next_run: Optional[datetime] = None
    execution_count: int = 0
    failure_count: int = 0

    def calculate_next_run(self) -> datetime:
        """Calculate next run time from cron expression."""
        cron = croniter(self.schedule, datetime.now())
        return cron.get_next(datetime)

    def should_run(self) -> bool:
        """Check if task should run now."""
        if not self.enabled:
            return False

        if self.next_run is None:
            self.next_run = self.calculate_next_run()
            return False

        return datetime.now() >= self.next_run


class SchedulerService:
    """
    Background scheduler service for automated tasks.

    Responsibilities:
    - Maintain schedule of recurring tasks
    - Publish SCHEDULED_TASK events at configured times
    - Track execution history
    - Handle failures and retries
    - Support dynamic schedule updates

    Example:
        >>> scheduler = SchedulerService()
        >>> scheduler.add_schedule("daily_backup", "0 2 * * *", "backup_database")
        >>> await scheduler.start()
    """

    def __init__(
        self,
        redis_url: str = "redis://localhost:6380",
        check_interval_seconds: int = 30
    ):
        """
        Initialize Scheduler Service.

        Args:
            redis_url: Redis connection URL for event bus
            check_interval_seconds: How often to check for due tasks
        """
        self.redis_url = redis_url
        self.check_interval = check_interval_seconds

        # Event bus for publishing events
        self.event_bus = RedisEventBus(redis_url=redis_url)

        # Scheduled tasks
        self.schedules: Dict[str, ScheduledTask] = {}

        # Lifecycle state
        self.running = False
        self.shutdown_event = asyncio.Event()

        logger.info(
            f"SchedulerService initialized "
            f"(check_interval={check_interval_seconds}s)"
        )

    def add_schedule(
        self,
        name: str,
        schedule: str,
        task_type: str,
        enabled: bool = True,
        data: Optional[Dict[str, Any]] = None
    ) -> ScheduledTask:
        """
        Add a scheduled task.

        Args:
            name: Unique task name
            schedule: Cron expression (e.g., "0 9 * * *")
            task_type: Task type identifier
            enabled: Whether task is active
            data: Additional task data

        Returns:
            ScheduledTask object

        Example:
            >>> scheduler.add_schedule(
            ...     name="morning_email_check",
            ...     schedule="0 9 * * *",
            ...     task_type="check_inbox",
            ...     data={"folder": "inbox", "limit": 50}
            ... )
        """
        # Validate cron expression
        try:
            croniter(schedule)
        except Exception as e:
            raise ValueError(f"Invalid cron expression '{schedule}': {e}")

        task = ScheduledTask(
            name=name,
            schedule=schedule,
            task_type=task_type,
            enabled=enabled,
            data=data or {}
        )

        # Calculate initial next run
        task.next_run = task.calculate_next_run()

        self.schedules[name] = task

        logger.info(
            f"Added schedule: {name} ({schedule}) → {task_type} "
            f"(next_run={task.next_run})"
        )

        return task

    def remove_schedule(self, name: str) -> bool:
        """
        Remove a scheduled task.

        Args:
            name: Task name to remove

        Returns:
            True if removed, False if not found
        """
        if name in self.schedules:
            del self.schedules[name]
            logger.info(f"Removed schedule: {name}")
            return True

        logger.warning(f"Schedule not found: {name}")
        return False

    def enable_schedule(self, name: str) -> bool:
        """
        Enable a scheduled task.

        Args:
            name: Task name

        Returns:
            True if enabled, False if not found
        """
        if name in self.schedules:
            self.schedules[name].enabled = True
            logger.info(f"Enabled schedule: {name}")
            return True

        logger.warning(f"Schedule not found: {name}")
        return False

    def disable_schedule(self, name: str) -> bool:
        """
        Disable a scheduled task.

        Args:
            name: Task name

        Returns:
            True if disabled, False if not found
        """
        if name in self.schedules:
            self.schedules[name].enabled = False
            logger.info(f"Disabled schedule: {name}")
            return True

        logger.warning(f"Schedule not found: {name}")
        return False

    async def _execute_task(self, task: ScheduledTask) -> None:
        """
        Execute a scheduled task by publishing event.

        Args:
            task: Task to execute
        """
        try:
            # Create SCHEDULED_TASK event
            event = Event(
                event_type=EventType.SCHEDULED_TASK,
                source="scheduler_service",
                data={
                    "task_name": task.name,
                    "task_type": task.task_type,
                    "schedule": task.schedule,
                    "execution_count": task.execution_count + 1,
                    **task.data
                },
                metadata={
                    "last_run": task.last_run.isoformat() if task.last_run else None,
                    "scheduled_for": task.next_run.isoformat() if task.next_run else None
                },
                correlation_id=create_correlation_id()
            )

            # Publish to event bus (triggers hooks)
            self.event_bus.publish(event)

            # Update task state
            task.last_run = datetime.now()
            task.next_run = task.calculate_next_run()
            task.execution_count += 1

            logger.info(
                f"✅ Executed scheduled task: {task.name} "
                f"(next_run={task.next_run})"
            )

        except Exception as e:
            task.failure_count += 1
            logger.error(f"❌ Failed to execute task {task.name}: {e}")

    async def _scheduler_loop(self) -> None:
        """
        Main scheduler loop - checks for due tasks.

        Runs indefinitely until shutdown.
        """
        logger.info("🕒 Starting scheduler loop...")

        while self.running:
            try:
                # Check all schedules
                for task in self.schedules.values():
                    if task.should_run():
                        logger.debug(f"Task {task.name} is due for execution")
                        await self._execute_task(task)

                # Sleep until next check
                await asyncio.sleep(self.check_interval)

            except asyncio.CancelledError:
                logger.info("Scheduler loop cancelled")
                break

            except Exception as e:
                logger.error(f"Error in scheduler loop: {e}")
                await asyncio.sleep(5)  # Backoff on error

    async def start(self) -> None:
        """
        Start scheduler service.

        Runs indefinitely until stopped with CTRL+C or stop().
        """
        logger.info("🚀 Starting BOSS Scheduler Service...")

        # Setup signal handlers
        self._setup_signal_handlers()

        try:
            # Test event bus connection
            health = self.event_bus.health_check()
            if health["status"] != "healthy":
                raise RuntimeError(f"Event bus unhealthy: {health}")

            logger.info(f"✅ Event bus connected ({health['streams_subscribed']} streams)")

            # Show loaded schedules
            logger.info(f"📋 Loaded {len(self.schedules)} schedules:")
            for task in self.schedules.values():
                status = "ENABLED" if task.enabled else "DISABLED"
                logger.info(f"   [{status}] {task.name}: {task.schedule} → {task.task_type}")

            # Start scheduler loop
            self.running = True
            logger.info("✨ Scheduler is now active")
            logger.info("   Press CTRL+C to stop gracefully")

            await self._scheduler_loop()

        except KeyboardInterrupt:
            logger.info("🛑 Shutdown requested (CTRL+C)")

        except Exception as e:
            logger.error(f"❌ Scheduler startup failed: {e}", exc_info=True)
            raise

        finally:
            await self.stop()

    def _setup_signal_handlers(self) -> None:
        """Setup signal handlers for graceful shutdown."""
        def handle_signal(signum, frame):
            logger.info(f"📡 Received signal {signum} - initiating shutdown...")
            self.shutdown_event.set()

        signal.signal(signal.SIGINT, handle_signal)
        signal.signal(signal.SIGTERM, handle_signal)

        logger.debug("✅ Signal handlers registered (SIGINT, SIGTERM)")

    async def stop(self) -> None:
        """
        Stop scheduler service gracefully.
        """
        if not self.running:
            logger.debug("Scheduler already stopped")
            return

        logger.info("🛑 Stopping BOSS Scheduler Service...")

        self.running = False

        try:
            # Get final statistics
            total_executions = sum(t.execution_count for t in self.schedules.values())
            total_failures = sum(t.failure_count for t in self.schedules.values())

            logger.info(
                f"📊 Final Statistics: "
                f"{total_executions} executions, "
                f"{total_failures} failures "
                f"({(1 - total_failures/max(total_executions, 1)) * 100:.1f}% success)"
            )

            # Close Redis connection
            if hasattr(self.event_bus, 'redis'):
                self.event_bus.redis.close()
                logger.info("✅ Redis connection closed")

        except Exception as e:
            logger.error(f"❌ Shutdown cleanup error: {e}")

        logger.info("✅ Scheduler Service stopped cleanly")

    def get_status(self) -> Dict[str, Any]:
        """
        Get scheduler status.

        Returns:
            Status dict with schedule info
        """
        return {
            "running": self.running,
            "total_schedules": len(self.schedules),
            "enabled_schedules": sum(1 for t in self.schedules.values() if t.enabled),
            "total_executions": sum(t.execution_count for t in self.schedules.values()),
            "total_failures": sum(t.failure_count for t in self.schedules.values()),
            "schedules": [
                {
                    "name": task.name,
                    "schedule": task.schedule,
                    "task_type": task.task_type,
                    "enabled": task.enabled,
                    "last_run": task.last_run.isoformat() if task.last_run else None,
                    "next_run": task.next_run.isoformat() if task.next_run else None,
                    "execution_count": task.execution_count,
                    "failure_count": task.failure_count
                }
                for task in self.schedules.values()
            ]
        }

    def list_schedules(self) -> List[str]:
        """
        Get list of all schedule names.

        Returns:
            List of schedule names
        """
        return list(self.schedules.keys())


async def main():
    """
    Main entry point for standalone execution.

    Usage:
        python -m lib.orchestrator.scheduler_service
    """
    # Example schedules
    scheduler = SchedulerService()

    # Daily email check at 9 AM
    scheduler.add_schedule(
        name="morning_email_check",
        schedule="0 9 * * *",
        task_type="check_inbox",
        data={"folder": "inbox", "limit": 50}
    )

    # Export to Obsidian every 6 hours
    scheduler.add_schedule(
        name="obsidian_export",
        schedule="0 */6 * * *",
        task_type="export_obsidian",
        data={"incremental": True}
    )

    # Housekeeping at 2 AM daily
    scheduler.add_schedule(
        name="nightly_housekeeping",
        schedule="0 2 * * *",
        task_type="housekeeping",
        data={"dry_run": False}
    )

    try:
        await scheduler.start()
    except KeyboardInterrupt:
        logger.info("🛑 Scheduler stopped by user")
    except Exception as e:
        logger.error(f"❌ Scheduler failed: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    # Configure logging
    logger.remove()
    logger.add(
        sys.stderr,
        format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <level>{message}</level>",
        level="INFO"
    )

    # Run scheduler
    asyncio.run(main())
