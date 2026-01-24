#!/usr/bin/env node

/**
 * Token Usage Tracker Hook - FibreFlow
 *
 * Tracks estimated token usage and costs per session.
 * Stores metrics in .claude/metrics/token-usage.json
 *
 * Hook Type: PostToolUse
 */

const fs = require('fs');
const path = require('path');

// Model pricing per 1M tokens (2025/2026 rates)
const MODEL_PRICING = {
  'claude-opus-4-5': { input: 15.0, output: 75.0 },
  'claude-sonnet-4': { input: 3.0, output: 15.0 },
  'claude-haiku': { input: 0.25, output: 1.25 },
  default: { input: 3.0, output: 15.0 },
};

const METRICS_DIR = path.join(process.cwd(), '.claude', 'metrics');
const METRICS_FILE = path.join(METRICS_DIR, 'token-usage.json');

function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function calculateCost(inputTokens, outputTokens) {
  const pricing = MODEL_PRICING.default;
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

function loadSessionMetrics(sessionId) {
  try {
    if (fs.existsSync(METRICS_FILE)) {
      const data = JSON.parse(fs.readFileSync(METRICS_FILE, 'utf-8'));
      if (data.sessions && data.sessions[sessionId]) {
        return data.sessions[sessionId];
      }
    }
  } catch {
    // File doesn't exist or is invalid
  }

  return {
    session_id: sessionId,
    started_at: new Date().toISOString(),
    total_input_tokens: 0,
    total_output_tokens: 0,
    total_cost_usd: 0,
    tool_calls: 0,
    tools_used: {},
  };
}

function saveSessionMetrics(metrics) {
  try {
    if (!fs.existsSync(METRICS_DIR)) {
      fs.mkdirSync(METRICS_DIR, { recursive: true });
    }

    let data = { sessions: {} };

    try {
      if (fs.existsSync(METRICS_FILE)) {
        data = JSON.parse(fs.readFileSync(METRICS_FILE, 'utf-8'));
      }
    } catch {
      // Start fresh
    }

    data.sessions[metrics.session_id] = metrics;

    // Keep only last 7 days of sessions
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const [id, session] of Object.entries(data.sessions)) {
      if (new Date(session.started_at).getTime() < cutoff) {
        delete data.sessions[id];
      }
    }

    fs.writeFileSync(METRICS_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('[token-tracker] Failed to save metrics:', error);
  }
}

async function main() {
  let hookInput = null;

  try {
    // Read from stdin if available
    if (!process.stdin.isTTY) {
      const chunks = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk);
      }
      const input = Buffer.concat(chunks).toString('utf-8');
      if (input.trim()) {
        hookInput = JSON.parse(input);
      }
    }
  } catch {
    process.exit(0);
  }

  if (!hookInput?.session_id) {
    process.exit(0);
  }

  // Estimate tokens
  const inputText = JSON.stringify(hookInput.tool_input || {});
  const outputText = hookInput.tool_result || '';

  const inputTokens = estimateTokens(inputText);
  const outputTokens = estimateTokens(outputText);
  const cost = calculateCost(inputTokens, outputTokens);

  // Load and update session metrics
  const session = loadSessionMetrics(hookInput.session_id);
  session.total_input_tokens += inputTokens;
  session.total_output_tokens += outputTokens;
  session.total_cost_usd += cost;
  session.tool_calls += 1;
  session.tools_used[hookInput.tool_name] =
    (session.tools_used[hookInput.tool_name] || 0) + 1;

  // Save metrics
  saveSessionMetrics(session);

  // Log summary every 10 tool calls
  if (session.tool_calls % 10 === 0) {
    const totalTokens = session.total_input_tokens + session.total_output_tokens;
    console.error(
      `\n[token-tracker] Session: ${session.tool_calls} calls | ` +
        `${totalTokens.toLocaleString()} tokens | ` +
        `$${session.total_cost_usd.toFixed(4)} est.\n`
    );
  }

  process.exit(0);
}

main().catch(() => {
  process.exit(0);
});
