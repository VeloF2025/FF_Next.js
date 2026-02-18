# /kb - Knowledge Base Update

Update the FibreFlow knowledge base by scanning modules and refreshing context files.

## Usage

```
/kb              # Full scan and update
/kb status       # Show KB status only
/kb [module]     # Update specific module
```

## What This Does

1. **Scan Modules** - Find all `src/modules/*/` directories
2. **Check Coverage** - Identify modules missing `.claude.md`
3. **Generate Context** - Create `.claude.md` for missing modules
4. **Consolidate Learnings** - Move `.claude-learnings.md` entries to permanent KB
5. **Qdrant Ingestion** - Push all KB sources into Qdrant vector DB on Velocity
6. **Update Session** - Record KB update in session state

## Execution Steps

### Step 1: Scan Modules
```bash
# Count total modules
ls -d src/modules/*/ | wc -l

# List modules with .claude.md
find src/modules -maxdepth 2 -name ".claude.md" | wc -l

# List modules WITHOUT .claude.md
for dir in src/modules/*/; do
  name=$(basename "$dir")
  if [ ! -f "$dir/.claude.md" ]; then
    echo "❌ $name"
  fi
done
```

### Step 2: For Each Missing Module
Generate `.claude.md` using template from `.claude/templates/module-claude-md.template`:
- Extract purpose from README.md or code
- List key files (services, components, types)
- Identify API endpoints from `pages/api/`
- Note critical rules and common issues

### Step 3: Consolidate Learnings
Check for `.claude-learnings.md` files with entries >7 days old:
```bash
find src/modules -name ".claude-learnings.md" -exec echo "Found: {}" \;
```
Move old entries to module's `.claude.md` under "## Learnings" section.

### Step 4: Update Session State
Update `.claude/session/current.json`:
```json
{
  "last_action": "KB update via /kb",
  "kb_scan_results": {
    "timestamp": "...",
    "total_modules": N,
    "modules_with_claude_md": N
  }
}
```

### Step 5: Qdrant Vector DB Ingestion
Push all KB markdown sources + DB schema into the Qdrant vector database on Velocity.
This keeps the vector search in sync with local knowledge files.

```bash
# Full re-ingestion (recommended during /kb)
ssh velo@100.96.203.105 "cd /home/velo/fibreflow-production && python3 scripts/ingest-qdrant.py --force 2>&1"
```

The script:
- Scans `docs/*.md`, `.claude/modules/*.md`, `.claude/knowledge-base/**/*.md`, `src/modules/*/.claude.md`
- Chunks by `##` headings (~800 word chunks with paragraph overlap)
- Embeds with OpenAI `text-embedding-3-small` (1536-dim)
- Upserts into Qdrant collection `fibreflow_kb` at `localhost:6333`
- Also ingests DB schema from `information_schema`
- Uses deterministic point IDs (source + chunk_index hash) so re-runs replace, not duplicate

Flags: `--force` (re-ingest all), `--source <path>` (single file), `--dry-run` (count only).

### Step 6: Report Results
```
╔══════════════════════════════════════════════════════════════╗
║                    KB UPDATE COMPLETE                        ║
╠══════════════════════════════════════════════════════════════╣
║ Modules scanned:        41                                   ║
║ With .claude.md:        41 (100%)                            ║
║ Learnings consolidated: 0                                    ║
║ Qdrant chunks ingested: 8761                                 ║
║ Qdrant collection:      fibreflow_kb (green)                 ║
╚══════════════════════════════════════════════════════════════╝
```

## Related Files

| File | Purpose |
|------|---------|
| `.claude/session/current.json` | Session state |
| `.claude/templates/module-claude-md.template` | Template |
| `src/modules/*/.claude.md` | Module context |
| `src/modules/*/.claude-learnings.md` | Auto-captured learnings |
| `scripts/ingest-qdrant.py` | Qdrant vector DB ingestion script |
