"""
Vision Provider - Abstract Base Class for AI Vision Models

Provides unified interface for multiple AI vision providers (Gemini, GPT-4V, Claude, Local CLIP).
Enables flexible provider selection, cost optimization, and automatic fallback.

Phase 4.1 Implementation - Multi-Model AI Support
"""

import logging
from abc import ABC, abstractmethod
from typing import Dict, Any, Optional, List
from pathlib import Path
from dataclasses import dataclass
from enum import Enum
from datetime import datetime

logger = logging.getLogger(__name__)


class ProviderType(Enum):
    """AI vision provider types."""
    GEMINI = "gemini"
    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    LOCAL_CLIP = "local_clip"
    GPU_SERVER = "gpu_server"


class ProviderStatus(Enum):
    """Provider availability status."""
    AVAILABLE = "available"
    UNAVAILABLE = "unavailable"
    RATE_LIMITED = "rate_limited"
    ERROR = "error"
    DISABLED = "disabled"


@dataclass
class VisionResult:
    """
    Result from vision model evaluation.

    Standardized output across all providers.
    """
    # Core results
    success: bool
    confidence: float  # 0.0-1.0
    evaluation: str  # Text evaluation/description

    # Photo quality assessment
    is_acceptable: bool
    quality_score: float  # 0.0-1.0
    issues: List[str]  # List of detected issues

    # Step matching
    matches_step: bool
    step_confidence: float  # 0.0-1.0

    # Extracted data
    extracted_data: Dict[str, Any]  # Serial numbers, barcodes, etc.

    # Metadata
    provider: str
    model: str
    cost: float  # USD
    latency_ms: float
    timestamp: datetime

    # Raw response (for debugging)
    raw_response: Optional[Dict[str, Any]] = None


@dataclass
class ProviderConfig:
    """Configuration for a vision provider."""
    name: str
    provider_type: ProviderType
    enabled: bool

    # Model configuration
    model: str
    api_key: Optional[str]
    endpoint: Optional[str]

    # Cost and performance
    cost_per_call: float  # USD
    avg_latency_ms: float
    max_requests_per_minute: int

    # Quality metrics
    accuracy_score: float  # 0.0-1.0 based on benchmarks
    reliability_score: float  # 0.0-1.0 based on uptime

    # Priority and fallback
    priority: int  # 1 = highest priority
    use_as_fallback: bool


