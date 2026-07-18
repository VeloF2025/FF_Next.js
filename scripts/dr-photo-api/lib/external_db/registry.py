"""
External Database Registry

Manages external database configurations from JSON file.
Singleton pattern for application-wide access.
"""

import os
import json
import logging
from pathlib import Path
from typing import Dict, List, Optional
from lib.external_db.models import (
    ExternalDatabaseConfig,
    DatabaseRegistryConfig,
    DatabaseType,
    AccessMode
)

logger = logging.getLogger(__name__)


class ExternalDBRegistry:
    """
    Registry for external database configurations.

    Loads database configurations from JSON file and environment variables.
    Singleton pattern ensures only one registry instance exists.
    """

    _instance: Optional["ExternalDBRegistry"] = None
    _initialized: bool = False

    def __new__(cls) -> "ExternalDBRegistry":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(
        self,
        config_path: Optional[str] = None
    ):
        if ExternalDBRegistry._initialized:
            return

        self.config_path = config_path or self._get_default_config_path()
        self.databases: Dict[str, ExternalDatabaseConfig] = {}
        self._load_config()
        ExternalDBRegistry._initialized = True
        logger.info(f"External DB Registry initialized with {len(self.databases)} databases")

    def _get_default_config_path(self) -> str:
        """Get default configuration file path."""
        # Check for BOSS_ROOT or use relative path
        boss_root = os.getenv("BOSS_ROOT", "")
        if boss_root:
            return os.path.join(boss_root, "data", "external_dbs.json")

        # Try relative to current file
        current_dir = Path(__file__).parent.parent.parent
        return str(current_dir / "data" / "external_dbs.json")

    def _load_config(self) -> None:
        """Load configuration from JSON file."""
        if not os.path.exists(self.config_path):
            logger.warning(f"Config file not found: {self.config_path}")
            logger.info("Creating default configuration...")
            self._create_default_config()
            return

        try:
            with open(self.config_path, "r") as f:
                data = json.load(f)

            config = DatabaseRegistryConfig(**data)

            for db_config in config.databases:
                if db_config.enabled:
                    self.databases[db_config.name] = db_config
                    logger.info(f"Loaded database config: {db_config.name}")
                else:
                    logger.debug(f"Skipping disabled database: {db_config.name}")

        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON in config file: {e}")
            raise
        except Exception as e:
            logger.error(f"Failed to load config: {e}")
            raise

    def _create_default_config(self) -> None:
        """Create default configuration with FibreFlow."""
        default_config = DatabaseRegistryConfig(
            version="1.0.0",
            description="External database registry for BOSS",
            databases=[
                ExternalDatabaseConfig(
                    name="fibreflow",
                    display_name="FibreFlow Production (Neon)",
                    database_type=DatabaseType.POSTGRESQL,
                    connection_url_env="FIBREFLOW_DATABASE_URL",
                    access_mode=AccessMode.READ_ONLY,
                    allowed_schemas=["public"],
                    pool_min_size=1,
                    pool_max_size=3,
                    connection_timeout=30,
                    query_timeout=60,
                    description="FibreFlow Next.js production database on Neon PostgreSQL",
                    owner="FibreFlow Team",
                    enabled=True
                )
            ]
        )

        # Add to registry
        for db_config in default_config.databases:
            if db_config.enabled:
                self.databases[db_config.name] = db_config

        # Save to file
        self.save_config()

    def save_config(self) -> None:
        """Save current configuration to JSON file."""
        config = DatabaseRegistryConfig(
            databases=list(self.databases.values())
        )

        # Ensure directory exists
        os.makedirs(os.path.dirname(self.config_path), exist_ok=True)

        with open(self.config_path, "w") as f:
            json.dump(config.model_dump(), f, indent=2, default=str)

        logger.info(f"Saved configuration to {self.config_path}")

    def get(self, name: str) -> Optional[ExternalDatabaseConfig]:
        """Get database configuration by name."""
        return self.databases.get(name)

    def list_databases(self) -> List[ExternalDatabaseConfig]:
        """List all registered databases."""
        return list(self.databases.values())

    def register(self, config: ExternalDatabaseConfig) -> None:
        """Register a new database configuration."""
        self.databases[config.name] = config
        self.save_config()
        logger.info(f"Registered database: {config.name}")

    def unregister(self, name: str) -> bool:
        """Unregister a database configuration."""
        if name in self.databases:
            del self.databases[name]
            self.save_config()
            logger.info(f"Unregistered database: {name}")
            return True
        return False

    def get_connection_url(self, name: str) -> Optional[str]:
        """
        Get connection URL for a database.

        Resolves the environment variable specified in the config.
        """
        config = self.get(name)
        if not config:
            logger.warning(f"Database not found: {name}")
            return None

        url = os.getenv(config.connection_url_env)
        if not url:
            logger.warning(
                f"Environment variable {config.connection_url_env} not set "
                f"for database {name}"
            )
            return None

        return url

    def is_read_only(self, name: str) -> bool:
        """Check if database is configured as read-only."""
        config = self.get(name)
        if not config:
            return True  # Default to read-only for safety
        # Handle both enum objects and string values (Pydantic use_enum_values)
        access_mode = config.access_mode
        if hasattr(access_mode, 'value'):
            return access_mode == AccessMode.READ_ONLY
        return access_mode == "read_only"

    @classmethod
    def reset(cls) -> None:
        """Reset singleton instance (for testing)."""
        cls._instance = None
        cls._initialized = False
