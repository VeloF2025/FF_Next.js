"""
Tool Management Library for BOSS.

Implements progressive tool discovery and deferred loading:
- Core tools loaded immediately
- Specialized tools loaded on demand
- 85% reduction in initial context size

Based on Claude 4.5 Tool Search Tool pattern.
"""

from .tool_registry import (
    ToolRegistry,
    ToolDefinition,
    ToolCategory,
    get_tool_registry,
)

__all__ = [
    "ToolRegistry",
    "ToolDefinition",
    "ToolCategory",
    "get_tool_registry",
]
