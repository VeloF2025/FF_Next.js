---
name: observability
description: Session monitoring and metrics for FibreFlow development. Track tool usage, token costs, and session patterns. USE WHEN user asks about "session stats", "how much did this cost", "what tools were used", "session summary", or wants development metrics.
---

# Observability Skill - FibreFlow

**Purpose:** Monitor and analyze Claude Code sessions for FF development.

## Features

### 1. Token Tracking
Automatic tracking via `token-tracker.ts` hook:
- Estimated input/output tokens per tool call
- Running session cost estimate
- Tool usage frequency
- Stored in `.claude/metrics/token-usage.json`

### 2. Session Metrics
View current session statistics:
```bash
cat .claude/metrics/token-usage.json | jq '.sessions | to_entries | .[-1].value'
```

### 3. Tool Usage Analysis
See which tools are used most:
```bash
cat .claude/metrics/token-usage.json | jq '.sessions | to_entries | .[-1].value.tools_used'
```

## Metrics Available

| Metric | Description |
|--------|-------------|
| `total_input_tokens` | Estimated tokens sent to Claude |
| `total_output_tokens` | Estimated tokens received |
| `total_cost_usd` | Estimated cost (based on Sonnet pricing) |
| `tool_calls` | Number of tool invocations |
| `tools_used` | Breakdown by tool name |

## Cost Estimation

Based on Claude Sonnet 4 pricing:
- Input: $3.00 / 1M tokens
- Output: $15.00 / 1M tokens

```
Example session:
- 50 tool calls
- ~100K input tokens
- ~200K output tokens
- Estimated cost: ~$3.30
```

## Session Summary Command

To get current session summary:

```typescript
// Read metrics file
const metrics = JSON.parse(fs.readFileSync('.claude/metrics/token-usage.json'));
const sessions = Object.values(metrics.sessions);
const current = sessions[sessions.length - 1];

console.log(`
Session: ${current.session_id}
Started: ${current.started_at}
Tool Calls: ${current.tool_calls}
Tokens: ${(current.total_input_tokens + current.total_output_tokens).toLocaleString()}
Est. Cost: $${current.total_cost_usd.toFixed(4)}
`);
```

## Weekly Report

Generate weekly development metrics:

```bash
# View all sessions from last 7 days
cat .claude/metrics/token-usage.json | jq '
  .sessions | to_entries |
  map(select(.value.started_at > (now - 7*24*60*60 | todate))) |
  {
    total_sessions: length,
    total_cost: (map(.value.total_cost_usd) | add),
    total_tool_calls: (map(.value.tool_calls) | add)
  }
'
```

## Optimization Tips

### Reduce Token Usage
1. Use `haiku` model for simple tasks
2. Read specific file sections, not entire files
3. Use Glob/Grep before reading files
4. Parallelize independent tasks

### Track High-Cost Operations
Watch for:
- Large file reads (>1000 lines)
- Full codebase searches
- Multiple failed attempts
- Repeated similar queries

## Dashboard (Future)

The full PAI observability dashboard provides:
- Real-time event streaming
- Agent swim lanes
- Tool usage charts
- Session replay

To enable full dashboard, see PAI documentation.

## Quick Stats Query

```bash
# Today's sessions
cat .claude/metrics/token-usage.json 2>/dev/null | jq -r '
  .sessions | to_entries[] |
  select(.value.started_at | startswith("'$(date +%Y-%m-%d)'")) |
  "\(.value.tool_calls) calls | $\(.value.total_cost_usd | . * 100 | floor / 100) | \(.value.started_at)"
' || echo "No metrics yet"
```

## Alerts

Token tracker logs summary every 10 tool calls:
```
[token-tracker] Session: 45 calls | 125,000 tokens | $2.1500 est.
```

---

**Key Principle:** Measure to improve. Track costs to optimize.
