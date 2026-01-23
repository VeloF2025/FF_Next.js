"""
Spec Generator

Generates harness spec files based on work type.
"""

from enum import Enum
from pathlib import Path
from typing import Optional


class WorkType(str, Enum):
    FEATURE = "feature"
    FIX = "fix"
    AMENDMENT = "amendment"
    REFACTOR = "refactor"


def generate_spec_file(
    spec_path: Path,
    work_type: WorkType,
    title: str,
    description: Optional[str] = None,
    problem_statement: Optional[str] = None,
    acceptance_criteria: Optional[str] = None,
    target_module: Optional[str] = None,
    test_scenarios: Optional[str] = None,
    github_issue_url: Optional[str] = None,
) -> None:
    """Generate a spec file based on work type"""

    # Get template based on work type
    template = get_template(work_type)

    # Fill in template
    content = template.format(
        title=title,
        description=description or "_No description provided_",
        problem_statement=problem_statement or "_No problem statement provided_",
        acceptance_criteria=acceptance_criteria or "_No acceptance criteria provided_",
        target_module=target_module or "_Not specified_",
        test_scenarios=test_scenarios or "_No test scenarios provided_",
        github_issue_url=github_issue_url or "",
        work_type=work_type.value,
    )

    # Ensure parent directory exists
    spec_path.parent.mkdir(parents=True, exist_ok=True)

    # Write spec file
    spec_path.write_text(content)


def get_template(work_type: WorkType) -> str:
    """Get spec template for work type"""

    templates = {
        WorkType.FEATURE: FEATURE_TEMPLATE,
        WorkType.FIX: FIX_TEMPLATE,
        WorkType.AMENDMENT: AMENDMENT_TEMPLATE,
        WorkType.REFACTOR: REFACTOR_TEMPLATE,
    }

    return templates.get(work_type, FEATURE_TEMPLATE)


FEATURE_TEMPLATE = """# {title}

> Work Type: Feature (New Functionality)
> GitHub Issue: {github_issue_url}

## Purpose

{problem_statement}

## Description

{description}

## Core Capabilities

Based on the requirements, implement the following capabilities:

1. **Primary Function** - Main feature implementation
2. **Data Handling** - Input validation and data processing
3. **Integration** - Connect with existing systems
4. **Error Handling** - Graceful error management
5. **User Feedback** - Status and result communication

## Target Module

{target_module}

## Acceptance Criteria

{acceptance_criteria}

## Test Scenarios

{test_scenarios}

## Success Criteria

1. All acceptance criteria are met
2. Tests pass with >80% coverage
3. No breaking changes to existing functionality
4. Code follows project conventions
5. Documentation is updated

## Integration Points

- Database: Neon PostgreSQL
- API: Next.js API routes
- Frontend: React components with TypeScript
- Styling: Tailwind CSS

## Deliverables

1. Implementation code in target module
2. Unit tests
3. Integration tests (if applicable)
4. Updated documentation
"""

FIX_TEMPLATE = """# {title}

> Work Type: Bug Fix
> GitHub Issue: {github_issue_url}

## Problem Statement

{problem_statement}

## Description

{description}

## Target Module

{target_module}

## Root Cause Analysis

Before implementing the fix:
1. Identify the exact location of the bug
2. Understand why it occurs
3. Determine the minimal change needed

## Fix Requirements

{acceptance_criteria}

## Test Cases

{test_scenarios}

## Success Criteria

1. Bug is fixed and no longer reproducible
2. Existing tests still pass
3. New regression test added
4. No side effects introduced
5. Fix is minimal and targeted

## Scope Limitation

This is a bug fix - do NOT:
- Refactor unrelated code
- Add new features
- Change existing behavior beyond the fix
- Modify code outside the target module unless necessary

## Deliverables

1. Targeted fix in affected file(s)
2. Regression test
3. Brief comment explaining the fix
"""

AMENDMENT_TEMPLATE = """# {title}

> Work Type: Amendment (Modify Existing Feature)
> GitHub Issue: {github_issue_url}

## Purpose

{problem_statement}

## Description

{description}

## Target Module

{target_module}

## Current Behavior

Analyze the existing implementation before making changes.

## Desired Changes

{acceptance_criteria}

## Test Scenarios

{test_scenarios}

## Success Criteria

1. Existing functionality preserved where not changed
2. New behavior matches requirements
3. All existing tests still pass
4. New tests for changed behavior
5. Documentation updated

## Change Strategy

1. Read and understand existing code
2. Identify minimal changes needed
3. Preserve backwards compatibility where possible
4. Update tests incrementally

## Deliverables

1. Modified implementation
2. Updated tests
3. Updated documentation
"""

REFACTOR_TEMPLATE = """# {title}

> Work Type: Refactor (Code Improvement)
> GitHub Issue: {github_issue_url}

## Purpose

{problem_statement}

## Description

{description}

## Target Module

{target_module}

## Current Issues

Analyze the existing code for:
- Code duplication
- Complex functions (>50 lines)
- Poor naming
- Missing types
- Inefficient patterns

## Refactor Goals

{acceptance_criteria}

## Constraints

1. NO behavior changes
2. All existing tests must pass without modification
3. Maintain API compatibility
4. Incremental, reversible changes

## Test Scenarios

{test_scenarios}

## Success Criteria

1. All existing tests pass unchanged
2. Code is more readable/maintainable
3. No new bugs introduced
4. Performance not degraded
5. Types improved where applicable

## Refactor Patterns to Apply

- Extract method for repeated code
- Rename for clarity
- Simplify conditionals
- Add TypeScript types
- Remove dead code

## Deliverables

1. Refactored code
2. Same test coverage (tests unchanged)
3. Brief summary of changes made
"""
