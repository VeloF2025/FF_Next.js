"""
Context management utilities for BOSS.

This module provides token-aware context building and management
to optimize LLM API calls through intelligent context pruning
and prioritization.

Key Features:
- Token-aware context assembly with budget limits
- Priority-based content inclusion
- Automatic truncation for oversized content
- Context contracts for consistent behavior

2025 Optimization: Based on Anthropic's context engineering best practices
for achieving 40-70% token cost reduction.
"""

from .token_aware_builder import TokenAwareContextBuilder, ContextPriority

__all__ = ["TokenAwareContextBuilder", "ContextPriority"]
