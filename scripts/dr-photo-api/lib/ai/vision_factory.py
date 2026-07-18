"""
Vision Factory - Initialize Vision Router with All Providers

Factory function to create VisionRouter with all configured providers.

Phase 4.7 Implementation - Provider Factory
"""

import logging
from typing import List, Optional
from pathlib import Path

from lib.ai.vision_provider import VisionProvider, ProviderConfig, ProviderType
from lib.ai.vision_router import VisionRouter
from lib.ai.provider_config_loader import ProviderConfigLoader

# Provider implementations
from lib.ai.providers.gemini_vision import GeminiVisionProvider
from lib.ai.providers.openai_vision import OpenAIVisionProvider
from lib.ai.providers.anthropic_vision import AnthropicVisionProvider
from lib.ai.providers.local_clip_vision import LocalCLIPVisionProvider
from lib.ai.providers.gpu_server_vision import GPUServerVisionProvider

logger = logging.getLogger(__name__)


def create_vision_router(
    config_path: Optional[Path] = None,
    enabled_providers: Optional[List[str]] = None
) -> VisionRouter:
    """
    Create VisionRouter with all configured providers.

    Args:
        config_path: Path to configuration YAML file
                    (defaults to config/ai_providers.yaml)
        enabled_providers: List of provider names to enable
                          (None = use config file settings)

    Returns:
        Initialized VisionRouter instance

    Example:
        >>> router = create_vision_router()
        >>> result = await router.evaluate_photo(
        ...     image_path=Path("/photos/ont.jpg"),
        ...     prompt="Verify ONT installation",
        ...     step_config={"step_number": 8}
        ... )
    """
    logger.info("Creating VisionRouter with configured providers")

    # Load configuration
    config_loader = ProviderConfigLoader(config_path=config_path)
    config_loader.load()

    # Validate configuration
    validation_issues = config_loader.validate_configuration()
    if validation_issues:
        logger.warning(
            f"Configuration validation warnings:\n" +
            "\n".join(f"  - {issue}" for issue in validation_issues)
        )

    # Get provider configurations
    provider_configs = config_loader.get_provider_configs()

    # Filter by enabled_providers if specified
    if enabled_providers:
        provider_configs = [
            p for p in provider_configs
            if p.name in enabled_providers
        ]

    # Instantiate providers
    providers: List[VisionProvider] = []

    for config in provider_configs:
        if not config.enabled:
            logger.debug(f"Skipping disabled provider: {config.name}")
            continue

        try:
            provider = _create_provider(config)
            providers.append(provider)
            logger.info(
                f"Initialized provider: {config.name} "
                f"({config.provider_type.value})"
            )

        except Exception as e:
            logger.error(f"Failed to initialize provider {config.name}: {e}")
            continue

    if not providers:
        logger.error("No providers initialized - VisionRouter will have no providers!")

    # Get global configuration
    global_config = config_loader.get_global_config()
    default_provider = global_config.get("default_provider")
    monthly_budget = config_loader.get_monthly_budget()

    # Create VisionRouter
    router = VisionRouter(
        providers=providers,
        default_provider=default_provider,
        monthly_budget=monthly_budget
    )

    logger.info(
        f"VisionRouter created: {len(providers)} providers, "
        f"default={default_provider}, budget=${monthly_budget}"
    )

    return router


def _create_provider(config: ProviderConfig) -> VisionProvider:
    """
    Create provider instance from configuration.

    Args:
        config: Provider configuration

    Returns:
        Initialized VisionProvider instance

    Raises:
        ValueError: If provider type not recognized
    """
    provider_type = config.provider_type

    if provider_type == ProviderType.GEMINI:
        return GeminiVisionProvider(config)

    elif provider_type == ProviderType.OPENAI:
        return OpenAIVisionProvider(config)

    elif provider_type == ProviderType.ANTHROPIC:
        return AnthropicVisionProvider(config)

    elif provider_type == ProviderType.LOCAL_CLIP:
        return LocalCLIPVisionProvider(config)

    elif provider_type == ProviderType.GPU_SERVER:
        return GPUServerVisionProvider(config)

    else:
        raise ValueError(f"Unknown provider type: {provider_type.value}")


async def test_vision_router(
    image_path: Path,
    config_path: Optional[Path] = None
) -> None:
    """
    Test VisionRouter with a sample image.

    Args:
        image_path: Path to test image
        config_path: Optional config file path

    Example:
        >>> await test_vision_router(Path("/photos/test.jpg"))
    """
    logger.info(f"Testing VisionRouter with image: {image_path}")

    # Create router
    router = create_vision_router(config_path=config_path)

    # Test health checks
    logger.info("Running health checks...")
    health_statuses = await router.health_check_all()

    for provider_name, status in health_statuses.items():
        logger.info(f"  {provider_name}: {status.value}")

    # Test evaluation
    logger.info("Testing photo evaluation...")

    test_prompt = """
    Evaluate this fiber optic installation photo.
    Check for:
    - Photo quality (clarity, lighting, focus)
    - Equipment visibility
    - Installation standards compliance
    """

    test_step_config = {
        "step_number": 1,
        "keywords": ["fiber", "installation", "equipment"],
        "expected_content": "fiber optic installation"
    }

    try:
        result = await router.evaluate_photo(
            image_path=image_path,
            prompt=test_prompt,
            step_config=test_step_config
        )

        logger.info(f"Evaluation result:")
        logger.info(f"  Provider: {result.provider}")
        logger.info(f"  Acceptable: {result.is_acceptable}")
        logger.info(f"  Confidence: {result.confidence:.2f}")
        logger.info(f"  Quality Score: {result.quality_score:.2f}")
        logger.info(f"  Cost: ${result.cost:.4f}")
        logger.info(f"  Latency: {result.latency_ms}ms")

        if result.issues:
            logger.info(f"  Issues: {', '.join(result.issues)}")

    except Exception as e:
        logger.error(f"Evaluation failed: {e}")

    # Print router summary
    logger.info("Router summary:")
    summary = router.get_router_summary()

    router_info = summary["router"]
    logger.info(f"  Total calls: {router_info['total_calls']}")
    logger.info(f"  Monthly cost: ${router_info['monthly_cost']:.4f}")
    logger.info(f"  Budget remaining: ${router_info['budget_remaining']:.2f}")
    logger.info(
        f"  Budget used: {router_info['budget_used_percent']:.1f}%"
    )

    logger.info("Provider metrics:")
    for provider_metrics in summary["providers"]:
        logger.info(
            f"  {provider_metrics['provider']}: "
            f"{provider_metrics['total_calls']} calls, "
            f"${provider_metrics['total_cost_usd']:.4f} cost, "
            f"{provider_metrics['avg_latency_ms']:.0f}ms latency"
        )


# Example usage
if __name__ == "__main__":
    import asyncio

    # Test with sample image
    test_image = Path("/path/to/test/image.jpg")

    if test_image.exists():
        asyncio.run(test_vision_router(test_image))
    else:
        logger.error(f"Test image not found: {test_image}")
        logger.info("Skipping test - no image available")
