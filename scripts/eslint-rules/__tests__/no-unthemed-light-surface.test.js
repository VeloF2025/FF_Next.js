/**
 * Tests for the no-unthemed-light-surface ESLint rule.
 *
 * Runnable standalone (worktree vitest hangs):
 *   node scripts/eslint-rules/__tests__/no-unthemed-light-surface.test.js
 *
 * Exits non-zero on any failure.
 */
'use strict';

const { RuleTester } = require('eslint');
const path = require('path');
const rule = require(path.resolve(__dirname, '../no-unthemed-light-surface'));

RuleTester.describe = function (_text, fn) { return fn(); };
RuleTester.it = function (text, fn) {
  try {
    fn();
    console.log(`  ✓ ${text}`);
  } catch (e) {
    console.error(`  ✗ ${text}\n    ${e.message}`);
    process.exitCode = 1;
  }
};

const ruleTester = new RuleTester({
  parser: require.resolve('@typescript-eslint/parser'),
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
});

const E = [{ messageId: 'unthemedLightSurface' }];

ruleTester.run('no-unthemed-light-surface', rule, {
  valid: [
    // --- The repo convention: theme tokens flip with the theme.
    { code: '<div className="rounded-lg border bg-card shadow-lg">x</div>;' },
    { code: '<div className="p-4 bg-secondary rounded-lg">x</div>;' },
    { code: '<div className="bg-card text-card-foreground">x</div>;' },

    // --- A dark: variant that restates the BACKGROUND.
    { code: '<div className="bg-white dark:bg-neutral-900">x</div>;' },
    { code: '<div className="bg-gray-50 dark:bg-gray-800">x</div>;' },
    // --- ...or the TEXT.
    { code: '<div className="bg-white dark:text-gray-900">x</div>;' },
    // --- dark: behind another variant prefix still counts.
    { code: '<div className="bg-white md:dark:bg-neutral-900">x</div>;' },

    // --- Deliberately light-only surface with a pinned dark-safe text colour.
    { code: '<div className="bg-white text-gray-900">x</div>;' },
    { code: '<div className="bg-gray-50 text-black">x</div>;' },
    { code: '<div className="bg-white text-red-700">x</div>;' },

    // --- Replaced elements render no text (exemption a).
    { code: '<img src={s} alt="" className="bg-white p-1" />;' },
    { code: '<canvas className="bg-white touch-none" />;' },
    { code: '<video className="bg-gray-100" />;' },

    // --- Childless elements render no text (exemption b).
    { code: '<span className="h-4 w-4 rounded-full bg-white shadow" />;' },
    { code: '<div className="bg-white"></div>;' },

    // --- Low-opacity utilities are a translucent tint, not a surface.
    { code: '<div className="bg-white/10 rounded-lg p-3">x</div>;' },
    { code: '<div className="bg-white/20 hover:bg-white/30">x</div>;' },

    // --- dark:bg-white is a DARK-mode declaration, not an unthemed light surface.
    { code: '<div className="dark:bg-white bg-neutral-900">x</div>;' },

    // --- Backgrounds outside the light set are none of this rule\'s business.
    { code: '<div className="bg-gray-700">x</div>;' },
    { code: '<div className="bg-[var(--ff-bg-tertiary)]">x</div>;' },
    // bg-gray-300 is not in the light-surface set (300 is already mid-tone).
    { code: '<div className="bg-gray-300">x</div>;' },

    // --- The escape hatch is honoured across a cn() call and a ternary.
    { code: 'const c = cn("bg-white", "dark:bg-neutral-900"); <div className={c}>x</div>;' },
    { code: '<div className={cn("bg-white", on ? "text-gray-900" : "text-gray-800")}>x</div>;' },

    // --- A hoisted class string that is correctly themed.
    { code: 'const badgeClass = "bg-gray-100 dark:bg-gray-800";' },
    // --- A non-class variable holding the same string is not this rule\'s business.
    { code: 'const helpText = "bg-white";' },
  ],

  invalid: [
    // ================================================================
    // THE PRODUCTION BUG. Verbatim from the pre-fix
    // src/modules/fleet/operations/web/MapAttentionPanel.tsx, which
    // shipped at 1.04:1 contrast in dark mode. All four must fire.
    // ================================================================
    {
      code: '<span className="ml-2 rounded bg-gray-100 px-2 py-1 text-xs">{STATUS_LABELS[item.row.status]}</span>;',
      errors: E,
    },
    {
      code: '<aside aria-label="Map attention" className="flex max-h-full flex-col rounded-lg border bg-white shadow-lg">{body}</aside>;',
      errors: E,
    },
    {
      code: '<button onClick={f} className="rounded border bg-white px-3 py-2 shadow">Attention ({n})</button>;',
      errors: E,
    },
    {
      code: '<section aria-label="Mobile map attention" className="rounded-t-lg border bg-white shadow-lg">{body}</section>;',
      errors: E,
    },

    // --- Every light surface in the banned set.
    { code: '<div className="bg-white">x</div>;', errors: E },
    { code: '<div className="bg-gray-50">x</div>;', errors: E },
    { code: '<div className="bg-gray-100">x</div>;', errors: E },
    { code: '<div className="bg-gray-200">x</div>;', errors: E },
    { code: '<div className="bg-slate-50">x</div>;', errors: E },
    { code: '<div className="bg-slate-100">x</div>;', errors: E },

    // --- A high-opacity utility IS a surface.
    { code: '<div className="bg-white/90">x</div>;', errors: E },

    // --- A dark: variant that does NOT restate bg or text does not rescue it.
    //     This is the whole point of design note 2: a themed border over a
    //     hard-coded white surface still renders light-on-light.
    { code: '<div className="bg-white dark:border-gray-600">x</div>;', errors: E },

    // --- Theme-token text is NOT a pairing: --card-foreground flips to 98%
    //     lightness in dark mode, which is the exact mechanism of the bug.
    { code: '<div className="bg-white text-card-foreground">x</div>;', errors: E },
    { code: '<div className="bg-white text-foreground">x</div>;', errors: E },
    { code: '<div className="bg-white text-muted-foreground">x</div>;', errors: E },

    // --- Near-white text tints are not dark-safe on a white surface.
    { code: '<div className="bg-white text-white">x</div>;', errors: E },
    { code: '<div className="bg-white text-gray-100">x</div>;', errors: E },
    { code: '<div className="bg-white text-gray-300">x</div>;', errors: E },

    // --- A variant-prefixed light surface is still a light surface.
    { code: '<div className="hover:bg-gray-100">x</div>;', errors: E },

    // --- Template literal and cn()/clsx composition are seen through.
    {
      code: '<div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${d === "out" ? "bg-green-100" : "bg-gray-100"}`}>{t}</div>;',
      errors: E,
    },
    { code: '<div className={cn("p-4", "bg-white")}>x</div>;', errors: E },
    { code: '<div className={clsx("bg-gray-50", cond && "shadow")}>x</div>;', errors: E },

    // --- Hoisted class strings (the STAGE_BADGE lookup-table pattern).
    { code: 'const cardClassName = "bg-white p-4";', errors: E },
    { code: 'const STAGE_BADGE = { done: { className: "bg-gray-100 px-2" } };', errors: E },

    // --- An unresolvable dynamic segment never counts as a fix.
    { code: '<div className={`bg-white ${maybeDark}`}>x</div>;', errors: E },

    // --- A replaced element is exempt, but a plain wrapper around one is NOT
    //     (it can still leak a theme-following colour onto text children).
    { code: '<div className="bg-white"><img src={s} alt="" /></div>;', errors: E },

    // --- Object KEYS carry the class in the clsx/cn conditional idiom.
    //     Reading only Property VALUES missed this entirely, and it is the most
    //     common way a conditional surface class is written.
    { code: '<div className={cn({ "bg-white": active })}>x</div>;', errors: E },
    { code: '<div className={clsx({ "bg-gray-100": on, "p-2": true })}>x</div>;', errors: E },

    // --- Arbitrary values bypass the token list. Without these, a developer
    //     told to stop writing `bg-white` satisfies the rule with `bg-[#fff]`
    //     — the identical pixel, unguarded.
    { code: '<div className="bg-[#fff] p-2">x</div>;', errors: E },
    { code: '<div className="bg-[#FFFFFF] p-2">x</div>;', errors: E },
    { code: '<div className="bg-[white] p-2">x</div>;', errors: E },

    // --- The neutral ramp under its other names. Covering gray/slate but not
    //     neutral/zinc/stone was an arbitrary hole, not a decision.
    { code: '<div className="bg-neutral-50 p-2">x</div>;', errors: E },
    { code: '<div className="bg-zinc-100 p-2">x</div>;', errors: E },
    { code: '<div className="bg-stone-50 p-2">x</div>;', errors: E },

    // --- dangerouslySetInnerHTML has no JSX children but renders text, so the
    //     "no children" exemption must not apply to it.
    { code: '<div className="bg-white" dangerouslySetInnerHTML={{ __html: h }} />;', errors: E },
  ],
});

