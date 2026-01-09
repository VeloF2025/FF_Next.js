# Daily Sync

Morning sync - check GitHub status and plan the day.

## Gather Status

1. Check PRs needing your review:
   ```bash
   gh pr list --search "review-requested:@me" --json number,title,author,updatedAt
   ```

2. Check your open PRs:
   ```bash
   gh pr list --author @me --state open --json number,title,reviewDecision,statusCheckRollup
   ```

3. Check failed CI runs:
   ```bash
   gh run list --status failure --limit 5
   ```

4. Check assigned issues:
   ```bash
   gh issue list --assignee @me --state open --json number,title,labels
   ```

5. Check teammate activity (Louis):
   ```bash
   gh pr list --author louis --state open --json number,title,updatedAt
   ```

## Output Format

```markdown
## FF Morning Sync

### PRs to Review
| # | Title | Author | Updated |
|---|-------|--------|---------|
| 123 | feat: ... | louis | 2h ago |

### Your PRs Status
| # | Title | Status | CI |
|---|-------|--------|-----|
| 456 | fix: ... | Approved | Passing |
| 789 | feat: ... | Changes requested | - |

### Action Required
- #456 - Ready to merge
- #789 - Address review comments

### CI Failures
- Run #xxx on branch-name - needs fix

### Today's Issues
| # | Title | Priority |
|---|-------|----------|
| 111 | Bug: ... | High |

### Louis's Activity
- #234 feat: ... (might need review)

### Suggested Priority
1. **Immediate**: Merge #456, fix CI on branch-x
2. **Morning**: Address review on #789
3. **Afternoon**: Review Louis's PRs
4. **If time**: Work on issue #111
```

## Quick Actions

Offer these if relevant:
- "Want me to review PR #X?"
- "Want me to fix the CI failure?"
- "Should I merge #456?"
