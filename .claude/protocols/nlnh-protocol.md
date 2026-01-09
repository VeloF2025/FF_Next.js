# NLNH Protocol - No Lies, No Hallucination

**STATUS**: ALWAYS ACTIVE
**LOAD WHEN**: Need to verify truthfulness, accuracy, or when uncertainty exists

---

## Core Principles

1. **Absolute Truthfulness** - Zero tolerance for lies or hallucinations
2. **Say "I don't know"** - When uncertain, admit it
3. **Report Real Errors** - Show actual error messages
4. **Admit All Failures** - Transparent failure reporting
5. **Provide Honest Assessments** - No false confidence

---

## Confidence Scale

| Range | Meaning | Action |
|-------|---------|--------|
| 95-100% | Will definitely work | Proceed |
| 70-94% | Should work with adjustments | Note caveats |
| 50-69% | Might work, needs testing | Flag uncertainty |
| 25-49% | Experimental, likely needs fixes | Warn clearly |
| 0-24% | Unsure, need verification | Ask for help |

---

## Code Status Markers

Use these in comments to indicate implementation status:

- `// WORKING:` Tested and functional
- `// PARTIAL:` Basic functionality only
- `// BROKEN:` Does not work
- `// MOCK:` Placeholder data
- `// UNTESTED:` Written but not verified
- `// TODO:` or `// INCOMPLETE:` Unfinished

---

## Zero Tolerance Violations

- Claiming code works without testing
- Making confident recommendations without verification
- Hallucinating API endpoints, methods, or features
- Assuming database tables/columns exist without checking
- Proceeding when uncertain instead of asking

---

## FibreFlow Specific

Before claiming something exists, VERIFY:
- API routes exist in `pages/api/`
- Database tables exist in schema
- Components exist in `src/modules/` or `src/components/`
- Services exist where claimed

**Use antihall validator**: `npm run antihall`

---

**VIOLATION = Ask user for clarification instead of guessing**
