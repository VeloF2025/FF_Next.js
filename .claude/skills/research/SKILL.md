---
name: research
description: Multi-agent research for FibreFlow decisions. Deploys parallel agents to gather information from multiple sources. USE WHEN user says "research", "investigate", "find information", "compare options", "what's the best way to", or needs technical decisions.
---

# Research Skill - FibreFlow

**Purpose:** Deploy multiple research agents in parallel to gather comprehensive information for technical decisions.

## Research Modes

| Mode | Agents | Timeout | Use For |
|------|--------|---------|---------|
| **Quick** | 3 | 2 min | Simple questions, quick lookups |
| **Standard** | 6 | 3 min | Most research needs |
| **Extensive** | 12 | 5 min | Deep analysis, major decisions |

## Trigger Phrases

- "research [topic]"
- "quick research on..."
- "extensive research..."
- "investigate [topic]"
- "find information about..."
- "what's the best way to..."
- "compare [options]"

## Execution Workflow

### Step 1: Decompose Question
Break the research topic into sub-questions:

```
Main: "Best pagination approach for FF"
├── Q1: What pagination patterns exist in Next.js?
├── Q2: How does Neon PostgreSQL handle LIMIT/OFFSET?
├── Q3: What are cursor-based vs offset pagination tradeoffs?
└── Q4: What do similar apps (Vercel, Supabase) use?
```

### Step 2: Launch Parallel Agents

```typescript
// Quick Mode: 3 agents
Task({ prompt: "Search for Next.js pagination patterns 2025", subagent_type: "Explore", model: "haiku" })
Task({ prompt: "Research PostgreSQL pagination performance", subagent_type: "Explore", model: "haiku" })
Task({ prompt: "Find cursor vs offset pagination comparisons", subagent_type: "Explore", model: "haiku" })

// Standard Mode: 6 agents (add more perspectives)
// Extensive Mode: 12 agents (comprehensive coverage)
```

### Step 3: Synthesize Results
After timeout or all agents complete:

1. Collect all findings
2. Identify consensus and conflicts
3. Apply to FF context (Next.js, Neon, Clerk)
4. Provide recommendation with confidence level

## FibreFlow-Specific Research

### Technology Decisions
```
Research question: "Should we add Redis caching?"
├── Agent 1: Redis vs in-memory caching for Next.js
├── Agent 2: Neon connection pooling capabilities
├── Agent 3: Vercel deployment Redis options
├── Agent 4: FF-specific query patterns to cache
├── Agent 5: Cost analysis (Upstash vs self-hosted)
└── Agent 6: Implementation complexity assessment
```

### Library Selection
```
Research question: "Best form library for FF"
├── Agent 1: React Hook Form vs Formik 2025
├── Agent 2: Zod validation integration
├── Agent 3: Next.js App Router form handling
├── Agent 4: Existing FF form patterns
├── Agent 5: Bundle size comparison
└── Agent 6: TypeScript support quality
```

### Architecture Decisions
```
Research question: "Should module X be extracted?"
├── Agent 1: Current module coupling analysis
├── Agent 2: Microservices vs monolith tradeoffs
├── Agent 3: FF deployment architecture (PM2, Vercel)
├── Agent 4: Similar module extractions in codebase
├── Agent 5: API gateway patterns
└── Agent 6: Team capacity assessment
```

## Output Format

```markdown
## Research: [Topic]

### Summary
[2-3 sentence overview]

### Key Findings
1. [Finding with source]
2. [Finding with source]
3. [Finding with source]

### FF-Specific Considerations
- [How it applies to FF stack]
- [Integration with existing patterns]
- [Potential challenges]

### Recommendation
**[Recommended approach]** (Confidence: HIGH/MEDIUM/LOW)

Rationale: [Why this is best for FF]

### Alternatives Considered
- Option A: [Pros/Cons]
- Option B: [Pros/Cons]

### Next Steps
1. [Action item]
2. [Action item]
```

## Quick Research Examples

**"Quick research: best toast library"**
```typescript
// 3 parallel agents
Task({ prompt: "Compare react-hot-toast vs sonner vs react-toastify 2025", model: "haiku" })
Task({ prompt: "Toast library bundle sizes and performance", model: "haiku" })
Task({ prompt: "Next.js App Router toast implementations", model: "haiku" })
```

**"Research: Neon branching strategy"**
```typescript
// 6 parallel agents
Task({ prompt: "Neon database branching best practices", model: "haiku" })
Task({ prompt: "Git-like database branching workflows", model: "haiku" })
Task({ prompt: "Neon branch reset and sync patterns", model: "haiku" })
Task({ prompt: "CI/CD with Neon branches", model: "haiku" })
Task({ prompt: "Neon branch cost optimization", model: "haiku" })
Task({ prompt: "Production to dev data sync strategies", model: "haiku" })
```

## Integration with FF Decisions

After research completes:
1. Document findings in relevant module README
2. Update expertise.yaml if new patterns discovered
3. Create ADR (Architecture Decision Record) for major decisions
4. Update CLAUDE.md if stack preferences change

---

**Key Principle:** Don't guess - research. Multiple perspectives beat single-source answers.
