"""
Model Router for BOSS - Intelligent Model Selection.

Implements cost-optimized model tiering strategy:
- Haiku 4.5: Simple tasks (classification, routing) - $0.0002/request
- Sonnet 4.5: Standard tasks (drafts, analysis) - $0.002/request
- Opus 4.5: Complex tasks (strategy, multi-hop) - $0.01-0.05/request

Research-backed optimization (2025):
- Right-sizing models saves 40-70% on API costs
- Effort parameter provides additional 48-76% savings on Opus
- Gemini fallback ensures resilience during rate limits

Sources:
- Claude Opus 4.5 Announcement (Anthropic, Nov 2025)
- Token Efficiency Best Practices (agiflow.io, sparkco.ai)
"""

import os
import logging
from typing import Dict, Any, Optional, List, Tuple
from dataclasses import dataclass, field
from enum import Enum
from datetime import datetime

logger = logging.getLogger(__name__)


class ModelTier(Enum):
    """Model tiers for cost optimization."""
    HAIKU = "haiku"         # Fast, cheap - classification, routing
    SONNET = "sonnet"       # Balanced - standard tasks
    OPUS = "opus"           # Powerful - complex reasoning
    GEMINI = "gemini"       # Fallback when Anthropic unavailable


class EffortLevel(Enum):
    """Effort levels for Opus 4.5."""
    LOW = "low"         # Fastest, minimum tokens
    MEDIUM = "medium"   # Balanced (DEFAULT)
    HIGH = "high"       # Thorough, more tokens


@dataclass
class ModelConfig:
    """Configuration for a specific model."""
    name: str
    tier: ModelTier
    model_id: str
    max_tokens: int = 4096
    default_effort: Optional[EffortLevel] = None
    supports_effort: bool = False
    cost_per_1k_input: float = 0.0
    cost_per_1k_output: float = 0.0
    use_cases: List[str] = field(default_factory=list)


# =============================================================================
# MODEL CONFIGURATIONS (2025 Pricing)
# =============================================================================

MODELS = {
    # Claude Haiku 4.5 - Fast, cheap
    "haiku": ModelConfig(
        name="Claude Haiku 4.5",
        tier=ModelTier.HAIKU,
        model_id="claude-haiku-4-5-20251022",
        max_tokens=8192,
        supports_effort=False,
        cost_per_1k_input=0.001,
        cost_per_1k_output=0.005,
        use_cases=[
            "classification",
            "routing",
            "simple_extraction",
            "validation",
            "formatting"
        ]
    ),

    # Claude Sonnet 4.5 - Balanced
    "sonnet": ModelConfig(
        name="Claude Sonnet 4.5",
        tier=ModelTier.SONNET,
        model_id="claude-sonnet-4-5-20250929",
        max_tokens=8192,
        supports_effort=False,
        cost_per_1k_input=0.003,
        cost_per_1k_output=0.015,
        use_cases=[
            "email_draft",
            "document_summary",
            "standard_analysis",
            "code_review",
            "content_generation"
        ]
    ),

    # Claude Opus 4.5 - Powerful with effort parameter
    "opus": ModelConfig(
        name="Claude Opus 4.5",
        tier=ModelTier.OPUS,
        model_id="claude-opus-4-5-20251101",
        max_tokens=64000,
        default_effort=EffortLevel.MEDIUM,
        supports_effort=True,
        cost_per_1k_input=0.005,
        cost_per_1k_output=0.025,
        use_cases=[
            "complex_analysis",
            "multi_hop_reasoning",
            "strategic_planning",
            "financial_analysis",
            "legal_review",
            "architecture_design"
        ]
    ),

    # Gemini 2.0 Flash - Fallback
    "gemini": ModelConfig(
        name="Gemini 2.0 Flash",
        tier=ModelTier.GEMINI,
        model_id="gemini-2.0-flash-exp",
        max_tokens=8192,
        supports_effort=False,
        cost_per_1k_input=0.0,  # Free tier
        cost_per_1k_output=0.0,
        use_cases=["fallback", "rate_limit_overflow"]
    ),
}


# =============================================================================
# TASK TYPE TO MODEL MAPPING
# =============================================================================

