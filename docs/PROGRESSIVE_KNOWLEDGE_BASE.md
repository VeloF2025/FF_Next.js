# Progressive Knowledge Base System for AI-Assisted Development

A hierarchical context management system that keeps AI assistants informed without flooding the context window.

---

## Overview

When working with AI coding assistants (Claude Code, Cursor, etc.), context is everything. But context windows are limited. This system solves that by:

1. **Layering context** - Global → Project → Module → Session
2. **Loading progressively** - Only what's relevant gets loaded
3. **Persisting learnings** - New knowledge survives between sessions

---

## The Hierarchy

```
~/.claude/CLAUDE.md                    # Layer 1: Global (all projects)
    │
    └── project/CLAUDE.md              # Layer 2: Project-specific
            │
            ├── src/modules/X/README.md    # Layer 3: Module documentation
            │
            └── .claude/session/           # Layer 4: Ephemeral session state
```

**Rule:** More specific layers override more general ones.

---

## Layer 1: Global CLAUDE.md

**Location:** `~/.claude/CLAUDE.md`

**Purpose:** Personal preferences and standards that apply to ALL your projects.

**Size target:** 50-100 lines

### What Belongs Here

- Coding style preferences
- Response format expectations
- Universal quality standards
- Tool preferences
- Communication style

### Example

```markdown
# Global AI Configuration

## Stack Preferences
- TypeScript over Python for web projects
- bun for JS/TS package management (not npm/yarn)
- uv for Python (not pip)

## Response Format
When completing tasks, use this structure:
- SUMMARY: One sentence
- ACTIONS: Steps taken
- RESULTS: Outcomes
- NEXT: Suggested follow-ups

## Quality Standards
- No console.log - use proper logger
- No empty catch blocks
- 100% type coverage on new code
- Max 300 lines per file
- Max 200 lines per component

## Communication
- Be concise
- No emojis unless requested
- Prefer code examples over explanations
```

---

## Layer 2: Project CLAUDE.md

**Location:** `{project-root}/CLAUDE.md`

**Purpose:** Project-specific context that every session needs immediately.

**Size target:** 200-500 lines

### What Belongs Here

- Quick start commands
- Architecture overview
- Key directory structure
- Database configuration (connection strings, not passwords)
- Common patterns and conventions
- Known gotchas and solutions
- Deployment information

### Example

```markdown
# Project: MyApp

## Quick Start
```bash
npm install
npm run dev        # Start dev server on :3000
npm run test       # Run test suite
npm run build      # Production build
```

## Architecture
- **Framework:** Next.js 14 with App Router
- **Database:** PostgreSQL on Neon (serverless)
- **Auth:** Clerk
- **Storage:** AWS S3

## Directory Structure
```
src/
├── modules/       # Feature modules (self-contained)
├── components/    # Shared UI components
├── lib/           # Utilities and helpers
└── types/         # Global TypeScript types

pages/api/         # API routes
scripts/           # Build and maintenance scripts
```

## Database
```bash
# Development
DATABASE_URL='postgresql://user:pass@dev-host/db'

# Production
DATABASE_URL='postgresql://user:pass@prod-host/db'
```

## Conventions

### API Responses
Always use the helper:
```typescript
import { apiResponse } from '@/lib/apiResponse';

return apiResponse.success(res, data);
return apiResponse.notFound(res, 'User', id);
return apiResponse.internalError(res, error);
```

### File Naming
- Components: PascalCase (`UserCard.tsx`)
- Utilities: camelCase (`formatDate.ts`)
- API routes: kebab-case (`user-profile.ts`)

## Common Gotchas

### Nested Dynamic Routes
❌ Fails in production:
```
pages/api/users/[userId]/posts/[postId].ts
```

✅ Works everywhere:
```
pages/api/user-posts.ts?userId=X&postId=Y
```

### Environment Variables
Client-side env vars MUST be prefixed with `NEXT_PUBLIC_`

## Deployment
```bash
# Deploy to staging
./scripts/deploy.sh staging

# Deploy to production
./scripts/deploy.sh production
```
```

---

## Layer 3: Module Documentation

**Location:** `src/modules/{module-name}/README.md`

**Purpose:** Deep context for specific features. Loaded on-demand when working in that area.

**Size target:** As deep as needed (only loaded when relevant)