// ---------------------------------------------------------------------------
// Known, deliberate limits — asserted so they are a recorded decision rather
// than an unnoticed hole. Each of these DOES render light-on-light; the rule
// lets them through for a stated reason, and these cases fail loudly if that
// ever changes silently.
// ---------------------------------------------------------------------------
ruleTester.run('no-unthemed-light-surface (documented non-coverage)', rule, {
  valid: [
    // Coloured -50 status tints: same failure, but 400+ files use them here, so
    // they belong to a separate cleanup with its own baseline rather than
    // turning this gate into a 400-finding ratchet on day one.
    '<div className="bg-red-50 p-2">x</div>;',
    '<div className="bg-blue-50 p-2">x</div>;',
    '<div className="bg-amber-50 p-2">x</div>;',
    // Inline styles are out of scope: the rule reads class strings only.
    '<div style={{ background: "#fff" }}>x</div>;',
    // A class assembled by concatenation is not statically resolvable.
    '<div className={"bg-" + "white"}>x</div>;',
  ],
  invalid: [],
});

// ---------------------------------------------------------------------------
// The `opaqueFrom` option is honoured in both directions.
// ---------------------------------------------------------------------------
ruleTester.run('no-unthemed-light-surface (opaqueFrom option)', rule, {
  valid: [
    { code: '<div className="bg-white/70">x</div>;', options: [{ opaqueFrom: 80 }] },
  ],
  invalid: [
    { code: '<div className="bg-white/10">x</div>;', options: [{ opaqueFrom: 5 }], errors: E },
  ],
});

if (process.exitCode) {
  console.error('\nno-unthemed-light-surface: TESTS FAILED');
} else {
  console.log('\nno-unthemed-light-surface: all tests passed');
}