class VisionProvider(ABC):
    """
    Abstract base class for AI vision providers.

    All vision providers must implement this interface to ensure
    consistent behavior and enable provider swapping.

    User Requirements:
    - Support multiple AI providers (Gemini, GPT-4V, Claude, Local CLIP)
    - Automatic fallback on provider failure
    - Cost tracking per provider
    - Performance metrics tracking
    """

    def __init__(self, config: ProviderConfig):
        """
        Initialize vision provider.

        Args:
            config: Provider configuration
        """
        self.config = config
        self.status = ProviderStatus.AVAILABLE
        self._total_calls = 0
        self._total_cost = 0.0
        self._total_latency_ms = 0.0
        self._error_count = 0

        logger.info(
            f"Vision provider initialized: {config.name} ({config.provider_type.value})"
        )

    @abstractmethod
    async def evaluate_photo(
        self,
        image_path: Path,
        prompt: str,
        step_config: Dict[str, Any]
    ) -> VisionResult:
        """
        Evaluate a photo using the vision model.

        Args:
            image_path: Path to image file
            prompt: Evaluation prompt/instructions
            step_config: Configuration for verification step (keywords, features, etc.)

        Returns:
            VisionResult with evaluation details

        Raises:
            ProviderError: If provider unavailable or request fails

        Example:
            >>> provider = GeminiVisionProvider(config)
            >>> result = await provider.evaluate_photo(
            ...     image_path=Path("/photos/ont_serial.jpg"),
            ...     prompt="Verify ONT serial number is visible and readable",
            ...     step_config={
            ...         "step_number": 8,
            ...         "keywords": ["serial", "barcode", "SN:"],
            ...         "expected_content": "ONT serial number or barcode"
            ...     }
            ... )
            >>> print(result.is_acceptable)
            True
        """
        pass

    @abstractmethod
    async def health_check(self) -> ProviderStatus:
        """
        Check provider health and availability.

        Returns:
            ProviderStatus indicating current availability

        Example:
            >>> status = await provider.health_check()
            >>> if status == ProviderStatus.AVAILABLE:
            ...     # Use provider
        """
        pass

    @abstractmethod
    async def batch_evaluate(
        self,
        images: List[Path],
        prompts: List[str],
        step_configs: List[Dict[str, Any]]
    ) -> List[VisionResult]:
        """
        Evaluate multiple photos in batch (if provider supports batching).

        Args:
            images: List of image paths
            prompts: List of prompts (one per image)
            step_configs: List of step configurations

        Returns:
            List of VisionResults

        Note:
            Default implementation calls evaluate_photo() sequentially.
            Providers with native batch support should override this.
        """
        results = []

        for image, prompt, config in zip(images, prompts, step_configs):
            try:
                result = await self.evaluate_photo(image, prompt, config)
                results.append(result)
            except Exception as e:
                logger.error(f"Batch evaluation error for {image}: {e}")
                # Return error result
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
                    provider=self.config.name,
                    model=self.config.model,
                    cost=0.0,
                    latency_ms=0.0,
                    timestamp=datetime.now()
                ))

        return results

    def get_metrics(self) -> Dict[str, Any]:
        """
        Get provider performance metrics.

        Returns:
            Dictionary with performance statistics
        """
        avg_latency = (
            self._total_latency_ms / self._total_calls
            if self._total_calls > 0
            else 0.0
        )

        error_rate = (
            self._error_count / self._total_calls
            if self._total_calls > 0
            else 0.0
        )

        return {
            "provider": self.config.name,
            "type": self.config.provider_type.value,
            "status": self.status.value,
            "total_calls": self._total_calls,
            "total_cost_usd": round(self._total_cost, 4),
            "avg_cost_per_call": round(
                self._total_cost / self._total_calls if self._total_calls > 0 else 0.0,
                4
            ),
            "avg_latency_ms": round(avg_latency, 2),
            "error_count": self._error_count,
            "error_rate": round(error_rate, 4),
            "uptime": round(1.0 - error_rate, 4)
        }

    def _track_call(self, cost: float, latency_ms: float, success: bool):
        """
        Track metrics for a provider call.

        Args:
            cost: Cost in USD
            latency_ms: Latency in milliseconds
            success: Whether call succeeded
        """
        self._total_calls += 1
        self._total_cost += cost
        self._total_latency_ms += latency_ms

        if not success:
            self._error_count += 1

            # Update status if too many errors
            if self._total_calls >= 10:
                error_rate = self._error_count / self._total_calls
                if error_rate > 0.5:
                    self.status = ProviderStatus.ERROR
                    logger.warning(
                        f"Provider {self.config.name} marked as ERROR "
                        f"(error rate: {error_rate:.2%})"
                    )

    def reset_metrics(self):
        """Reset provider metrics (for testing or periodic cleanup)."""
        self._total_calls = 0
        self._total_cost = 0.0
        self._total_latency_ms = 0.0
        self._error_count = 0
        logger.info(f"Provider {self.config.name} metrics reset")


class ProviderError(Exception):
    """Exception raised when provider operation fails."""

    def __init__(
        self,
        message: str,
        provider: str,
        original_error: Optional[Exception] = None
    ):
        """
        Initialize provider error.

        Args:
            message: Error message
            provider: Provider name
            original_error: Original exception (if any)
        """
        self.provider = provider
        self.original_error = original_error
        super().__init__(f"[{provider}] {message}")