### What Belongs Here

- Feature overview and purpose
- Database tables and schemas
- API endpoint documentation
- Business logic explanations
- Integration details
- Troubleshooting guides

### Example

```markdown
# WhatsApp Monitor Module

## Overview
Integrates with WhatsApp to receive photo submissions from field technicians and process them through a QA workflow.

## Architecture
```
wa-monitor/
├── components/     # React components
├── services/       # API service layer
├── types/          # TypeScript interfaces
├── hooks/          # Custom React hooks
└── utils/          # Helper functions
```

## Database Tables

### qa_photo_reviews
Main table for photo submissions.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| drop_number | text | DR reference |
| photo_urls | jsonb | Array of photo URLs |
| status | text | pending/approved/rejected |
| created_at | timestamp | Submission time |

## API Endpoints

### GET /api/wa-monitor-drops
Returns paginated list of submissions.

Query params:
- `page` (number): Page number, default 1
- `limit` (number): Items per page, default 20
- `status` (string): Filter by status

### POST /api/wa-monitor-feedback
Sends feedback to technician via WhatsApp.

Body:
```json
{
  "dropNumber": "DR123456",
  "message": "Please retake photo 3",
  "type": "rework"
}
```

## External Services

### WhatsApp Bridge
- **Host:** 100.96.203.105:8090
- **Health check:** `curl http://100.96.203.105:8090/health`

### Restart if issues:
```bash
ssh velo@100.96.203.105
sudo systemctl restart whatsapp-bridge
```

## Troubleshooting

### "Send Feedback" button not working
1. Check bridge health: `curl http://100.96.203.105:8090/health`
2. If unhealthy, restart: `sudo systemctl restart whatsapp-bridge`
3. Check logs: `journalctl -u whatsapp-bridge -f`

### Photos not appearing
1. Verify WhatsApp group is configured in `projects.yaml`
2. Check monitor service: `sudo systemctl status wa-monitor-prod`
3. Review logs for errors
```

---

## Layer 4: Session State

**Location:** `.claude/session/current.json`

**Purpose:** Ephemeral context for the current work session. Enables session recovery.

**Lifecycle:** Created at session start, updated during work, can be resumed.

### What Belongs Here

- Current task description
- Last completed action
- Progress checkpoints
- Temporary context

### Example

```json
{
  "sessionId": "2024-01-21-0957",
  "lastActive": "2024-01-21T09:57:00Z",
  "task": {
    "description": "Implement serial swap detection",
    "status": "completed"
  },
  "lastAction": "Deployed to staging and verified",
  "progress": [
    "✅ Added swap detection logic to qaAutoFailService",
    "✅ Updated QA Wizard Phase 4 with warning UI",
    "✅ Added auto-ticket creation for swaps",
    "✅ Deployed and tested on staging"
  ],
  "context": {
    "relevantFiles": [
      "src/modules/activate/services/qaAutoFailService.ts",
      "src/modules/activate/components/wizard/FinalDecisionPhase.tsx"
    ]
  }
}
```

### Session Recovery Hook

Create `.claude/hooks/session-start.sh`:

```bash
#!/bin/bash
# Display session recovery info at startup

SESSION_FILE=".claude/session/current.json"

if [ -f "$SESSION_FILE" ]; then
  LAST_TASK=$(jq -r '.task.description // "Unknown"' "$SESSION_FILE")
  LAST_ACTION=$(jq -r '.lastAction // "Unknown"' "$SESSION_FILE")

  echo "╔══════════════════════════════════════════════════════════╗"
  echo "║                SESSION RECOVERY AVAILABLE                 ║"
  echo "╠══════════════════════════════════════════════════════════╣"
  echo "║ LAST TASK: $LAST_TASK"
  echo "║ LAST ACTION: $LAST_ACTION"
  echo "╠══════════════════════════════════════════════════════════╣"
  echo "║ Say \"continue\" to resume or describe a new task          ║"
  echo "╚══════════════════════════════════════════════════════════╝"
fi
```

---

## The /kb Command

A mechanism to persist learnings discovered during a session back to the appropriate CLAUDE.md file.

### Usage

```
/kb "Nested dynamic routes fail in Vercel production - use flattened routes"
```

### Implementation

Create a skill that:
1. Takes a learning/insight as input
2. Determines the appropriate file (global, project, or module)
3. Appends it to the relevant section
4. Confirms the update

### Example Skill (`.claude/commands/kb.md`)

```markdown
# /kb - Knowledge Base Update