TASK_ROUTING = {
    # Haiku tasks (simple, fast)
    "classify_email": ModelTier.HAIKU,
    "classify_document": ModelTier.HAIKU,
    "extract_entities": ModelTier.HAIKU,
    "validate_format": ModelTier.HAIKU,
    "route_request": ModelTier.HAIKU,
    "simple_qa": ModelTier.HAIKU,

    # Sonnet tasks (standard)
    "draft_email": ModelTier.SONNET,
    "reply_email": ModelTier.SONNET,
    "summarize_document": ModelTier.SONNET,
    "analyze_content": ModelTier.SONNET,
    "generate_report": ModelTier.SONNET,
    "code_explanation": ModelTier.SONNET,

    # Opus tasks (complex)
    "financial_analysis": ModelTier.OPUS,
    "legal_review": ModelTier.OPUS,
    "strategic_planning": ModelTier.OPUS,
    "complex_reasoning": ModelTier.OPUS,
    "multi_document_synthesis": ModelTier.OPUS,
    "architecture_design": ModelTier.OPUS,
    "proposal_writing": ModelTier.OPUS,
}

# Effort level mapping for Opus tasks
EFFORT_ROUTING = {
    "financial_analysis": EffortLevel.HIGH,
    "legal_review": EffortLevel.HIGH,
    "strategic_planning": EffortLevel.HIGH,
    "proposal_writing": EffortLevel.HIGH,

    "complex_reasoning": EffortLevel.MEDIUM,
    "multi_document_synthesis": EffortLevel.MEDIUM,
    "architecture_design": EffortLevel.MEDIUM,
}


