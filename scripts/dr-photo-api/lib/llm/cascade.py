"""
LLM Cascade for BOSS - Cost-Optimized Multi-Tier LLM Strategy.

Implements local-first cascade for maximum cost savings:
1. Try LocalAI (FREE) first
2. Fall back to Claude API if local fails or confidence low
3. Track costs and success rates

Cost Savings Target:
- 90%+ operations handled by LocalAI (FREE)
- Claude API only for complex tasks or fallback
- Estimated savings: $500+/month

Generated: 2025-12-02
Authority: BOSS-EXEC Implementation Plan - Local LLM Integration
"""

import os
import logging
from typing import Optional, Dict, Any, List, Callable
from dataclasses import dataclass
from enum import Enum
from datetime import datetime
import asyncio

# Load environment variables from .env file for API keys
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # dotenv not available, rely on system environment

from lib.llm.local_llm import LocalLLMClient, get_local_llm_client
from lib.llm.model_router import (
    ModelRouter,
    ModelTier,
    get_model_router,
    route_request,
)

logger = logging.getLogger(__name__)


class CascadeProvider(Enum):
    """LLM providers in cascade order."""
    LOCAL = "local"      # LocalAI/Ollama (FREE)
    CLAUDE = "claude"    # Claude API (PAID)
    GEMINI = "gemini"    # Gemini API (FREE tier available)


@dataclass
class CascadeResult:
    """Result from cascade LLM call."""
    success: bool
    text: str
    provider: CascadeProvider
    model: str
    latency_ms: float
    tokens_used: int
    cost: float
    confidence: float
    error: Optional[str] = None


