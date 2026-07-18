"""
Cached Prompts Library for BOSS.

This module provides cache-optimized prompt templates that maximize
Anthropic API prompt caching for 10x cost reduction on cached portions.

Key Principles (2025 Context Engineering):
1. Keep prompt prefix STABLE - no timestamps, no dynamic content at start
2. Make context APPEND-ONLY - never modify previous content
3. Static instructions come FIRST - dynamic content comes AFTER
4. Use deterministic serialization - consistent ordering

Cost Impact:
- Cached input tokens: $0.30/MTok
- Uncached input tokens: $3/MTok
- Savings: 10x on cached portions (typically 60-80% of prompt)
"""

from .cached_prompts import (
    BOSS_SYSTEM_PROMPT,
    EMAIL_DRAFT_SYSTEM_PROMPT,
    KNOWLEDGE_QUERY_SYSTEM_PROMPT,
    build_messages,
    build_email_draft_messages,
    build_knowledge_query_messages,
)

__all__ = [
    "BOSS_SYSTEM_PROMPT",
    "EMAIL_DRAFT_SYSTEM_PROMPT",
    "KNOWLEDGE_QUERY_SYSTEM_PROMPT",
    "build_messages",
    "build_email_draft_messages",
    "build_knowledge_query_messages",
]
