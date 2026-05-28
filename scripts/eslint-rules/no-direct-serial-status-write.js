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
 * Sprint E Track 3. SHIPS DISABLED ("off" in .eslintrc.json) — flipped to
 * "error" in the cutover PR, together with uncommenting the matching CI grep
 * gate in scripts/ci-local.sh. Until then, Track 2's still-legitimate
 * pre-cutover direct writers would trip it.
 */

'use strict';

const ALLOWED_FILES = [
  /serialLifecycle\.ts$/,
  /serialForceCorrectService\.ts$/,
  /scripts\/backfill-serial-lifecycle-status\.ts$/,
];

const DIRECT_WRITE_RE = /UPDATE\s+stock_serials\s+SET[\s\S]*(status|holder_id)\s*=/i;

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
      if (DIRECT_WRITE_RE.test(text)) {
        const m = text.match(/(status|holder_id)\s*=/i);
        context.report({ node, messageId: 'noDirectWrite', data: { column: m[1] } });
      }
    }

    return {
      TemplateLiteral(node) {
        const raw = node.quasis.map((q) => q.value.raw).join('${X}');
        check(node, raw);
      },
      Literal(node) {
        if (typeof node.value !== 'string') return;
        check(node, node.value);
      },
    };
  },
};
