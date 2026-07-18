"""
LLM Management Library for BOSS.

Provides intelligent model selection, routing, and cost optimization
for LLM API calls across all BOSS agents.

Key Features:
- Model tiering (Haiku → Sonnet → Opus) based on task complexity
- Local-first cascade (LocalAI → Claude → Gemini)
- Effort parameter optimization (Claude Opus 4.5)
- Cost tracking and budget management
- 90%+ cost savings via local LLM

Cost Optimization Target: <$600/month at 1,000 ops/month
Updated: 2025-12-02 - Added Local LLM cascade
"""

from .model_router import (
    ModelRouter,
    ModelTier,
    get_model_router,
    route_request,
)

from .local_llm import (
    LocalLLMClient,
    LocalLLMProvider,
    get_local_llm_client,
    is_local_llm_available,
)

from .cascade import (
    LLMCascade,
    CascadeResult,
    CascadeProvider,
    get_llm_cascade,
    cascade_complete,
    cascade_chat,
)

from .claude_agent_sdk import (
    ClaudeAgentSDK,
    AgentConfig,
    AgentResult,
    AgentPermissionMode,
    claude_agent_query,
    get_claude_agent,
)

__all__ = [
    # Model Router
    "ModelRouter",
    "ModelTier",
    "get_model_router",
    "route_request",
    # Local LLM
    "LocalLLMClient",
    "LocalLLMProvider",
    "get_local_llm_client",
    "is_local_llm_available",
    # Cascade
    "LLMCascade",
    "CascadeResult",
    "CascadeProvider",
    "get_llm_cascade",
    "cascade_complete",
    "cascade_chat",
    # Claude Agent SDK
    "ClaudeAgentSDK",
    "AgentConfig",
    "AgentResult",
    "AgentPermissionMode",
    "claude_agent_query",
    "get_claude_agent",
]
