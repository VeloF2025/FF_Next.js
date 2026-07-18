"""
Vision Router - Intelligent Provider Selection and Fallback Cascade

Manages multiple AI vision providers with automatic fallback, cost optimization,
and provider health monitoring.

Phase 4.6 Implementation - Vision Provider Routing
"""

import logging
import asyncio
from typing import Dict, Any, List, Optional, Tuple
from pathlib import Path
from datetime import datetime

from lib.ai.vision_provider import (
    VisionProvider,
    VisionResult,
    ProviderConfig,
    ProviderStatus,
    ProviderError,
    ProviderType
)

logger = logging.getLogger(__name__)


class VisionRouter:
    """
    Intelligent router for vision providers.

    Responsibilities:
    - Select optimal provider based on cost, quality, and availability
    - Automatic fallback cascade on provider failure
    - Provider health monitoring
    - Cost tracking and budget management
    - Performance metrics aggregation

    Provider Cascade Strategy:
    1. Local CLIP (FREE) - Basic quality checks
    2. Gemini Flash (CHEAP) - Standard verification
    3. GPT-4 Vision (MEDIUM) - High-quality fallback
    4. Claude 3 Opus (EXPENSIVE) - Critical steps only

    User Requirements from Plan:
    - Provider fallback cascade
    - Cost optimization (<$600/month)
    - Health checks before use
    - Automatic retry on failure
    """

    def __init__(
        self,
        providers: List[VisionProvider],
        default_provider: Optional[str] = None,
        monthly_budget: float = 600.0
    ):
        """
        Initialize vision router.

        Args:
            providers: List of available vision providers
            default_provider: Name of default provider (or None for auto-select)
            monthly_budget: Monthly budget limit in USD
        """
        self.providers: Dict[str, VisionProvider] = {}
        self.monthly_budget = monthly_budget
        self.monthly_cost = 0.0
        self.total_calls = 0

        # Register providers
        for provider in providers:
            self.providers[provider.config.name] = provider
            logger.info(f"Registered vision provider: {provider.config.name}")

        # Set default provider
        self.default_provider = default_provider
        if not self.default_provider and self.providers:
            # Auto-select highest priority available provider
            available = [
                p for p in providers
                if p.status == ProviderStatus.AVAILABLE
            ]
            if available:
                self.default_provider = sorted(
                    available,
                    key=lambda p: p.config.priority
                )[0].config.name
                logger.info(f"Auto-selected default provider: {self.default_provider}")

        logger.info(
            f"VisionRouter initialized: {len(self.providers)} providers, "
            f"default={self.default_provider}, budget=${monthly_budget}"
        )

    async def evaluate_photo(
        self,
        image_path: Path,
        prompt: str,
        step_config: Dict[str, Any],
        provider_name: Optional[str] = None,
        allow_fallback: bool = True,
        max_retries: int = 3
    ) -> VisionResult:
        """
        Evaluate photo using optimal provider with automatic fallback.

        Args:
            image_path: Path to image file
            prompt: Evaluation prompt
            step_config: Step configuration
            provider_name: Specific provider to use (or None for auto-select)
            allow_fallback: Whether to try fallback providers on failure
            max_retries: Maximum retry attempts per provider

        Returns:
            VisionResult with evaluation

        Raises:
            ProviderError: If all providers fail
        """
        # Select provider
        if provider_name:
            provider = self.providers.get(provider_name)
            if not provider:
                raise ProviderError(
                    f"Provider not found: {provider_name}",
                    provider=provider_name
                )
            providers_to_try = [provider]
        else:
            # Auto-select providers based on cascade strategy
            providers_to_try = self._select_provider_cascade(step_config)

        # Try providers in order
        errors = []

        for provider in providers_to_try:
            # Check health before use
            health_status = await provider.health_check()

            if health_status != ProviderStatus.AVAILABLE:
                logger.warning(
                    f"Provider {provider.config.name} not available: {health_status.value}"
                )
                errors.append(f"{provider.config.name}: {health_status.value}")
                continue

            # Check budget
            if not self._check_budget(provider.config.cost_per_call):
                logger.warning(
                    f"Skipping {provider.config.name} - would exceed monthly budget"
                )
                errors.append(f"{provider.config.name}: budget exceeded")
                continue

            # Try provider with retries
            for attempt in range(max_retries):
                try:
                    logger.info(
                        f"Attempting evaluation with {provider.config.name} "
                        f"(attempt {attempt + 1}/{max_retries})"
                    )

                    result = await provider.evaluate_photo(
                        image_path=image_path,
                        prompt=prompt,
                        step_config=step_config
                    )

                    # Track cost
                    self.monthly_cost += result.cost
                    self.total_calls += 1

                    logger.info(
                        f"Evaluation successful with {provider.config.name}: "
                        f"acceptable={result.is_acceptable}, "
                        f"confidence={result.confidence:.2f}, "
                        f"cost=${result.cost:.4f}"
                    )

                    return result

                except ProviderError as e:
                    logger.error(
                        f"Provider {provider.config.name} failed "
                        f"(attempt {attempt + 1}/{max_retries}): {e}"
                    )

                    if attempt < max_retries - 1:
                        # Wait before retry (exponential backoff)
                        await asyncio.sleep(2 ** attempt)
                    else:
                        # Last attempt failed
                        errors.append(f"{provider.config.name}: {str(e)}")

            # Provider exhausted all retries
            if not allow_fallback:
                break

        # All providers failed
        error_summary = "\n".join(errors)
        raise ProviderError(
            f"All providers failed:\n{error_summary}",
            provider="VisionRouter"
        )

    def _select_provider_cascade(
        self,
        step_config: Dict[str, Any]
    ) -> List[VisionProvider]:
        """
        Select providers in cascade order based on step requirements.

        Cascade Strategy:
        - Simple steps: CLIP → Gemini → GPT-4 → Claude
        - Critical steps: Gemini → GPT-4 → Claude → CLIP
        - Complex analysis: GPT-4 → Claude → Gemini → CLIP

        Args:
            step_config: Step configuration

        Returns:
            List of providers in priority order
        """
        step_number = step_config.get("step_number", 0)
        is_critical = step_config.get("is_critical", False)
        requires_text_extraction = step_config.get("requires_text_extraction", False)

        # Critical steps need high-quality providers
        if is_critical or requires_text_extraction:
            cascade_priority = [
                ProviderType.OPENAI,      # GPT-4V - Best for critical
                ProviderType.ANTHROPIC,   # Claude 3 - Excellent quality
                ProviderType.GEMINI,      # Gemini - Good quality
                ProviderType.LOCAL_CLIP   # CLIP - Fallback only
            ]
        else:
            # Standard steps: cost-optimize
            cascade_priority = [
                ProviderType.LOCAL_CLIP,  # CLIP - FREE first attempt
                ProviderType.GEMINI,      # Gemini - Cheap and good
                ProviderType.OPENAI,      # GPT-4V - Higher quality
                ProviderType.ANTHROPIC    # Claude - Highest quality
            ]

        # Build provider list from cascade priority
        providers_in_order = []

        for provider_type in cascade_priority:
            # Find provider of this type
            matching_providers = [
                p for p in self.providers.values()
                if p.config.provider_type == provider_type
                and p.config.enabled
                and p.status != ProviderStatus.DISABLED
            ]

            if matching_providers:
                # Use highest priority provider of this type
                provider = sorted(
                    matching_providers,
                    key=lambda p: p.config.priority
                )[0]
                providers_in_order.append(provider)

        logger.debug(
            f"Provider cascade for step {step_number}: "
            f"{[p.config.name for p in providers_in_order]}"
        )

        return providers_in_order

    def _check_budget(self, cost: float) -> bool:
        """
        Check if cost would exceed monthly budget.

        Args:
            cost: Cost of operation in USD

        Returns:
            True if within budget, False if would exceed
        """
        would_exceed = (self.monthly_cost + cost) > self.monthly_budget

        if would_exceed:
            logger.warning(
                f"Cost ${cost:.4f} would exceed monthly budget: "
                f"${self.monthly_cost:.2f} + ${cost:.4f} > ${self.monthly_budget:.2f}"
            )

        return not would_exceed

    async def batch_evaluate(
        self,
        images: List[Path],
        prompts: List[str],
        step_configs: List[Dict[str, Any]],
        provider_name: Optional[str] = None
    ) -> List[VisionResult]:
        """
        Evaluate multiple photos in batch.

        Args:
            images: List of image paths
            prompts: List of prompts (one per image)
            step_configs: List of step configurations
            provider_name: Specific provider to use (or None for auto-select)

        Returns:
            List of VisionResults
        """
        results = []

        # Try batch evaluation if provider supports it
        if provider_name and provider_name in self.providers:
            provider = self.providers[provider_name]

            try:
                batch_results = await provider.batch_evaluate(
                    images=images,
                    prompts=prompts,
                    step_configs=step_configs
                )

                # Track costs
                for result in batch_results:
                    self.monthly_cost += result.cost
                    self.total_calls += 1

                return batch_results

            except Exception as e:
                logger.warning(f"Batch evaluation failed: {e}. Falling back to sequential.")

        # Sequential evaluation
        for image, prompt, config in zip(images, prompts, step_configs):
            try:
                result = await self.evaluate_photo(
                    image_path=image,
                    prompt=prompt,
                    step_config=config,
                    provider_name=provider_name
                )
                results.append(result)

            except Exception as e:
                logger.error(f"Batch evaluation error for {image}: {e}")
                # Add error result
                results.append(VisionResult(
                    success=False,
                    confidence=0.0,
                    evaluation=f"Error: {str(e)}",
                    is_acceptable=False,
                    quality_score=0.0,
                    issues=[str(e)],
                    matches_step=False,
                    step_confidence=0.0,
                    extracted_data={},
                    provider="VisionRouter",
                    model="batch_error",
                    cost=0.0,
                    latency_ms=0.0,
                    timestamp=datetime.now()
                ))

        return results

    async def health_check_all(self) -> Dict[str, ProviderStatus]:
        """
        Check health of all providers.

        Returns:
            Dictionary mapping provider name to status
        """
        health_statuses = {}

        for name, provider in self.providers.items():
            try:
                status = await provider.health_check()
                health_statuses[name] = status
                logger.info(f"Health check {name}: {status.value}")

            except Exception as e:
                logger.error(f"Health check failed for {name}: {e}")
                health_statuses[name] = ProviderStatus.ERROR

        return health_statuses

    def get_provider_metrics(self) -> List[Dict[str, Any]]:
        """
        Get metrics for all providers.

        Returns:
            List of provider metrics dictionaries
        """
        metrics = []

        for provider in self.providers.values():
            provider_metrics = provider.get_metrics()
            metrics.append(provider_metrics)

        return metrics

    def get_router_summary(self) -> Dict[str, Any]:
        """
        Get overall router summary and metrics.

        Returns:
            Dictionary with router statistics
        """
        # Calculate total provider stats
        total_provider_calls = sum(p._total_calls for p in self.providers.values())
        total_provider_cost = sum(p._total_cost for p in self.providers.values())

        # Get available providers
        available_providers = [
            p.config.name
            for p in self.providers.values()
            if p.status == ProviderStatus.AVAILABLE
        ]

        return {
            "router": {
                "total_calls": self.total_calls,
                "monthly_cost": round(self.monthly_cost, 4),
                "monthly_budget": self.monthly_budget,
                "budget_remaining": round(self.monthly_budget - self.monthly_cost, 4),
                "budget_used_percent": round(
                    (self.monthly_cost / self.monthly_budget) * 100, 2
                ) if self.monthly_budget > 0 else 0,
                "default_provider": self.default_provider,
                "providers_registered": len(self.providers),
                "providers_available": len(available_providers),
                "available_providers": available_providers
            },
            "providers": self.get_provider_metrics()
        }

    def reset_monthly_cost(self):
        """Reset monthly cost counter (call at start of month)."""
        logger.info(
            f"Resetting monthly cost: ${self.monthly_cost:.2f} → $0.00"
        )
        self.monthly_cost = 0.0

    def set_monthly_budget(self, budget: float):
        """
        Update monthly budget limit.

        Args:
            budget: New monthly budget in USD
        """
        logger.info(
            f"Updating monthly budget: ${self.monthly_budget:.2f} → ${budget:.2f}"
        )
        self.monthly_budget = budget

    async def get_provider_by_name(self, name: str) -> Optional[VisionProvider]:
        """
        Get provider by name.

        Args:
            name: Provider name

        Returns:
            VisionProvider or None if not found
        """
        return self.providers.get(name)

    def get_cheapest_available_provider(self) -> Optional[VisionProvider]:
        """
        Get the cheapest currently available provider.

        Returns:
            VisionProvider or None if none available
        """
        available = [
            p for p in self.providers.values()
            if p.status == ProviderStatus.AVAILABLE
        ]

        if not available:
            return None

        return sorted(available, key=lambda p: p.config.cost_per_call)[0]

    def get_highest_quality_provider(self) -> Optional[VisionProvider]:
        """
        Get the highest quality currently available provider.

        Returns:
            VisionProvider or None if none available
        """
        available = [
            p for p in self.providers.values()
            if p.status == ProviderStatus.AVAILABLE
        ]

        if not available:
            return None

        return sorted(available, key=lambda p: -p.config.accuracy_score)[0]
