# /memory - Knowledge System Management

Manage the progressive knowledge system - audit, route knowledge, and maintain hierarchy.

## Usage

```
/memory              # Run health check
/memory audit        # Full audit report
/memory route        # Help decide where new knowledge belongs
/memory slim         # Slim down CLAUDE.md if bloated
```

## Actions

### Health Check (default)

Check the knowledge system health:

1. **CLAUDE.md size** - Should be <15KB (ideal <10KB)
2. **Module doc coverage** - All src/modules/* should have .claude/modules/*.md
3. **Cross-reference validity** - All referenced docs exist

```bash
# Check CLAUDE.md size
wc -c CLAUDE.md
# Target: <15000 bytes

# Check module coverage
ls src/modules/ | while read m; do
  [ -f ".claude/modules/${m}.md" ] || echo "Missing: $m"
done
```

### Audit

Generate full audit report:

```
╔══════════════════════════════════════════════════════════════╗
║                   KNOWLEDGE SYSTEM AUDIT                      ║
╠══════════════════════════════════════════════════════════════╣
║ CLAUDE.md: {size}KB ({OK/WARNING/CRITICAL})                  ║
║ Module Docs: {N}/40+                                         ║
║ Skills: {N} registered                                       ║
║ KB Entries: {N}                                              ║
╚══════════════════════════════════════════════════════════════╝
```

### Route

Interactive decision tree for routing new knowledge:

- **Connection string / critical command** → CLAUDE.md (1-2 lines)
- **Module-specific (API, tables, patterns)** → .claude/modules/{module}.md
- **Workflow / procedure** → .claude/skills/{skill}/SKILL.md
- **Historical / architecture rationale** → .claude/knowledge-base/
- **User documentation** → docs/

### Slim

When CLAUDE.md exceeds 15KB:

1. Identify sections >50 lines
2. Move detailed content to appropriate module docs
3. Replace with cross-references
4. Verify all references work

## Knowledge Hierarchy

```
CLAUDE.md              → Index + essentials only (~5-10KB)
.claude/modules/       → Module-specific docs (40+ files)
.claude/skills/        → Workflow procedures
.claude/knowledge-base/→ Deep reference material
docs/                  → User-facing documentation
```

## Quick Commands

```bash
# Size check
wc -c CLAUDE.md

# Module doc count
ls .claude/modules/*.md | wc -l

# Find large sections in CLAUDE.md
grep -n "^## " CLAUDE.md

# Check for missing cross-references
grep -oP '\.claude/modules/\S+\.md' CLAUDE.md | while read f; do
  [ -f "$f" ] || echo "Missing: $f"
done
```

## See Also

- `.claude/skills/memory/SKILL.md` - Full skill documentation
- `.claude/skills/knowledge-base/SKILL.md` - KB update skill
- `.claude/modules/_index.yaml` - Module registry