class LLMCascade:
    """
    Cost-optimized LLM cascade with local-first strategy.

    Priority order:
    1. LocalAI - FREE, fast, private
    2. Claude API - Paid, high quality
    3. Gemini API - Fallback with free tier

    Usage:
        cascade = LLMCascade()

        # Simple completion
        result = await cascade.complete(
            prompt="Draft a meeting confirmation email",
            task_type="draft_email"
        )

        if result.success:
            print(f"Response: {result.text}")
            print(f"Provider: {result.provider.value}")
            print(f"Cost: ${result.cost}")

        # Chat completion
        result = await cascade.chat(
            messages=[
                {"role": "user", "content": "Hello!"}
            ],
            task_type="simple_qa"
        )
    """

    def __init__(
        self,
        local_client: Optional[LocalLLMClient] = None,
        model_router: Optional[ModelRouter] = None,
        prefer_local: bool = True,
        local_confidence_threshold: float = 0.7,
        enable_claude_fallback: bool = True,
        enable_gemini_fallback: bool = True
    ):
        """
        Initialize LLM cascade.

        Args:
            local_client: LocalLLM client (or uses singleton)
            model_router: Model router (or uses singleton)
            prefer_local: Try local LLM first for supported tasks
            local_confidence_threshold: Min confidence to accept local response
            enable_claude_fallback: Allow Claude API fallback
            enable_gemini_fallback: Allow Gemini API fallback
        """
        self.local_client = local_client or get_local_llm_client()
        self.model_router = model_router or get_model_router()
        self.prefer_local = prefer_local
        self.local_confidence_threshold = local_confidence_threshold
        self.enable_claude_fallback = enable_claude_fallback
        self.enable_gemini_fallback = enable_gemini_fallback

        # Track cascade statistics
        self._stats = {
            "total_requests": 0,
            "local_success": 0,
            "claude_fallback": 0,
            "gemini_fallback": 0,
            "total_cost": 0.0,
            "saved_cost": 0.0,  # Cost that would have been spent on Claude
        }

        # Tasks suitable for local LLM (simpler tasks)
        self._local_suitable_tasks = {
            "classify_email",
            "classify_document",
            "draft_email",
            "reply_email",
            "simple_qa",
            "summarize_document",
            "extract_entities",
            "validate_format",
            "route_request",
        }

        # Tasks that MUST use Claude (complex reasoning)
        self._claude_required_tasks = {
            "financial_analysis",
            "legal_review",
            "strategic_planning",
            "complex_reasoning",
            "multi_document_synthesis",
            "architecture_design",
            "proposal_writing",
        }

        logger.info(
            f"LLMCascade initialized (prefer_local={prefer_local}, "
            f"threshold={local_confidence_threshold})"
        )

    async def complete(
        self,
        prompt: str,
        task_type: str = "general",
        max_tokens: int = 2048,
        temperature: float = 0.7,
        force_provider: Optional[CascadeProvider] = None
    ) -> CascadeResult:
        """
        Generate text completion with cascade fallback.

        Args:
            prompt: Input prompt
            task_type: Type of task for routing
            max_tokens: Maximum tokens to generate
            temperature: Sampling temperature
            force_provider: Force specific provider (skip cascade)

        Returns:
            CascadeResult with response and metadata
        """
        start_time = datetime.now()
        self._stats["total_requests"] += 1

        # Determine provider order
        providers = self._get_provider_order(task_type, force_provider)

        for provider in providers:
            try:
                result = await self._try_provider(
                    provider=provider,
                    prompt=prompt,
                    task_type=task_type,
                    max_tokens=max_tokens,
                    temperature=temperature,
                    is_chat=False
                )

                if result.success:
                    # Track statistics
                    self._update_stats(result, task_type)
                    return result

            except Exception as e:
                logger.warning(f"Provider {provider.value} failed: {e}")
                continue

        # All providers failed
        latency_ms = (datetime.now() - start_time).total_seconds() * 1000
        return CascadeResult(
            success=False,
            text="",
            provider=providers[-1] if providers else CascadeProvider.LOCAL,
            model="unknown",
            latency_ms=latency_ms,
            tokens_used=0,
            cost=0.0,
            confidence=0.0,
            error="All providers failed"
        )

    async def chat(
        self,
        messages: List[Dict[str, str]],
        task_type: str = "general",
        max_tokens: int = 2048,
        temperature: float = 0.7,
        force_provider: Optional[CascadeProvider] = None
    ) -> CascadeResult:
        """
        Generate chat completion with cascade fallback.

        Args:
            messages: List of message dicts
            task_type: Type of task for routing
            max_tokens: Maximum tokens to generate
            temperature: Sampling temperature
            force_provider: Force specific provider

        Returns:
            CascadeResult with response and metadata
        """
        start_time = datetime.now()
        self._stats["total_requests"] += 1

        providers = self._get_provider_order(task_type, force_provider)

        for provider in providers:
            try:
                result = await self._try_provider(
                    provider=provider,
                    messages=messages,
                    task_type=task_type,
                    max_tokens=max_tokens,
                    temperature=temperature,
                    is_chat=True
                )

                if result.success:
                    self._update_stats(result, task_type)
                    return result

            except Exception as e:
                logger.warning(f"Provider {provider.value} failed: {e}")
                continue

        latency_ms = (datetime.now() - start_time).total_seconds() * 1000
        return CascadeResult(
            success=False,
            text="",
            provider=providers[-1] if providers else CascadeProvider.LOCAL,
            model="unknown",
            latency_ms=latency_ms,
            tokens_used=0,
            cost=0.0,
            confidence=0.0,
            error="All providers failed"
        )

    def _get_provider_order(
        self,
        task_type: str,
        force_provider: Optional[CascadeProvider]
    ) -> List[CascadeProvider]:
        """Determine provider order for cascade."""
        if force_provider:
            return [force_provider]

        # Complex tasks go directly to Claude
        if task_type in self._claude_required_tasks:
            providers = [CascadeProvider.CLAUDE]
            if self.enable_gemini_fallback:
                providers.append(CascadeProvider.GEMINI)
            return providers

        # Simple tasks try local first
        if self.prefer_local and task_type in self._local_suitable_tasks:
            providers = [CascadeProvider.LOCAL]
            if self.enable_claude_fallback:
                providers.append(CascadeProvider.CLAUDE)
            if self.enable_gemini_fallback:
                providers.append(CascadeProvider.GEMINI)
            return providers

        # Default: Claude with fallbacks
        providers = []
        if self.enable_claude_fallback:
            providers.append(CascadeProvider.CLAUDE)
        if self.enable_gemini_fallback:
            providers.append(CascadeProvider.GEMINI)
        if self.prefer_local:
            providers.insert(0, CascadeProvider.LOCAL)

        return providers

    async def _try_provider(
        self,
        provider: CascadeProvider,
        task_type: str,
        max_tokens: int,
        temperature: float,
        is_chat: bool,
        prompt: Optional[str] = None,
        messages: Optional[List[Dict[str, str]]] = None
    ) -> CascadeResult:
        """Try a specific provider."""
        start_time = datetime.now()

        if provider == CascadeProvider.LOCAL:
            return await self._try_local(
                prompt=prompt,
                messages=messages,
                max_tokens=max_tokens,
                temperature=temperature,
                is_chat=is_chat
            )

        elif provider == CascadeProvider.CLAUDE:
            return await self._try_claude(
                prompt=prompt,
                messages=messages,
                task_type=task_type,
                max_tokens=max_tokens,
                temperature=temperature,
                is_chat=is_chat
            )

        elif provider == CascadeProvider.GEMINI:
            return await self._try_gemini(
                prompt=prompt,
                messages=messages,
                max_tokens=max_tokens,
                temperature=temperature,
                is_chat=is_chat
            )

        else:
            raise ValueError(f"Unknown provider: {provider}")

    async def _try_local(
        self,
        prompt: Optional[str],
        messages: Optional[List[Dict[str, str]]],
        max_tokens: int,
        temperature: float,
        is_chat: bool
    ) -> CascadeResult:
        """Try LocalAI provider."""
        start_time = datetime.now()

        # Check availability
        if not await self.local_client.is_available():
            raise RuntimeError("LocalAI not available")

        try:
            if is_chat and messages:
                text = await self.local_client.chat_complete(
                    messages=messages,
                    max_tokens=max_tokens,
                    temperature=temperature
                )
            elif prompt:
                text = await self.local_client.complete(
                    prompt=prompt,
                    max_tokens=max_tokens,
                    temperature=temperature
                )
            else:
                raise ValueError("No prompt or messages provided")

            latency_ms = (datetime.now() - start_time).total_seconds() * 1000

            # Estimate confidence based on response quality
            confidence = self._estimate_local_confidence(text)

            # Check if response meets threshold
            if confidence < self.local_confidence_threshold:
                logger.info(
                    f"Local response below threshold "
                    f"({confidence:.2f} < {self.local_confidence_threshold})"
                )
                raise RuntimeError("Response confidence too low")

            return CascadeResult(
                success=True,
                text=text,
                provider=CascadeProvider.LOCAL,
                model="granite-micro",
                latency_ms=latency_ms,
                tokens_used=len(text.split()) * 2,  # Rough estimate
                cost=0.0,  # FREE!
                confidence=confidence
            )

        except Exception as e:
            logger.warning(f"Local LLM failed: {e}")
            raise

    async def _try_claude(
        self,
        prompt: Optional[str],
        messages: Optional[List[Dict[str, str]]],
        task_type: str,
        max_tokens: int,
        temperature: float,
        is_chat: bool
    ) -> CascadeResult:
        """Try Claude API provider."""
        start_time = datetime.now()

        # Use model router to get optimal Claude model
        config, params = route_request(task_type)

        try:
            # Import Anthropic client
            from anthropic import AsyncAnthropic

            client = AsyncAnthropic(
                api_key=os.getenv("ANTHROPIC_API_KEY")
            )

            # Build messages for Claude
            if is_chat and messages:
                claude_messages = messages
            elif prompt:
                claude_messages = [{"role": "user", "content": prompt}]
            else:
                raise ValueError("No prompt or messages provided")

            response = await client.messages.create(
                model=config.model_id,
                max_tokens=max_tokens,
                messages=claude_messages
            )

            text = response.content[0].text
            latency_ms = (datetime.now() - start_time).total_seconds() * 1000

            # Calculate cost
            input_tokens = response.usage.input_tokens
            output_tokens = response.usage.output_tokens
            cost = (
                (input_tokens / 1000) * config.cost_per_1k_input +
                (output_tokens / 1000) * config.cost_per_1k_output
            )

            return CascadeResult(
                success=True,
                text=text,
                provider=CascadeProvider.CLAUDE,
                model=config.model_id,
                latency_ms=latency_ms,
                tokens_used=input_tokens + output_tokens,
                cost=cost,
                confidence=0.95  # Claude high confidence
            )

        except Exception as e:
            logger.warning(f"Claude API failed: {e}")
            raise

    async def _try_gemini(
        self,
        prompt: Optional[str],
        messages: Optional[List[Dict[str, str]]],
        max_tokens: int,
        temperature: float,
        is_chat: bool
    ) -> CascadeResult:
        """Try Gemini API provider (free tier fallback)."""
        start_time = datetime.now()

        try:
            import google.generativeai as genai

            genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))
            model = genai.GenerativeModel("gemini-2.0-flash-exp")

            # Build prompt for Gemini
            if is_chat and messages:
                full_prompt = "\n".join(
                    f"{m['role']}: {m['content']}" for m in messages
                )
            elif prompt:
                full_prompt = prompt
            else:
                raise ValueError("No prompt or messages provided")

            response = model.generate_content(
                full_prompt,
                generation_config={
                    "max_output_tokens": max_tokens,
                    "temperature": temperature
                }
            )

            text = response.text
            latency_ms = (datetime.now() - start_time).total_seconds() * 1000

            return CascadeResult(
                success=True,
                text=text,
                provider=CascadeProvider.GEMINI,
                model="gemini-2.0-flash-exp",
                latency_ms=latency_ms,
                tokens_used=len(text.split()) * 2,
                cost=0.0,  # Free tier
                confidence=0.85
            )

        except Exception as e:
            logger.warning(f"Gemini API failed: {e}")
            raise

    def _estimate_local_confidence(self, text: str) -> float:
        """
        Estimate confidence score for local LLM response.

        Heuristics:
        - Length: Too short may be incomplete
        - Coherence: Check for common issues
        - Format: Well-structured responses score higher

        Updated 2025-12-02: Made more lenient for local models like granite-micro
        """
        if not text:
            logger.debug("Confidence: 0.0 (empty response)")
            return 0.0

        # Very short responses are OK for classification
        if len(text) < 10:
            logger.debug(f"Confidence: 0.5 (very short: {len(text)} chars)")
            return 0.5

        # Start with higher base confidence - local models are trustworthy
        confidence = 0.75  # Increased from 0.7

        # Length bonuses
        if len(text) > 50:
            confidence += 0.05
        if len(text) > 100:
            confidence += 0.05
        if len(text) > 500:
            confidence += 0.05

        # Check for truncation/incomplete (less harsh penalty)
        if text.endswith("...") or text.endswith(".."):
            confidence -= 0.1  # Reduced from 0.2

        # Check for repetition (sign of poor generation)
        words = text.split()
        if len(words) > 20:
            unique_ratio = len(set(words)) / len(words)
            if unique_ratio < 0.2:  # Very high repetition
                confidence -= 0.3
                logger.debug(f"Confidence penalty: high repetition (ratio={unique_ratio:.2f})")
            elif unique_ratio < 0.3:  # Moderate repetition
                confidence -= 0.15

        # Check for nonsense patterns (markdown artifacts)
        if "###" in text or "---" * 3 in text:
            confidence -= 0.1  # Reduced from 0.2

        # Check for common failure patterns
        failure_patterns = [
            "I cannot", "I'm unable", "I don't have",
            "error", "exception", "failed"
        ]
        text_lower = text.lower()
        for pattern in failure_patterns:
            if pattern in text_lower:
                confidence -= 0.1
                break

        final_confidence = max(0.0, min(1.0, confidence))
        logger.debug(f"Confidence: {final_confidence:.2f} (len={len(text)})")
        return final_confidence

    def _update_stats(self, result: CascadeResult, task_type: str):
        """Update cascade statistics."""
        self._stats["total_cost"] += result.cost

        if result.provider == CascadeProvider.LOCAL:
            self._stats["local_success"] += 1
            # Estimate saved cost (what Claude would have cost)
            estimated_claude_cost = 0.003  # ~$0.003 for small request
            self._stats["saved_cost"] += estimated_claude_cost

        elif result.provider == CascadeProvider.CLAUDE:
            self._stats["claude_fallback"] += 1

        elif result.provider == CascadeProvider.GEMINI:
            self._stats["gemini_fallback"] += 1

        logger.info(
            f"Cascade: {result.provider.value} for {task_type} "
            f"(cost=${result.cost:.4f}, latency={result.latency_ms:.0f}ms)"
        )

    def get_stats(self) -> Dict[str, Any]:
        """Get cascade statistics."""
        total = self._stats["total_requests"]
        local = self._stats["local_success"]

        return {
            "total_requests": total,
            "local_success": local,
            "local_success_rate": round(local / total * 100, 1) if total > 0 else 0,
            "claude_fallback": self._stats["claude_fallback"],
            "gemini_fallback": self._stats["gemini_fallback"],
            "total_cost": round(self._stats["total_cost"], 4),
            "saved_cost": round(self._stats["saved_cost"], 4),
            "savings_pct": round(
                self._stats["saved_cost"] /
                (self._stats["total_cost"] + self._stats["saved_cost"]) * 100, 1
            ) if (self._stats["total_cost"] + self._stats["saved_cost"]) > 0 else 0,
        }


# =============================================================================
# SINGLETON INSTANCE
# =============================================================================

_cascade_instance: Optional[LLMCascade] = None


def get_llm_cascade() -> LLMCascade:
    """Get singleton LLMCascade instance."""
    global _cascade_instance

    if _cascade_instance is None:
        _cascade_instance = LLMCascade()

    return _cascade_instance


async def cascade_complete(
    prompt: str,
    task_type: str = "general",
    **kwargs
) -> CascadeResult:
    """Convenience function for cascade completion."""
    cascade = get_llm_cascade()
    return await cascade.complete(prompt, task_type, **kwargs)


async def cascade_chat(
    messages: List[Dict[str, str]],
    task_type: str = "general",
    **kwargs
) -> CascadeResult:
    """Convenience function for cascade chat."""
    cascade = get_llm_cascade()
    return await cascade.chat(messages, task_type, **kwargs)
