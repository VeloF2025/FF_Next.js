/**
 * ESLint Rule: no-neon-shim-sql-divergence
 *
 * Bans the two SQL patterns that diverge between the real @neondatabase/serverless
 * driver and the pg.Pool-backed clients used in this repo (the neon-shim and
 * @/lib/db-pool). Both clients implement `sql` as a tagged-template that rebuilds
 * the query into $N bind params, plus a 1-arg `sql.unsafe(raw)` interpolation
 * sentinel and a `sql.query(text, params)` executor. Two caller patterns break:
 *
 * CLASS 1 — fragment-in-fragment interpolation:
 *     sql`... ${sql`AND x = ${v}`} ...`
 *     sql`... ${cond ? sql`AND x` : sql``} ...`
 *     whereConditions = sql`${whereConditions} AND y`
 *   The interpolated value is a Promise<rows[]>, not an inlinable SQL fragment,
 *   so it is pushed as a bind param and the query is corrupted.
 *   Fix: build the dynamic SQL as a plain string with $N params and run it via
 *   sql.query(text, params), or use explicit query branches.
 *
 * CLASS 2 — sql.unsafe() used as a query executor:
 *     const rows = await sql.unsafe(queryText, params)
 *   The real Neon driver's sql.unsafe(query, params?) executes and returns rows;
 *   the repo clients define sql.unsafe(raw) as a 1-arg interpolation sentinel, so
 *   the call returns a sentinel object (not rows) and downstream iteration throws.
 *   Fix: use sql.query(text, params) to execute a pre-built parameterized query.
 *
 * The safe interpolation form `sql`... ${sql.unsafe(trustedString)} ...`` (single
 * string arg, used inside a tagged template) is NOT flagged.
 */

'use strict';

/** True if the node is a tagged-template call on a `sql`-named tag. */
function isSqlTaggedTemplate(node) {
  return (
    node &&
    node.type === 'TaggedTemplateExpression' &&
    node.tag &&
    node.tag.type === 'Identifier' &&
    node.tag.name === 'sql'
  );
}

/**
 * True if the expression is, or (for ternaries/logicals) contains, a SQL
 * fragment — either an inline `sql`...`` tagged template, or an identifier
 * previously bound to one (the accumulator pattern `w = sql`${w} ...``).
 * `isFragmentVar(name)` resolves whether an identifier is a fragment-bound
 * variable in the current lexical scope.
 */
function containsSqlFragment(node, isFragmentVar) {
  if (!node) return false;
  if (isSqlTaggedTemplate(node)) return true;
  if (node.type === 'Identifier' && isFragmentVar(node.name)) return true;
  if (node.type === 'ConditionalExpression') {
    return containsSqlFragment(node.consequent, isFragmentVar) || containsSqlFragment(node.alternate, isFragmentVar);
  }
  if (node.type === 'LogicalExpression') {
    return containsSqlFragment(node.left, isFragmentVar) || containsSqlFragment(node.right, isFragmentVar);
  }
  return false;
}

/**
 * True for `sql.unsafe` / `<anything>.unsafe` member callee. Note: this matches
 * any `.unsafe(` member call, not only `sql.unsafe(` — acceptable because no
 * other `.unsafe()` API is used in this codebase; revisit if one is introduced.
 */
function isUnsafeCallee(callee) {
  return (
    callee &&
    callee.type === 'MemberExpression' &&
    callee.property &&
    callee.property.name === 'unsafe'
  );
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow SQL patterns that break the neon-shim / db-pool clients ' +
        '(fragment-in-fragment interpolation; sql.unsafe used as a query executor)',
      category: 'Possible Errors',
      recommended: true,
      url: 'https://github.com/VelocityFibre/FF_Next.js/blob/master/docs/plans/2026-05-30-neon-shim-elimination-plan.md',
    },
    schema: [],
    messages: {
      fragmentInterpolation:
        'Do not interpolate a sql`...` fragment into another sql`...` template ' +
        '(class 1 divergence: the inner fragment is a Promise, not inlinable SQL — it corrupts the query). ' +
        'Build the dynamic SQL as a string with $N params and run sql.query(text, params), or use explicit query branches.',
      unsafeExecutor:
        'sql.unsafe() is a 1-arg interpolation sentinel, not a query executor ' +
        '(class 2 divergence: await sql.unsafe(text, params) returns a sentinel object, not rows). ' +
        'Use sql.query(text, params) to execute a pre-built parameterized query.',
    },
  },

  create(context) {
    // Per-function-scope stack of Sets of identifiers bound to a sql`` fragment.
    // This catches the accumulator pattern (`let w = sql`...`; w = sql`${w} ...``)
    // while NOT bleeding a fragment-named variable in one function into a
    // same-named plain variable in another — important for the wider Stage 3
    // sweep where names like `whereClause`/`conditions`/`dateFilter` recur across
    // handlers in the same file. Declarations precede uses in the patterns we
    // target and ESLint traverses top-down, so on-the-fly collection suffices.
    const scopeStack = [new Set()];
    const top = () => scopeStack[scopeStack.length - 1];
    const isFragmentVar = (name) => scopeStack.some((s) => s.has(name));
    const enterScope = () => { scopeStack.push(new Set()); };
    const exitScope = () => { scopeStack.pop(); };

    function recordIfFragment(name, valueNode) {
      if (!name) return;
      if (containsSqlFragment(valueNode, isFragmentVar)) top().add(name);
    }

    return {
      FunctionDeclaration: enterScope,
      'FunctionDeclaration:exit': exitScope,
      FunctionExpression: enterScope,
      'FunctionExpression:exit': exitScope,
      ArrowFunctionExpression: enterScope,
      'ArrowFunctionExpression:exit': exitScope,

      VariableDeclarator(node) {
        if (node.id && node.id.type === 'Identifier') {
          recordIfFragment(node.id.name, node.init);
        }
      },

      AssignmentExpression(node) {
        if (node.left && node.left.type === 'Identifier') {
          recordIfFragment(node.left.name, node.right);
        }
      },

      // CLASS 1: any ${ ... } substitution inside a sql`` template whose
      // expression is (or contains) a sql`` fragment or a fragment-bound var.
      TaggedTemplateExpression(node) {
        if (!isSqlTaggedTemplate(node)) return;
        const expressions = (node.quasi && node.quasi.expressions) || [];
        for (const expr of expressions) {
          if (containsSqlFragment(expr, isFragmentVar)) {
            context.report({ node: expr, messageId: 'fragmentInterpolation' });
          }
        }
      },

      // CLASS 2: sql.unsafe(...) called with 2+ args (executor form). The safe
      // 1-arg interpolation form is left alone.
      CallExpression(node) {
        if (isUnsafeCallee(node.callee) && node.arguments.length >= 2) {
          context.report({ node, messageId: 'unsafeExecutor' });
        }
      },
    };
  },
};
