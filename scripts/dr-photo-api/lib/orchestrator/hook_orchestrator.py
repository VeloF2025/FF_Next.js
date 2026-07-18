"""
BOSS Hook Orchestrator - Background Daemon Service

Purpose: Run event bus and hook manager as background service
Authority: Phase 6 - Hook System & Automation
Created: 2025-11-19

Features:
- Start/stop hook system as daemon process
- Auto-discover and register hooks
- Event bus consumer loop
- Health monitoring and recovery
- Graceful shutdown on CTRL+C
- Process management (PID file)

Usage:
    >>> from lib.orchestrator.hook_orchestrator import HookOrchestrator
    >>> orchestrator = HookOrchestrator()
    >>> await orchestrator.start()  # Runs indefinitely
"""

import sys
import asyncio
import signal
from pathlib import Path
from typing import Optional
from loguru import logger

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from lib.events import RedisEventBus
from lib.events.event_store import get_event_store
from dotenv import load_dotenv

# Load environment variables
load_dotenv()


class HookOrchestrator:
    """
    Orchestrate hook system lifecycle as background service.

    Responsibilities:
    - Initialize Redis event bus
    - Discover and register hooks
    - Start event consumer loop
    - Handle graceful shutdown
    - Health monitoring
    - Error recovery

    Example:
        >>> orchestrator = HookOrchestrator(
        ...     hooks_dir=Path(".claude/hooks"),
        ...     consumer_name="boss_orchestrator"
        ... )
        >>> await orchestrator.start()
    """

    def __init__(
        self,
        hooks_dir: Optional[Path] = None,
        redis_url: str = "redis://localhost:6380",
        consumer_name: str = "boss_orchestrator",
        consumer_group: str = "boss_hooks"
    ):
        """
        Initialize Hook Orchestrator.

        Args:
            hooks_dir: Directory containing hook files (defaults to .claude/hooks)
            redis_url: Redis connection URL
            consumer_name: Unique consumer identifier
            consumer_group: Consumer group name
        """
        # Default to .claude/hooks in project root
        if hooks_dir is None:
            hooks_dir = project_root / ".claude" / "hooks"

        self.hooks_dir = Path(hooks_dir)
        self.redis_url = redis_url
        self.consumer_name = consumer_name
        self.consumer_group = consumer_group

        # Components
        self.event_bus: Optional[RedisEventBus] = None
        self.hook_manager = None
        self.event_store = None  # PostgreSQL event store

        # Lifecycle state
        self.running = False
        self.shutdown_event = asyncio.Event()

        logger.info(
            f"HookOrchestrator initialized "
            f"(hooks_dir={self.hooks_dir}, consumer={consumer_name})"
        )

    async def start(self):
        """
        Start hook orchestrator as background service.

        This is the main entry point - runs indefinitely until stopped.

        Workflow:
        1. Initialize event bus
        2. Discover and register hooks
        3. Start event consumer loop
        4. Run until shutdown signal
        5. Graceful cleanup
        """
        logger.info("🚀 Starting BOSS Hook Orchestrator...")

        # Setup signal handlers for graceful shutdown
        self._setup_signal_handlers()

        try:
            # ================================================================
            # STEP 1: Initialize Event Bus
            # ================================================================
            logger.info(f"📡 Connecting to Redis event bus ({self.redis_url})...")

            self.event_bus = RedisEventBus(
                redis_url=self.redis_url,
                consumer_group=self.consumer_group
            )

            # Test connection
            health = self.event_bus.health_check()
            if health["status"] != "healthy":
                raise RuntimeError(f"Event bus unhealthy: {health}")

            logger.info(
                f"✅ Event bus connected "
                f"(streams={health['streams_subscribed']})"
            )

            # ================================================================
            # STEP 1.5: Initialize Event Store (PostgreSQL)
            # ================================================================
            logger.info("💾 Connecting to PostgreSQL event store...")

            try:
                self.event_store = get_event_store()
                logger.info("✅ Event store connected")
            except Exception as e:
                logger.warning(f"⚠️ Event store connection failed: {e}")
                logger.warning("   Continuing without event persistence")
                self.event_store = None

            # ================================================================
            # STEP 2: Discover and Register Hooks
            # ================================================================
            logger.info(f"🔍 Discovering hooks in {self.hooks_dir}...")

            # Import HookManager here (avoid circular imports)
            from ...claude.hooks.hook_manager import HookManager

            self.hook_manager = HookManager(self.hooks_dir)
            self.hook_manager.discover_hooks()

            discovered_count = len(self.hook_manager.hooks)
            logger.info(f"✅ Discovered {discovered_count} hooks")

            # Register hooks with event bus
            logger.info("📌 Registering hooks with event bus...")
            self.hook_manager.register_with_event_bus(self.event_bus)

            hook_status = self.hook_manager.get_hook_status()
            enabled_count = sum(1 for h in hook_status.values() if h["enabled"])

            logger.info(
                f"✅ Registered {enabled_count} enabled hooks "
                f"({discovered_count - enabled_count} disabled)"
            )

            # ================================================================
            # STEP 3: Start Event Consumer Loop
            # ================================================================
            self.running = True

            logger.info(
                f"🎯 Starting event consumer loop (consumer={self.consumer_name})..."
            )
            logger.info("✨ Hook orchestrator is now active and processing events")
            logger.info("   Press CTRL+C to stop gracefully")

            # Run consumer loop (blocks until shutdown)
            await self._consume_events()

        except KeyboardInterrupt:
            logger.info("🛑 Shutdown requested (CTRL+C)")

        except Exception as e:
            logger.error(f"❌ Orchestrator startup failed: {e}", exc_info=True)
            raise

        finally:
            # Graceful shutdown
            await self.stop()

    async def _consume_events(self):
        """
        Run event consumer loop with health monitoring.

        Continues until shutdown_event is set.
        """
        try:
            # Create consumer task
            consumer_task = asyncio.create_task(
                self.event_bus.consume(
                    consumer_name=self.consumer_name,
                    batch_size=10,
                    block_ms=1000
                )
            )

            # Create health check task
            health_task = asyncio.create_task(self._health_monitor())

            # Wait for shutdown signal or task failure
            await asyncio.wait(
                [consumer_task, health_task, self._wait_for_shutdown()],
                return_when=asyncio.FIRST_COMPLETED
            )

            # Cancel remaining tasks
            if not consumer_task.done():
                consumer_task.cancel()
            if not health_task.done():
                health_task.cancel()

        except asyncio.CancelledError:
            logger.info("🛑 Consumer loop cancelled")

    async def _health_monitor(self):
        """
        Periodically check orchestrator health.

        Logs status every 60 seconds for monitoring.
        """
        while self.running:
            try:
                await asyncio.sleep(60)  # Check every minute

                # Event bus health
                event_bus_health = self.event_bus.health_check()

                # Hook manager health
                hook_health = self.hook_manager.health_check()

                logger.info(
                    f"💚 Health Check - "
                    f"Event Bus: {event_bus_health['status']}, "
                    f"Hooks: {hook_health['enabled_hooks']}/{hook_health['total_hooks']} enabled, "
                    f"Executions: {hook_health['total_executions']} "
                    f"(success rate: {hook_health['success_rate']:.1f}%)"
                )

                # Warn if failed events
                failed_count = len(self.event_bus.get_failed_events())
                if failed_count > 0:
                    logger.warning(
                        f"⚠️ {failed_count} failed events in dead letter queue"
                    )

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"❌ Health monitor error: {e}")

    async def _wait_for_shutdown(self):
        """Wait for shutdown event to be set."""
        await self.shutdown_event.wait()

    def _setup_signal_handlers(self):
        """
        Setup signal handlers for graceful shutdown.

        Handles SIGINT (CTRL+C) and SIGTERM (kill).
        """
        def handle_signal(signum, frame):
            """Signal handler - triggers graceful shutdown."""
            logger.info(f"📡 Received signal {signum} - initiating shutdown...")
            self.shutdown_event.set()

        # Register signal handlers
        signal.signal(signal.SIGINT, handle_signal)  # CTRL+C
        signal.signal(signal.SIGTERM, handle_signal)  # kill

        logger.debug("✅ Signal handlers registered (SIGINT, SIGTERM)")

    async def stop(self):
        """
        Stop orchestrator gracefully.

        Cleanup:
        - Stop accepting new events
        - Finish processing current events
        - Close Redis connections
        - Log final statistics
        """
        if not self.running:
            logger.debug("Orchestrator already stopped")
            return

        logger.info("🛑 Stopping BOSS Hook Orchestrator...")

        self.running = False

        try:
            # Get final statistics
            if self.hook_manager:
                hook_status = self.hook_manager.get_hook_status()
                total_executions = sum(
                    h["execution_count"] for h in hook_status.values()
                )
                total_failures = sum(
                    h["failure_count"] for h in hook_status.values()
                )

                logger.info(
                    f"📊 Final Statistics: "
                    f"{total_executions} executions, "
                    f"{total_failures} failures "
                    f"({(1 - total_failures/max(total_executions, 1)) * 100:.1f}% success)"
                )

            # Close Redis connection
            if self.event_bus and hasattr(self.event_bus, 'redis'):
                self.event_bus.redis.close()
                logger.info("✅ Redis connection closed")

        except Exception as e:
            logger.error(f"❌ Shutdown cleanup error: {e}")

        logger.info("✅ Hook Orchestrator stopped cleanly")

    def get_status(self) -> dict:
        """
        Get current orchestrator status.

        Returns:
            Status dict with runtime info
        """
        status = {
            "running": self.running,
            "consumer_name": self.consumer_name,
            "consumer_group": self.consumer_group,
            "hooks_dir": str(self.hooks_dir)
        }

        if self.event_bus:
            status["event_bus"] = self.event_bus.health_check()

        if self.hook_manager:
            status["hooks"] = self.hook_manager.health_check()

        return status


async def main():
    """
    Main entry point for standalone execution.

    Usage:
        python -m lib.orchestrator.hook_orchestrator
    """
    orchestrator = HookOrchestrator()

    try:
        await orchestrator.start()
    except KeyboardInterrupt:
        logger.info("🛑 Orchestrator stopped by user")
    except Exception as e:
        logger.error(f"❌ Orchestrator failed: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    # Configure logging for standalone execution
    logger.remove()
    logger.add(
        sys.stderr,
        format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <level>{message}</level>",
        level="INFO"
    )

    # Run orchestrator
    asyncio.run(main())
