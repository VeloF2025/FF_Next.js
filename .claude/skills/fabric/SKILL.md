---
name: fabric
description: Pattern-based content processing for FibreFlow. 242+ specialized prompts for code review, threat modeling, analysis, and documentation. USE WHEN user says "review code", "analyze", "threat model", "summarize", "extract insights", or needs structured content processing.
---

# Fabric Skill - FibreFlow

**Purpose:** Apply specialized analysis patterns to FibreFlow code, documentation, and content.

## Quick Reference

| Intent | Pattern | Command |
|--------|---------|---------|
| Code review | `review_code` | `fabric -p review_code` |
| Threat model | `create_threat_model` | `fabric -p create_threat_model` |
| Summarize | `summarize` | `fabric -p summarize` |
| Extract wisdom | `extract_wisdom` | `fabric -p extract_wisdom` |
| Improve writing | `improve_writing` | `fabric -p improve_writing` |

## FibreFlow-Specific Patterns

### 1. Code Review
```bash
# Review a specific file
cat src/modules/ticketing/services/drLookupService.ts | fabric -p review_code

# Review with context
echo "Next.js API route handling DR lookups from Neon PostgreSQL" | \
  cat - src/modules/ticketing/services/drLookupService.ts | fabric -p review_code
```

### 2. API Security Review
```bash
# Threat model an API route
cat pages/api/contractors/[contractorId].ts | fabric -p create_threat_model

# STRIDE analysis
cat pages/api/auth/callback.ts | fabric -p create_stride_threat_model
```

### 3. Module Analysis
```bash
# Analyze module structure
find src/modules/wa-monitor -name "*.ts" -exec cat {} \; | fabric -p analyze_code

# Extract patterns from module
cat src/modules/wa-monitor/README.md | fabric -p extract_patterns
```

### 4. Documentation
```bash
# Improve README
cat src/modules/ticketing/README.md | fabric -p improve_writing

# Create summary
cat CHANGELOG.md | fabric -p create_5_sentence_summary
```

## Pattern Categories

### Security & Threat Modeling
| Pattern | Use For |
|---------|---------|
| `create_threat_model` | General API/feature threat model |
| `create_stride_threat_model` | STRIDE methodology |
| `create_threat_scenarios` | Attack scenarios |
| `analyze_risk` | Risk assessment |

### Code Analysis
| Pattern | Use For |
|---------|---------|
| `analyze_code` | Deep code analysis |
| `review_code` | Code review feedback |
| `analyze_logs` | Log file analysis |
| `analyze_incident` | Incident post-mortem |

### Summarization
| Pattern | Use For |
|---------|---------|
| `summarize` | General summary |
| `create_5_sentence_summary` | Ultra-brief summary |
| `summarize_git_changes` | Git diff summary |
| `summarize_meeting` | Meeting notes |

### Extraction
| Pattern | Use For |
|---------|---------|
| `extract_wisdom` | Key insights |
| `extract_main_idea` | Core message |
| `extract_recommendations` | Action items |
| `extract_patterns` | Code/design patterns |

### Improvement
| Pattern | Use For |
|---------|---------|
| `improve_writing` | Documentation quality |
| `improve_prompt` | AI prompt engineering |
| `improve_academic_writing` | Technical writing |

### Creation
| Pattern | Use For |
|---------|---------|
| `create_prd` | Product requirements |
| `create_user_story` | User stories |
| `create_mermaid_visualization` | Diagrams |
| `create_design_document` | Design docs |

## FibreFlow Workflows

### Pre-Commit Review
```bash
# Review staged changes
git diff --cached | fabric -p review_code
```

### Module Threat Model
```bash
# Full module security review
echo "FibreFlow WhatsApp Monitor Module
- Receives messages from WhatsApp groups
- Stores in Neon PostgreSQL (qa_photo_reviews table)
- Exposes API at /api/wa-monitor-*
- Uses Clerk authentication" | fabric -p create_threat_model
```

### API Documentation
```bash
# Generate API summary
cat pages/api/sow/*.ts | fabric -p summarize
```

### Git Summary
```bash
# Summarize recent changes
git log --oneline -20 | fabric -p summarize_git_changes
```

## Without Fabric CLI

If Fabric CLI is not installed, use the patterns directly in prompts:

### Manual Pattern Application
```
Apply the "review_code" pattern to this code:
[paste code here]

Focus on:
- Security vulnerabilities
- Performance issues
- Code quality
- Best practices
```

### Pattern Templates
The patterns provide structured prompts for:
- Consistent analysis format
- Comprehensive coverage
- Actionable outputs

## Installation (Optional)

```bash
# Install Fabric CLI
pip install fabric-ai

# Or use without CLI by applying pattern logic manually
```

## Best Practices

1. **Be Specific:** Add context about FF when using patterns
2. **Combine Patterns:** Use multiple patterns for thorough analysis
3. **Review Output:** Patterns are starting points, not final answers
4. **FF Context:** Always mention Next.js, Clerk, Neon when relevant

---

**Key Principle:** Select the RIGHT pattern for the task. Fabric's value is structured, consistent analysis.
