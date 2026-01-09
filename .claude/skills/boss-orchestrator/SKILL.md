---
name: boss-orchestrator
description: Multi-agent task orchestration for FibreFlow. Routes complex tasks to parallel workers for faster execution. USE WHEN user says "parallelize", "run in parallel", "orchestrate", "multi-agent", "delegate tasks", or when handling complex multi-step tasks.
---

# BOSS Orchestrator - FibreFlow

**Purpose:** Orchestrate parallel Claude agents for complex FibreFlow tasks.

## When to Use

- Complex feature implementations (multiple files)
- Batch operations across modules
- Research + implementation tasks
- Code review across codebase
- Database + API + UI changes together

## Architecture

```
              ┌─────────────────────┐
              │  BOSS ORCHESTRATOR  │
              │  (You - Main Agent) │
              └──────────┬──────────┘
                         │
       ┌─────────────────┼─────────────────┐
       │                 │                 │
       ▼                 ▼                 ▼
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│   WORKER 1  │  │   WORKER 2  │  │   WORKER 3  │
│  (Task A)   │  │  (Task B)   │  │  (Task C)   │
└─────────────┘  └─────────────┘  └─────────────┘
```

## Execution Pattern

### Step 1: Decompose Task
Break complex tasks into independent subtasks:

```
Complex Task: "Add pagination to all list pages"
├── Worker 1: Update ProjectsPage pagination
├── Worker 2: Update ContractorsPage pagination
├── Worker 3: Update DropsPage pagination
└── Worker 4: Update shared Pagination component
```

### Step 2: Launch Parallel Workers
Use Task tool with multiple calls in ONE message:

```typescript
// Launch all workers in parallel (single message)
Task({
  prompt: "Add pagination to src/modules/projects/...",
  subagent_type: "code-implementation",
  model: "sonnet"  // Use sonnet for implementation
})
Task({
  prompt: "Add pagination to src/modules/contractors/...",
  subagent_type: "code-implementation",
  model: "sonnet"
})
Task({
  prompt: "Add pagination to src/modules/sow/...",
  subagent_type: "code-implementation",
  model: "sonnet"
})
```

### Step 3: Synthesize Results
After workers complete, review and integrate:

1. Check for conflicts
2. Run type-check: `npm run type-check`
3. Run lint: `npm run lint`
4. Test build: `npm run build`

## Model Selection

| Task Type | Model | When to Use |
|-----------|-------|-------------|
| `haiku` | Quick checks, file reading, simple queries | Verification, lookups |
| `sonnet` | Code implementation, standard tasks | Most work |
| `opus` | Architecture, complex reasoning | Big decisions |

## FibreFlow Worker Types

### 1. Code Implementation Worker
**For:** Feature implementation, bug fixes
```typescript
Task({
  prompt: "Implement [feature] in [module]. Follow FF patterns...",
  subagent_type: "code-implementation",
  model: "sonnet"
})
```

### 2. Research Worker
**For:** Codebase exploration, finding patterns
```typescript
Task({
  prompt: "Find all usages of [pattern] in FF codebase...",
  subagent_type: "Explore",
  model: "haiku"
})
```

### 3. Validation Worker
**For:** Code verification, anti-hallucination
```typescript
Task({
  prompt: "Verify [component] exists and has [methods]...",
  subagent_type: "antihall-validator",
  model: "haiku"
})
```

### 4. WA Monitor Worker
**For:** WhatsApp monitoring tasks
```typescript
Task({
  prompt: "Check wa-monitor service status...",
  subagent_type: "wa-agent",
  model: "sonnet"
})
```

## Common Orchestration Patterns

### Pattern 1: Feature + Tests + Docs
```
Orchestrate:
├── Worker 1: Implement feature (sonnet)
├── Worker 2: Write tests (sonnet)
└── Worker 3: Update docs (haiku)
```

### Pattern 2: Multi-Module Update
```
Orchestrate:
├── Worker 1: Update Module A (sonnet)
├── Worker 2: Update Module B (sonnet)
├── Worker 3: Update Module C (sonnet)
└── Worker 4: Update shared types (sonnet)
```

### Pattern 3: Research + Implement
```
Orchestrate:
├── Worker 1: Research existing patterns (haiku)
├── Worker 2: Find related code (haiku)
└── [Wait for results]
├── Worker 3: Implement based on research (sonnet)
```

## Parallelization Rules

**DO Parallelize:**
- Independent file changes
- Research across different areas
- Tests for different modules
- Documentation updates

**DON'T Parallelize:**
- Sequential dependencies (A needs B's output)
- Shared state modifications
- Database migrations
- Git operations

## Validation After Orchestration

Always run after parallel work:

```bash
# Quick validation
npm run type-check && npm run lint

# Full validation
npm run build
```

## Example Usage

**User:** "Add error handling to all API routes"

**Orchestrator Response:**
```
Decomposing into parallel tasks:
1. Worker: Update /api/projects routes
2. Worker: Update /api/contractors routes
3. Worker: Update /api/sow routes
4. Worker: Update /api/wa-monitor routes

Launching 4 workers in parallel...
[Uses 4 Task tool calls in single message]
```

---

**Key Principle:** When tasks are independent, parallelize. When dependent, sequence. Always validate after.
