#!/bin/bash
# Browser MCP Reminder Hook
# Warns when boss-ghost-mcp is used instead of claude-in-chrome

TOOL_NAME="${TOOL_NAME:-}"

if [[ "$TOOL_NAME" == mcp__boss-ghost-mcp__* ]] || [[ "$TOOL_NAME" == mcp__chrome-devtools__* ]]; then
  echo "⚠️  WARNING: Use claude-in-chrome (mcp__claude-in-chrome__*) instead of ${TOOL_NAME%%__*}"
  echo ""
  echo "Run Claude with: claude --chrome"
  echo "Then use mcp__claude-in-chrome__tabs_context_mcp first"
  exit 0  # Don't block, just warn
fi

exit 0
