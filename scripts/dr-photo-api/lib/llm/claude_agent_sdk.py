"""
Claude Code SDK Agent Wrapper for BOSS.

Provides autonomous agent capabilities using the claude-code-sdk.
Uses OAuth token (sk-ant-oat01-...) for authentication.

Features:
- Full Claude Code tooling (Bash, Read, Write, Grep, Glob, etc.)
- MCP server integration (Playwright, Memory, Context7, GitHub)
- Multi-turn conversations with context preservation
- Autonomous agent execution with permission controls
- Cost tracking and usage monitoring

Generated: 2025-12-05
Authority: BOSS Claude Code SDK Integration
"""

import os
import asyncio
import logging
from typing import Optional, Dict, Any, List, AsyncIterator, Callable, Union
from dataclasses import dataclass, field
from enum import Enum
from datetime import datetime

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

logger = logging.getLogger(__name__)


class AgentPermissionMode(Enum):
    """Permission modes for Claude Code SDK agent."""
    DEFAULT = "default"           # Interactive mode, asks for permissions
    ACCEPT_EDITS = "acceptEdits"  # Auto-accept file edits
    PLAN_MODE = "plan"            # Planning mode only
    BYPASS_PERMISSIONS = "bypassPermissions"  # Full autonomous (dangerous)


@dataclass
class AgentResult:
    """Result from a Claude Code SDK agent query."""
    success: bool
    result: str
    duration_ms: int
    duration_api_ms: int
    num_turns: int
    session_id: str
    total_cost_usd: float
    usage: Dict[str, Any]
    model: str
    tools_available: List[str] = field(default_factory=list)
    mcp_servers: List[Dict[str, str]] = field(default_factory=list)
    error: Optional[str] = None


@dataclass
class AgentConfig:
    """Configuration for Claude Code SDK agent."""
    system_prompt: Optional[str] = None
    max_turns: int = 10
    permission_mode: AgentPermissionMode = AgentPermissionMode.ACCEPT_EDITS
    working_directory: Optional[str] = None
    allowed_tools: Optional[List[str]] = None
    disallowed_tools: Optional[List[str]] = None
    model: Optional[str] = None  # e.g., "claude-sonnet-4-5-20250929"
    timeout_seconds: int = 300


