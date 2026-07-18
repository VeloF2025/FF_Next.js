"""
Provider Configuration Loader - Load and Parse AI Provider Configurations

Loads provider configurations from YAML file with environment variable substitution.

Phase 4.7 Implementation - Configuration Management
"""

import os
import logging
import yaml
from typing import Dict, Any, List, Optional
from pathlib import Path

from lib.ai.vision_provider import ProviderConfig, ProviderType

logger = logging.getLogger(__name__)


class ProviderConfigLoader:
    """
    Load and parse AI provider configurations from YAML.

    Features:
    - Environment variable substitution
    - Validation of required fields
    - Provider instantiation
    - Budget management
    - Step-specific overrides
    """

    def __init__(self, config_path: Optional[Path] = None):
        """
        Initialize configuration loader.

        Args:
            config_path: Path to configuration YAML file
                        (defaults to config/ai_providers.yaml)
        """
        if config_path is None:
            # Default to config/ai_providers.yaml in project root
            project_root = Path(__file__).parent.parent.parent
            config_path = project_root / "config" / "ai_providers.yaml"

        self.config_path = config_path
        self.config_data: Dict[str, Any] = {}
        self.providers_config: List[ProviderConfig] = []

        logger.info(f"ProviderConfigLoader initialized: {config_path}")

    def load(self) -> Dict[str, Any]:
        """
        Load configuration from YAML file.

        Returns:
            Dictionary with parsed configuration

        Raises:
            FileNotFoundError: If config file not found
            yaml.YAMLError: If YAML parsing fails
        """
        if not self.config_path.exists():
            raise FileNotFoundError(
                f"Configuration file not found: {self.config_path}"
            )

        logger.info(f"Loading provider configuration from {self.config_path}")

        try:
            with open(self.config_path, 'r') as f:
                raw_config = yaml.safe_load(f)

            # Substitute environment variables
            self.config_data = self._substitute_env_vars(raw_config)

            # Parse provider configurations
            self.providers_config = self._parse_providers(
                self.config_data.get("providers", {})
            )

            logger.info(
                f"Configuration loaded: {len(self.providers_config)} providers"
            )

            return self.config_data

        except yaml.YAMLError as e:
            logger.error(f"YAML parsing error: {e}")
            raise

        except Exception as e:
            logger.error(f"Configuration loading error: {e}")
            raise

    def _substitute_env_vars(self, config: Any) -> Any:
        """
        Recursively substitute environment variables in configuration.

        Supports ${VAR_NAME} syntax.

        Args:
            config: Configuration value (dict, list, str, etc.)

        Returns:
            Configuration with substituted values
        """
        if isinstance(config, dict):
            return {
                key: self._substitute_env_vars(value)
                for key, value in config.items()
            }

        elif isinstance(config, list):
            return [self._substitute_env_vars(item) for item in config]

        elif isinstance(config, str):
            # Check for ${VAR_NAME} pattern
            if config.startswith("${") and config.endswith("}"):
                var_name = config[2:-1]
                env_value = os.getenv(var_name)

                if env_value is None:
                    logger.warning(
                        f"Environment variable not found: {var_name}, using empty string"
                    )
                    return ""

                return env_value

            return config

        else:
            return config

    def _parse_providers(
        self,
        providers_dict: Dict[str, Dict[str, Any]]
    ) -> List[ProviderConfig]:
        """
        Parse provider configurations into ProviderConfig objects.

        Args:
            providers_dict: Dictionary of provider configurations

        Returns:
            List of ProviderConfig objects
        """
        provider_configs = []

        for name, config in providers_dict.items():
            try:
                # Parse provider type
                provider_type_str = config.get("provider_type", "").lower()
                provider_type = ProviderType(provider_type_str)

                # Create ProviderConfig
                provider_config = ProviderConfig(
                    name=name,
                    provider_type=provider_type,
                    enabled=config.get("enabled", True),
                    model=config.get("model", ""),
                    api_key=config.get("api_key"),
                    endpoint=config.get("endpoint"),
                    cost_per_call=config.get("cost_per_call", 0.0),
                    avg_latency_ms=config.get("avg_latency_ms", 1000.0),
                    max_requests_per_minute=config.get("max_requests_per_minute", 60),
                    accuracy_score=config.get("accuracy_score", 0.5),
                    reliability_score=config.get("reliability_score", 0.5),
                    priority=config.get("priority", 10),
                    use_as_fallback=config.get("use_as_fallback", True)
                )

                provider_configs.append(provider_config)

                logger.debug(f"Parsed provider config: {name} ({provider_type.value})")

            except Exception as e:
                logger.error(f"Error parsing provider {name}: {e}")
                continue

        return provider_configs

    def get_provider_configs(self) -> List[ProviderConfig]:
        """
        Get list of provider configurations.

        Returns:
            List of ProviderConfig objects
        """
        if not self.providers_config:
            self.load()

        return self.providers_config

    def get_global_config(self) -> Dict[str, Any]:
        """
        Get global configuration settings.

        Returns:
            Dictionary with global settings
        """
        if not self.config_data:
            self.load()

        return self.config_data.get("global", {})

    def get_budget_config(self) -> Dict[str, Any]:
        """
        Get budget configuration.

        Returns:
            Dictionary with budget settings
        """
        if not self.config_data:
            self.load()

        return self.config_data.get("budget", {})

    def get_fallback_config(self) -> Dict[str, Any]:
        """
        Get fallback configuration.

        Returns:
            Dictionary with fallback settings
        """
        if not self.config_data:
            self.load()

        return self.config_data.get("fallback", {})

    def get_step_overrides(self) -> Dict[str, Any]:
        """
        Get step-specific overrides.

        Returns:
            Dictionary with step override settings
        """
        if not self.config_data:
            self.load()

        return self.config_data.get("step_overrides", {})

    def get_provider_for_step(
        self,
        step_number: int
    ) -> Optional[List[str]]:
        """
        Get preferred providers for specific step.

        Args:
            step_number: Step number (1-12)

        Returns:
            List of preferred provider names, or None for default cascade
        """
        step_overrides = self.get_step_overrides()

        for override_name, override_config in step_overrides.items():
            step_numbers = override_config.get("step_numbers", [])

            if step_number in step_numbers:
                return override_config.get("preferred_providers", [])

        return None

    def get_monthly_budget(self) -> float:
        """
        Get monthly budget limit.

        Returns:
            Monthly budget in USD
        """
        global_config = self.get_global_config()
        budget_config = self.get_budget_config()

        # Try budget config first, then global, then default
        return budget_config.get(
            "monthly_limit",
            global_config.get("monthly_budget", 600.0)
        )

    def get_default_provider(self) -> Optional[str]:
        """
        Get default provider name.

        Returns:
            Default provider name or None
        """
        global_config = self.get_global_config()
        return global_config.get("default_provider")

    def validate_configuration(self) -> List[str]:
        """
        Validate configuration and return list of warnings/errors.

        Returns:
            List of validation messages (empty if valid)
        """
        issues = []

        # Check if configuration loaded
        if not self.config_data:
            try:
                self.load()
            except Exception as e:
                issues.append(f"Failed to load configuration: {e}")
                return issues

        # Check if at least one provider enabled
        enabled_providers = [
            p for p in self.providers_config
            if p.enabled
        ]

        if not enabled_providers:
            issues.append("No providers enabled in configuration")

        # Check for API keys
        for provider in self.providers_config:
            if provider.enabled and provider.provider_type != ProviderType.LOCAL_CLIP:
                if not provider.api_key or provider.api_key == "":
                    issues.append(
                        f"Provider {provider.name} enabled but API key not configured"
                    )

        # Check budget configuration
        budget = self.get_monthly_budget()
        if budget <= 0:
            issues.append(f"Invalid monthly budget: ${budget}")

        # Check fallback configuration
        fallback_config = self.get_fallback_config()
        if not fallback_config:
            issues.append("No fallback configuration defined")

        return issues

    def reload(self):
        """Reload configuration from file."""
        logger.info("Reloading provider configuration")
        self.config_data = {}
        self.providers_config = []
        self.load()
