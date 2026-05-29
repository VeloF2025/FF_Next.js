---
name: handoff
description: Generate a session handoff document capturing everything the next AI session needs to continue without re-litigating decisions. USE WHEN user says '/handoff', 'create a handoff', 'end of session', 'session handoff', 'handoff document', 'wrap up the session'.
---

# /handoff — Session Handoff Document

Creates a dated handoff document in `docs/superpowers/` that gives the next session complete context: what was done, all locked decisions, what's next (in order), and current state of every moving part.

## When to use

Run this at the end of any working session where:
- A multi-step plan is in progress (not finished)
- PRs are open and waiting for review/merge
- Decisions were made that the next session must not re-litigate
- There are concrete next steps that need to be picked up fresh

## Process

### Step 1: Gather session state

Collect all the context needed before writing a single word:

```bash
# Current branch and recent commits
git branch --show-current
git log master..HEAD --oneline

# Open PRs on this repo
gh pr list --state open --limit 20 --json number,title,headRefName,state

# Any uncommitted changes
git status --short
```

Also review in your context:
- What tasks were completed this session
- What tasks are blocked or pending
- Any decisions that were debated and resolved (lock these)
- What the user explicitly said to do next

### Step 2: Write the handoff document

Create `docs/superpowers/YYYY-MM-DD-{topic}-handoff.md` where `YYYY-MM-DD` is today's date and `{topic}` is a 2-3 word slug for the work (e.g. `photoguide-pwa`, `serial-lifecycle`, `procurement-audit`).

Use this exact structure:

```markdown
# {Topic} — Session Handoff
> **Date:** YYYY-MM-DD
> **Continue with:** {one sentence on the immediate next action}
> **Plans:** {paths to any plan files, if applicable}

---

## What We Did Today

### 1. {Major thing done}
- Bullet points with concrete facts
- Include PR numbers, commit hashes, deployed URLs

### 2. {Next major thing}
...

---

## All Decisions Made (don't re-litigate)

| Decision | Outcome |
|----------|---------|
| {What was decided} | {The locked answer} |
| ... | ... |

---

## What's Next (in order)

### Step 1 — {Immediate next action} (FIRST)
Concrete instructions. Not vague. If there's a plan file, reference it.
What to invoke, what to check, what the success condition is.

### Step 2 — {After that}
...

---

## Key Files to Know

| File | Purpose |
|------|---------|
| `path/to/file.ts` | What it does |
| ... | ... |

---

## Current State of Dev

| Item | Status |
|------|--------|
| dev.fibreflow.app | {Running which branch / commit} |
| {Feature X} | ✅ Live / ❌ Not built / 🔄 PR open (#N) |
| {Feature Y} | ... |

---

## To the AI Reading This Tomorrow

Numbered list of the most important things to know.
Include gotchas, non-obvious dependencies, and anything
that would cause wasted time if missed.
```

### Step 3: Commit and push

```bash
# Stage only the handoff doc (never commit .claude/ files)
git add docs/superpowers/YYYY-MM-DD-{topic}-handoff.md
git commit -m "docs: session handoff YYYY-MM-DD — {topic}"
git push
```

If currently on a feature branch, push to that branch. If on master, push directly.

## Quality checklist before committing

- [ ] **No vague next steps** — "continue the work" is not a next step. Name the exact skill to invoke, the exact file to edit, the exact command to run.
- [ ] **All open PRs listed** with their numbers and current state
- [ ] **Decisions table is complete** — anything that was debated and resolved belongs here so the next session doesn't start the debate again
- [ ] **"To the AI" section** — the single most useful section. Would a fresh AI reading only this section know what NOT to do?
- [ ] **Current state table** — every piece of work that was started has an entry, including ❌ entries for things not yet built
- [ ] **Date is correct** — use today's actual date, not a relative reference

## Naming conventions

| Situation | Filename slug |
|-----------|--------------|
| PhotoGuide PWA work | `photoguide-pwa` |
| Sub-project A or B | include the letter: `pwa-subproject-a` |
| Multiple topics | pick the one you'll continue first |
| Bug fixes / hotfixes | `{module}-fixes` |
| General sprint work | `sprint-{focus}` |

## Example trigger

User says: *"Create a handoff"* or *"Let's wrap up"*

You should:
1. Run the git/gh commands from Step 1
2. Review what was done in the current conversation
3. Write the document to the correct path
4. Commit and push
5. Tell the user the file path and what the next session should start with