class ModelRouter:
    """
    Intelligent model selection and routing.

    Automatically selects the optimal model based on:
    - Task type and complexity
    - Cost optimization targets
    - Current rate limit status
    - User preferences

    Usage:
        router = ModelRouter()

        # Get recommended model for task
        config, params = router.route("draft_email")

        # Make API call with returned config
        response = client.messages.create(
            model=config.model_id,
            **params
        )
    """

    def __init__(
        self,
        default_tier: ModelTier = ModelTier.SONNET,
        enable_opus_effort: bool = True,
        monthly_budget: float = 600.0,
        enable_fallback: bool = True
    ):
        """
        Initialize model router.

        Args:
            default_tier: Default tier for unknown tasks
            enable_opus_effort: Use effort parameter for Opus
            monthly_budget: Monthly cost budget ($)
            enable_fallback: Enable Gemini fallback
        """
        self.default_tier = default_tier
        self.enable_opus_effort = enable_opus_effort
        self.monthly_budget = monthly_budget
        self.enable_fallback = enable_fallback

        # Cost tracking
        self.current_month_cost = 0.0
        self.request_count = 0
        self.cost_by_tier: Dict[str, float] = {
            tier.value: 0.0 for tier in ModelTier
        }

        logger.info(f"ModelRouter initialized (default={default_tier.value}, budget=${monthly_budget})")

    def route(
        self,
        task_type: str,
        complexity: Optional[str] = None,
        force_tier: Optional[ModelTier] = None,
        context_size: int = 0
    ) -> Tuple[ModelConfig, Dict[str, Any]]:
        """
        Route request to optimal model.

        Args:
            task_type: Type of task (e.g., "draft_email", "financial_analysis")
            complexity: Optional complexity hint ("routine", "standard", "complex")
            force_tier: Force specific tier (override routing)
            context_size: Estimated context size in tokens

        Returns:
            Tuple of (ModelConfig, additional_params)
        """
        # Determine tier
        if force_tier:
            tier = force_tier
        else:
            tier = self._select_tier(task_type, complexity, context_size)

        # Get model config
        config = self._get_config_for_tier(tier)

        # Build additional params
        params = self._build_params(config, task_type, complexity)

        logger.info(
            f"🎯 Routed '{task_type}' → {config.name} "
            f"(tier={tier.value}, effort={params.get('effort', 'N/A')})"
        )

        return config, params

    def _select_tier(
        self,
        task_type: str,
        complexity: Optional[str],
        context_size: int
    ) -> ModelTier:
        """Select optimal tier based on task and complexity."""
        # Check explicit routing
        if task_type in TASK_ROUTING:
            base_tier = TASK_ROUTING[task_type]
        else:
            base_tier = self.default_tier

        # Adjust based on complexity hint
        if complexity:
            if complexity == "routine" and base_tier != ModelTier.HAIKU:
                # Downgrade for routine tasks
                return ModelTier.HAIKU
            elif complexity == "complex" and base_tier == ModelTier.SONNET:
                # Upgrade for complex tasks
                return ModelTier.OPUS

        # Adjust for large context
        if context_size > 50000 and base_tier != ModelTier.OPUS:
            logger.info(f"Upgrading to Opus for large context ({context_size} tokens)")
            return ModelTier.OPUS

        return base_tier

    def _get_config_for_tier(self, tier: ModelTier) -> ModelConfig:
        """Get model config for tier."""
        tier_to_model = {
            ModelTier.HAIKU: "haiku",
            ModelTier.SONNET: "sonnet",
            ModelTier.OPUS: "opus",
            ModelTier.GEMINI: "gemini",
        }

        model_key = tier_to_model.get(tier, "sonnet")
        return MODELS[model_key]

    def _build_params(
        self,
        config: ModelConfig,
        task_type: str,
        complexity: Optional[str]
    ) -> Dict[str, Any]:
        """Build additional parameters for API call."""
        params = {
            "max_tokens": config.max_tokens
        }

        # Add effort parameter for Opus
        if config.supports_effort and self.enable_opus_effort:
            effort = self._select_effort(task_type, complexity)
            params["effort"] = effort.value

        return params

    def _select_effort(
        self,
        task_type: str,
        complexity: Optional[str]
    ) -> EffortLevel:
        """Select effort level for Opus."""
        # Check explicit mapping
        if task_type in EFFORT_ROUTING:
            return EFFORT_ROUTING[task_type]

        # Use complexity hint
        if complexity:
            effort_map = {
                "routine": EffortLevel.LOW,
                "standard": EffortLevel.MEDIUM,
                "complex": EffortLevel.HIGH,
            }
            return effort_map.get(complexity, EffortLevel.MEDIUM)

        return EffortLevel.MEDIUM

    def track_cost(
        self,
        tier: ModelTier,
        input_tokens: int,
        output_tokens: int
    ) -> float:
        """
        Track API cost for budget management.

        Args:
            tier: Model tier used
            input_tokens: Input token count
            output_tokens: Output token count

        Returns:
            Cost for this request
        """
        config = self._get_config_for_tier(tier)

        cost = (
            (input_tokens / 1000) * config.cost_per_1k_input +
            (output_tokens / 1000) * config.cost_per_1k_output
        )

        self.current_month_cost += cost
        self.request_count += 1
        self.cost_by_tier[tier.value] += cost

        # Warn if approaching budget
        if self.current_month_cost > self.monthly_budget * 0.8:
            logger.warning(
                f"⚠️ Budget warning: ${self.current_month_cost:.2f}/"
                f"${self.monthly_budget:.2f} ({self.current_month_cost/self.monthly_budget*100:.0f}%)"
            )

        return cost

    def get_fallback_model(self) -> Optional[ModelConfig]:
        """Get fallback model for rate limit handling."""
        if self.enable_fallback:
            return MODELS["gemini"]
        return None

    def get_stats(self) -> Dict[str, Any]:
        """Get routing statistics."""
        return {
            "request_count": self.request_count,
            "current_month_cost": round(self.current_month_cost, 4),
            "monthly_budget": self.monthly_budget,
            "budget_utilization_pct": round(
                self.current_month_cost / self.monthly_budget * 100, 1
            ) if self.monthly_budget > 0 else 0,
            "cost_by_tier": {
                k: round(v, 4) for k, v in self.cost_by_tier.items()
            },
            "avg_cost_per_request": round(
                self.current_month_cost / self.request_count, 4
            ) if self.request_count > 0 else 0,
        }

    def reset_monthly_tracking(self):
        """Reset monthly cost tracking (call at month start)."""
        self.current_month_cost = 0.0
        self.request_count = 0
        self.cost_by_tier = {tier.value: 0.0 for tier in ModelTier}
        logger.info("Monthly cost tracking reset")


# =============================================================================
# SINGLETON INSTANCE
# =============================================================================

_router_instance: Optional[ModelRouter] = None


def get_model_router() -> ModelRouter:
    """Get singleton ModelRouter instance."""
    global _router_instance

    if _router_instance is None:
        _router_instance = ModelRouter()

    return _router_instance


def route_request(
    task_type: str,
    complexity: Optional[str] = None,
    **kwargs
) -> Tuple[ModelConfig, Dict[str, Any]]:
    """
    Convenience function to route a request.

    Args:
        task_type: Type of task
        complexity: Optional complexity hint
        **kwargs: Additional routing options

    Returns:
        Tuple of (ModelConfig, params)
    """
    router = get_model_router()
    return router.route(task_type, complexity, **kwargs)