When invoked with a learning:

1. Analyze the content to determine scope:
   - Universal coding practice → ~/.claude/CLAUDE.md
   - Project-specific gotcha → ./CLAUDE.md
   - Module-specific detail → ./src/modules/X/README.md

2. Find or create the appropriate section:
   - "Common Gotchas" for problems/solutions
   - "Conventions" for patterns
   - "Troubleshooting" for fixes

3. Append the learning with timestamp

4. Confirm: "Added to [file] under [section]"
```

---

## Why This Architecture Works

| Problem | Solution |
|---------|----------|
| **Context window limits** | Only load relevant layers |
| **Forgetting between sessions** | Persist to CLAUDE.md files |
| **Repeating explanations** | Document once, auto-load always |
| **Onboarding new sessions** | Context loads automatically |
| **Stale documentation** | /kb updates docs in real-time |
| **Information overload** | Progressive loading by relevance |

---

## Implementation Checklist

### Initial Setup

- [ ] Create global config:
  ```bash
  mkdir -p ~/.claude
  touch ~/.claude/CLAUDE.md
  ```

- [ ] Create project config:
  ```bash
  touch CLAUDE.md  # in project root
  ```

- [ ] Create session directory:
  ```bash
  mkdir -p .claude/session
  echo '{}' > .claude/session/current.json
  ```

- [ ] Add to .gitignore:
  ```
  .claude/session/
  ```

- [ ] Create hooks directory:
  ```bash
  mkdir -p .claude/hooks
  ```

### Content Migration

- [ ] Move personal preferences to `~/.claude/CLAUDE.md`
- [ ] Document project architecture in `./CLAUDE.md`
- [ ] Create README.md for each major module
- [ ] Set up session recovery hook

### Ongoing Maintenance

- [ ] Use `/kb` to capture learnings during sessions
- [ ] Review and prune monthly (remove outdated info)
- [ ] Keep layer sizes within targets
- [ ] Update when architecture changes

---

## Best Practices

### DO

- **Be specific** - Include actual commands, paths, values
- **Use examples** - Show code snippets, not just descriptions
- **Update continuously** - Every gotcha learned gets documented
- **Trim aggressively** - Remove outdated information
- **Layer appropriately** - Don't repeat info across layers

### DON'T

- **Don't store secrets** - Use environment variables
- **Don't duplicate** - If it's in global, don't put in project
- **Don't over-document** - Only what AI needs to be productive
- **Don't forget to prune** - Stale docs are worse than no docs

---

## Measuring Success

Your knowledge base is working when:

1. **New sessions are productive immediately** - No "let me explain the project" phase
2. **Mistakes don't repeat** - Gotchas are caught by documented warnings
3. **Context stays focused** - AI doesn't load irrelevant information
4. **Knowledge compounds** - Each session makes future sessions better

---

## Template Files

### Global CLAUDE.md Template

```markdown
# Global AI Configuration

## About Me
[Your role, preferences, work style]

## Stack Preferences
[Languages, tools, frameworks you prefer]

## Response Format
[How you want responses structured]

## Quality Standards
[Your non-negotiable code quality rules]

## Communication Style
[Verbosity, emoji usage, etc.]
```

### Project CLAUDE.md Template

```markdown
# Project: [Name]

## Overview
[One paragraph description]

## Quick Start
[Commands to get running]

## Architecture
[Framework, database, key technologies]

## Directory Structure
[Key directories and their purpose]

## Conventions
[Patterns used in this project]

## Common Gotchas
[Things that trip people up]

## Deployment
[How to deploy]
```

### Module README.md Template

```markdown
# [Module Name]

## Overview
[What this module does]

## Architecture
[Directory structure, key files]

## Database Tables
[Schema documentation]

## API Endpoints
[Endpoint documentation]

## External Services
[Integrations, hosts, credentials location]

## Troubleshooting
[Common issues and fixes]
```

---

*This system was developed through practical use on production projects. The key insight: AI assistants are only as good as the context they receive. Invest in your knowledge base, and every session becomes more productive.*
