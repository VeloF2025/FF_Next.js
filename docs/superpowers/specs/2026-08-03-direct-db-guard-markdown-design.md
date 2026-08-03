# Direct-Database Guard Markdown Design

## Goal

Restore full direct-database scanning for the metrics snapshot source without allowing Markdown prose to trigger a false positive.

## Current Problem

`src/tests/no-direct-db-connections.test.ts` treats `sql` followed by optional whitespace and a backtick as evidence of a tagged SQL template. That expression also matches Markdown inline code such as `` `sql` ``, because it does not distinguish the opening Markdown backtick from a tag identifier.

PR #2351 restored CI by adding `src/modules/metrics/snapshot/sources.ts` to the exact-path allowlist. The allowlist prevents the scanner from reading that file at all, so all six database-usage checks are bypassed there. Closed PR #2352 avoided the false positive by rewording one source comment, but that would leave the broader allowlist in place and would couple production documentation to a test implementation detail.

## Approved Design

Keep the existing scanner and change only the tagged-template pattern so it rejects `sql` when the immediately preceding character is a backtick. It must continue to detect a real `sql` tag with or without whitespace before its template literal.

Remove `modules/metrics/snapshot/sources.ts` from `allowedFiles`. Do not change the metrics source comment: that Markdown is the real integration fixture proving the scanner can inspect the file safely.

No parser, comment stripper, dependency, source transformation, or unrelated allowlist cleanup is in scope.

## Test Design

Use test-driven development in `src/tests/no-direct-db-connections.test.ts`:

1. Add focused cases proving that real tagged templates are detected.
2. Add focused cases proving that Markdown inline code is not detected.
3. Add a coverage assertion proving the metrics snapshot source is not excluded.
4. Run those tests before the implementation and confirm the Markdown and coverage assertions fail for the expected reasons.
5. Apply the minimal matcher and allowlist changes, then rerun the targeted guard and metrics snapshot tests.

The repository integration scan must still pass with the unchanged Markdown comment in `sources.ts`.

## Acceptance Criteria

- `sql` tagged templates remain violations.
- Markdown inline code containing `sql` is not a violation.
- `src/modules/metrics/snapshot/sources.ts` is scanned rather than allowlisted.
- The existing six database-usage patterns remain active for that file.
- Targeted tests and `npm run ci:quick` pass.
- The change is delivered through a pull request; no deployment or database operation is performed.
