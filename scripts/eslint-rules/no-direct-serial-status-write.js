/**
 * ESLint Rule: no-direct-serial-status-write
 *
 * Blocks direct UPDATE of stock_serials.status / stock_serials.holder_id in
 * SQL embedded in TypeScript (template literals or plain string literals)
 * outside the small set of files that own the serial-lifecycle state machine.
 *
 * All serial status/holder transitions must go through promoteSerial() from
 * @/modules/procurement/field-stock/services/serialLifecycle so the mig 387
 * matrix validation + event emission run exactly once.
 *
 * Sprint E Track 3. The header used to say this rule "ships disabled" and is
 * flipped at cutover. The Track 7 cutover commit did flip it — .eslintrc.json
 * line 47 has said "error" since 2026-05-30 — but that file is DEAD config:
 * .eslintrc.cjs wins ESLint 8 precedence and never declares the `local` plugin,
 * so the flip enforced nothing for over two months. The runbook and two docs
 * describe this rule as enforced; it was not running anywhere.
 *
 * It is now executed by scripts/verify-no-direct-status-writes.ts, which loads
 * it by bare name via rulePaths and forces it to "error" regardless of the
 * configured severity. That script is the single source of truth and runs as a
 * blocking CI step; .eslintrc.json's declaration remains inert.
 */

'use strict';

// Every entry is qualified by its directory. A bare /serialLifecycle\.ts$/
// matches on basename alone, so a new file with that name created anywhere in
// the repo would exempt itself from the rule just by being called the right
// thing — the exemption has to name the one file it means.
const ALLOWED_FILES = [
  /(^|\/)src\/modules\/procurement\/field-stock\/services\/serialLifecycle\.ts$/,
  /(^|\/)src\/modules\/procurement\/field-stock\/services\/serialForceCorrectService\.ts$/,
  /(^|\/)scripts\/backfill-serial-lifecycle-status\.ts$/,
  // Three operator-invoked scripts that predate the lifecycle service and still
  // write stock_serials.status directly. Listing them is what makes the gate
  // honest: before scripts/ was scanned they were simply invisible, so "zero
  // direct writers" was a statement about the search path, not about the code.
  // The third only came to light when scripts/ was added to the scan.
  //
  // They are exempted rather than rewritten because routing a backfill through
  // the lifecycle service changes what it writes, and that needs its own change
  // with its own tests. None runs on a schedule, but none is dead either: the
  // two backfills export backfillActivationsFromOES / backfillInstallsFromQA
  // (used by tests/db/backfill/), and all three run via `tsx ... --commit`.
  /(^|\/)scripts\/backfill-stock-serials-activated-from-oes\.ts$/,
  /(^|\/)scripts\/backfill-stock-serials-installed-from-qa\.ts$/,
  /(^|\/)scripts\/cleanup-serial-drift-2026-05-28\.ts$/,
];

// Capture ONLY the SET clause — everything between `SET` and the first
// WHERE / RETURNING / ON CONFLICT / FROM / `;` / end-of-string boundary — so a
// query that merely *filters* by status (`SET notes = $1 WHERE status = $2`) is
// not mistaken for a status *write*. The boundary is a lookahead so it isn't
// consumed. FROM is a boundary because `UPDATE ... SET ... FROM x WHERE ...` is
// valid Postgres and is used in this codebase (cascadeSerialPromotion.ts).
//
// The optional alias is load-bearing, not defensive: `UPDATE stock_serials ss
// SET ...` is the shape cascadeSerialPromotion.ts already uses, and without this
// group the rule silently missed every aliased write. Verified by positive
// control before the fix — the aliased form scored clean.
// (?!SET\b) stops the alias group from swallowing the SET keyword itself.
const SET_CLAUSE_RE =
  /UPDATE\s+stock_serials\b(?:\s+(?:AS\s+)?(?!SET\b)[A-Za-z_][A-Za-z0-9_]*)?\s+SET\s+([\s\S]*?)(?=\sWHERE\b|\sRETURNING\b|\sON\s+CONFLICT\b|\sFROM\b|;|$)/i;
const WRITTEN_COLUMN_RE = /\b(status|holder_id)\s*=/i;

/**
 * Blank the contents of single-quoted SQL string literals.
 *
 * The boundary keywords above are matched as plain text, so an ordinary English
 * word inside an earlier column's VALUE ends the capture before it reaches the
 * assignment that matters. The lazy quantifier stops at the leftmost boundary,
 * whichever alternative it is:
 *
 *   UPDATE stock_serials SET notes = 'Received from warehouse', status = $1
 *                                              ^^^^ capture ends here
 *
 * That statement writes status and scored CLEAN. "from" and "where" are ordinary
 * words in stock-movement notes, so this is domain vocabulary, not a contrived
 * input. Blanking literal bodies first removes the whole class rather than
 * special-casing FROM. `''` is SQL's escaped quote and is preserved as an empty
 * body, so a literal containing one does not swallow the rest of the statement.
 */
function blankStringLiterals(text) {
  return text.replace(/'(?:[^']|'')*'/g, "''");
}

/**
 * The text of a string-ish node, with `${X}` standing in for anything whose
 * value is not statically known.
 *
 * Concatenation has to be flattened because `'UPDATE stock_serials SET ' +
 * 'status = $1'` is one statement to Postgres but two nodes to ESLint: neither
 * fragment contains both the UPDATE and the assignment, so a per-node check
 * misses it. Unknown parts become `${X}` rather than aborting the whole chain —
 * a guard should over-report, never under-report.
 */
function staticText(node) {
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral') return node.quasis.map((q) => q.value.raw).join('${X}');
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    return staticText(node.left) + staticText(node.right);
  }
  return '${X}';
}

/** True when this node is a part of a `+` chain, so the chain's root owns it. */
function isConcatPart(node) {
  const p = node.parent;
  return Boolean(p) && p.type === 'BinaryExpression' && p.operator === '+';
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Block direct UPDATE of stock_serials.status/holder_id outside serialLifecycle.ts',
      category: 'Best Practices',
      recommended: true,
    },
    schema: [],
    messages: {
      noDirectWrite:
        'Direct write to stock_serials.{{column}} forbidden. ' +
        'Use promoteSerial() from @/modules/procurement/field-stock/services/serialLifecycle.',
    },
  },
  create(context) {
    const filename = context.getFilename();
    if (ALLOWED_FILES.some((re) => re.test(filename))) return {};

    function check(node, text) {
      const setClause = SET_CLAUSE_RE.exec(blankStringLiterals(text));
      if (!setClause) return;
      const col = setClause[1].match(WRITTEN_COLUMN_RE);
      if (col) {
        context.report({ node, messageId: 'noDirectWrite', data: { column: col[1] } });
      }
    }

    // Each visitor skips nodes that sit inside a `+` chain; the chain's root
    // reports instead, so a concatenated statement yields exactly one message
    // rather than one per fragment.
    return {
      TemplateLiteral(node) {
        if (isConcatPart(node)) return;
        check(node, staticText(node));
      },
      Literal(node) {
        if (typeof node.value !== 'string' || isConcatPart(node)) return;
        check(node, node.value);
      },
      BinaryExpression(node) {
        if (node.operator !== '+' || isConcatPart(node)) return;
        check(node, staticText(node));
      },
    };
  },
};