class ClaudeAgentSDK:
    """
    Claude Code SDK wrapper for autonomous agent capabilities.

    Uses CLAUDE_CODE_API_KEY (OAuth token) for authentication.
    Falls back to ANTHROPIC_API_KEY if OAuth token not available.

    Example usage:
        agent = ClaudeAgentSDK()
        result = await agent.query("Write a Python function to calculate fibonacci")
        print(result.result)
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        config: Optional[AgentConfig] = None
    ):
        """
        Initialize Claude Agent SDK.

        Args:
            api_key: OAuth token (sk-ant-oat01-...) or standard API key.
                    If not provided, uses CLAUDE_CODE_API_KEY or ANTHROPIC_API_KEY env vars.
            config: Agent configuration options.
        """
        # Prioritize OAuth token, fall back to standard API key
        self.api_key = api_key or os.getenv("CLAUDE_CODE_API_KEY") or os.getenv("ANTHROPIC_API_KEY")

        if not self.api_key:
            raise ValueError(
                "No API key found. Set CLAUDE_CODE_API_KEY (OAuth token) or "
                "ANTHROPIC_API_KEY environment variable."
            )

        self.config = config or AgentConfig()
        self._sdk_available = self._check_sdk_available()

        if not self._sdk_available:
            logger.warning(
                "claude-code-sdk not installed. Install with: pip install claude-code-sdk>=0.0.25"
            )

    def _check_sdk_available(self) -> bool:
        """Check if claude-code-sdk is installed."""
        try:
            import claude_code_sdk
            return True
        except ImportError:
            return False

    async def query(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        max_turns: Optional[int] = None,
        permission_mode: Optional[AgentPermissionMode] = None,
        working_directory: Optional[str] = None,
    ) -> AgentResult:
        """
        Send a query to the Claude Code SDK agent.

        Args:
            prompt: The task or question for the agent.
            system_prompt: Override system prompt for this query.
            max_turns: Override max turns for this query.
            permission_mode: Override permission mode for this query.
            working_directory: Override working directory for this query.

        Returns:
            AgentResult with response and metadata.
        """
        if not self._sdk_available:
            return AgentResult(
                success=False,
                result="",
                duration_ms=0,
                duration_api_ms=0,
                num_turns=0,
                session_id="",
                total_cost_usd=0.0,
                usage={},
                model="",
                error="claude-code-sdk not installed"
            )

        try:
            from claude_code_sdk import query as sdk_query, ClaudeCodeOptions
            from claude_code_sdk import (
                SystemMessage,
                AssistantMessage,
                ResultMessage,
                TextBlock,
            )

            # Build options
            options = ClaudeCodeOptions(
                max_turns=max_turns or self.config.max_turns,
                system_prompt=system_prompt or self.config.system_prompt,
                cwd=working_directory or self.config.working_directory,
                permission_mode=(permission_mode or self.config.permission_mode).value,
            )

            if self.config.allowed_tools:
                options.allowed_tools = self.config.allowed_tools
            if self.config.disallowed_tools:
                options.disallowed_tools = self.config.disallowed_tools
            if self.config.model:
                options.model = self.config.model

            # Set API key in environment for SDK
            original_key = os.environ.get("ANTHROPIC_API_KEY")
            os.environ["ANTHROPIC_API_KEY"] = self.api_key

            try:
                # Collect results
                result_text = ""
                model = ""
                tools_available = []
                mcp_servers = []
                final_result = None

                async for message in sdk_query(prompt=prompt, options=options):
                    if isinstance(message, SystemMessage):
                        if hasattr(message, 'data') and message.data:
                            tools_available = message.data.get('tools', [])
                            mcp_servers = message.data.get('mcp_servers', [])
                            model = message.data.get('model', '')

                    elif isinstance(message, AssistantMessage):
                        if hasattr(message, 'model'):
                            model = message.model
                        if hasattr(message, 'content'):
                            for block in message.content:
                                if isinstance(block, TextBlock):
                                    result_text += block.text

                    elif isinstance(message, ResultMessage):
                        final_result = message

                if final_result:
                    return AgentResult(
                        success=not final_result.is_error,
                        result=final_result.result if hasattr(final_result, 'result') else result_text,
                        duration_ms=final_result.duration_ms if hasattr(final_result, 'duration_ms') else 0,
                        duration_api_ms=final_result.duration_api_ms if hasattr(final_result, 'duration_api_ms') else 0,
                        num_turns=final_result.num_turns if hasattr(final_result, 'num_turns') else 1,
                        session_id=final_result.session_id if hasattr(final_result, 'session_id') else "",
                        total_cost_usd=final_result.total_cost_usd if hasattr(final_result, 'total_cost_usd') else 0.0,
                        usage=final_result.usage if hasattr(final_result, 'usage') else {},
                        model=model,
                        tools_available=tools_available,
                        mcp_servers=mcp_servers,
                    )
                else:
                    return AgentResult(
                        success=True,
                        result=result_text,
                        duration_ms=0,
                        duration_api_ms=0,
                        num_turns=1,
                        session_id="",
                        total_cost_usd=0.0,
                        usage={},
                        model=model,
                        tools_available=tools_available,
                        mcp_servers=mcp_servers,
                    )

            finally:
                # Restore original API key
                if original_key:
                    os.environ["ANTHROPIC_API_KEY"] = original_key
                elif "ANTHROPIC_API_KEY" in os.environ:
                    del os.environ["ANTHROPIC_API_KEY"]

        except Exception as e:
            logger.error(f"Claude Agent SDK query failed: {e}")
            return AgentResult(
                success=False,
                result="",
                duration_ms=0,
                duration_api_ms=0,
                num_turns=0,
                session_id="",
                total_cost_usd=0.0,
                usage={},
                model="",
                error=str(e)
            )

    async def stream_query(
        self,
        prompt: str,
        on_message: Optional[Callable[[Any], None]] = None,
        **kwargs
    ) -> AsyncIterator[Any]:
        """
        Stream responses from Claude Code SDK agent.

        Args:
            prompt: The task or question for the agent.
            on_message: Optional callback for each message.
            **kwargs: Additional options passed to query().

        Yields:
            Messages from the SDK (SystemMessage, AssistantMessage, ResultMessage).
        """
        if not self._sdk_available:
            return

        try:
            from claude_code_sdk import query as sdk_query, ClaudeCodeOptions

            options = ClaudeCodeOptions(
                max_turns=kwargs.get('max_turns', self.config.max_turns),
                system_prompt=kwargs.get('system_prompt', self.config.system_prompt),
                cwd=kwargs.get('working_directory', self.config.working_directory),
                permission_mode=(
                    kwargs.get('permission_mode', self.config.permission_mode)
                ).value if isinstance(kwargs.get('permission_mode', self.config.permission_mode), AgentPermissionMode) else self.config.permission_mode.value,
            )

            # Set API key
            original_key = os.environ.get("ANTHROPIC_API_KEY")
            os.environ["ANTHROPIC_API_KEY"] = self.api_key

            try:
                async for message in sdk_query(prompt=prompt, options=options):
                    if on_message:
                        on_message(message)
                    yield message
            finally:
                if original_key:
                    os.environ["ANTHROPIC_API_KEY"] = original_key
                elif "ANTHROPIC_API_KEY" in os.environ:
                    del os.environ["ANTHROPIC_API_KEY"]

        except Exception as e:
            logger.error(f"Claude Agent SDK stream failed: {e}")
            raise


# Convenience function for one-off queries
async def claude_agent_query(
    prompt: str,
    system_prompt: Optional[str] = None,
    max_turns: int = 10,
    permission_mode: AgentPermissionMode = AgentPermissionMode.ACCEPT_EDITS,
) -> AgentResult:
    """
    Convenience function for simple Claude Agent SDK queries.

    Example:
        result = await claude_agent_query("Write a hello world function in Python")
        print(result.result)
    """
    agent = ClaudeAgentSDK(config=AgentConfig(
        system_prompt=system_prompt,
        max_turns=max_turns,
        permission_mode=permission_mode,
    ))
    return await agent.query(prompt)


# Singleton instance for reuse
_default_agent: Optional[ClaudeAgentSDK] = None


def get_claude_agent(
    config: Optional[AgentConfig] = None,
    force_new: bool = False
) -> ClaudeAgentSDK:
    """
    Get or create a Claude Agent SDK instance.

    Args:
        config: Agent configuration. If None, uses defaults.
        force_new: Force creation of new instance instead of reusing.

    Returns:
        ClaudeAgentSDK instance.
    """
    global _default_agent

    if force_new or _default_agent is None:
        _default_agent = ClaudeAgentSDK(config=config)

    return _default_agent


# Export public interface
__all__ = [
    "ClaudeAgentSDK",
    "AgentConfig",
    "AgentResult",
    "AgentPermissionMode",
    "claude_agent_query",
    "get_claude_agent",
]
