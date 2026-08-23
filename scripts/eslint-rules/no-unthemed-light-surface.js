/**
 * ESLint Rule: no-unthemed-light-surface
 *
 * Bans a hard-coded LIGHT background class in a className that has neither a
 * `dark:` variant nor a paired explicit dark-safe text colour.
 *
 * The app ships a light and a dark theme. Text colour follows the theme (the
 * `--foreground` token flips 3.9% -> 98% lightness), but a hard-coded
 * `bg-white` / `bg-gray-100` does not. In dark mode the surface stays white
 * while the text goes near-white: light-on-light, invisible.
 *
 * This reached production. `MapAttentionPanel` measured 1.04:1 contrast in dark
 * mode. Four code reviewers missed it, because contrast is not visible in a diff.
 *
 * Bad:
 *   <div className="rounded-lg border bg-white shadow-lg">
 *   <div className="p-4 bg-gray-50 rounded-lg">
 *
 * Good — theme token (preferred, the repo convention):
 *   <div className="rounded-lg border bg-card shadow-lg">
 *   <div className="p-4 bg-secondary rounded-lg">
 *
 * Good — dark variant:
 *   <div className="bg-white dark:bg-neutral-900">
 *
 * Good — deliberately light-only surface, pinned text colour:
 *   <div className="bg-white text-gray-900">   {/* printable page, signature pad *\/}
 *
 * Deliberate design decisions
 * ---------------------------
 * 1. FAILS TOWARD FALSE POSITIVES. A rule that misses the next invisible panel
 *    is worse than one that occasionally asks a developer to be explicit. It
 *    cannot see a text colour inherited from a parent element or supplied by a
 *    CSS variable, so it will flag some correct code. The fix in those cases is
 *    to state the colour locally, which is cheap and makes the intent readable.
 *
 * 2. A `dark:` variant only clears the finding when it targets the BACKGROUND or
 *    the TEXT (`dark:bg-*`, `dark:text-*`). A lone `dark:border-*` does not fix
 *    light-on-light, so it must not silence the rule.
 *
 * 3. The escape-hatch text colour must be a LITERAL dark colour. Theme tokens
 *    (`text-foreground`, `text-card-foreground`) flip to near-white in dark mode
 *    and so are NOT a pairing for a hard-coded white surface — they are the
 *    exact mechanism that produced the original bug.
 *
 * 4. Low-opacity utilities (`bg-white/10`) are a translucent TINT, not a
 *    surface — they are overwhelmingly used over dark backdrops and photo
 *    lightboxes, where they are correct. Only opacity >= 60 counts as a surface.
 *    Threshold is configurable via the `opaqueFrom` option.
 *
 * 5. Scope is `className`/`class` JSX attributes plus any variable or object
 *    property whose name contains "class" — class strings are frequently
 *    hoisted into a lookup table (e.g. a STAGE_BADGE record) and then spread
 *    into className, which an attribute-only rule would miss entirely.
 *
 * 6. Two exemptions, both PROVABLE from the AST rather than guessed, because
 *    the subject of this rule is TEXT contrast and neither case renders text:
 *
 *      a) Replaced / void elements (`<img>`, `<canvas>`, `<video>`, `<hr>` ...).
 *         HTML gives them no rendered text children, so a light background on
 *         one is a design choice, never an invisible-text bug. A white plate
 *         behind a logo or a signature canvas is the single most common correct
 *         use of `bg-white` in this repo's dark portal; flagging it would train
 *         developers to switch the rule off.
 *
 *      b) Elements with NO children at all (`<span className="... bg-white" />`)
 *         — a toggle knob, a divider, a dot. Zero children is zero text.
 *
 *    Neither exemption weakens the case this rule exists for: every one of the
 *    four MapAttentionPanel findings is a non-replaced element WITH children,
 *    and all four are still reported. See the test file.
 */

'use strict';

// Hard-coded light surfaces. Matched as whole class tokens.
// The neutral greys. `gray` and `slate` were the original list; `neutral`,
// `zinc` and `stone` are the same lightness ramp under different names, so
// covering one and not the others was an arbitrary hole rather than a decision.
//
// NOT covered, deliberately: the `-50` tints of the COLOURED palettes
// (bg-red-50, bg-blue-50, bg-green-50, bg-amber-50 ...). They are just as light
// and do fail the same way, but measured on 2026-08-23 they appear 706 times
// across 268 files here as status tints, so folding them in would turn a clean
// gate into a several-hundred-finding ratchet. That is a separate cleanup with
// its own baseline, not something to smuggle in behind this rule.
//   grep -rlE 'bg-(red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|
//     blue|indigo|violet|purple|fuchsia|pink|rose)-50\b' --include=*.tsx src pages
const LIGHT_SURFACE_BASES = [
  'bg-white',
  'bg-gray-50', 'bg-gray-100', 'bg-gray-200',
  'bg-slate-50', 'bg-slate-100', 'bg-slate-200',
  'bg-neutral-50', 'bg-neutral-100', 'bg-neutral-200',
  'bg-zinc-50', 'bg-zinc-100', 'bg-zinc-200',
  'bg-stone-50', 'bg-stone-100', 'bg-stone-200',
];

// Arbitrary-value backgrounds: bg-[#fff], bg-[rgb(255,255,255)], bg-[hsl(0,0%,100%)].
// The bracket syntax bypasses the token list entirely, so without this a
// developer told to stop using `bg-white` could satisfy the rule by writing
// `bg-[#fff]` — the identical pixel, silently unguarded.
//
// A regex over hex alone was not enough: `bg-[rgb(255,255,255)]` and
// `bg-[hsl(0,0%,100%)]` are plain white and slipped straight through. Rather
// than grow the pattern again, the value is PARSED and its lightness measured,
// which also lets the dark: escape hatch recognise a genuinely dark arbitrary
// value such as `dark:bg-[#111]` instead of rejecting a correct fix.
const ARBITRARY_BG_RE = /^(?:[a-z0-9-]+:)*bg-\[([^\]]+)\]$/i;
const DARK_ARBITRARY_BG_RE = /^(?:[a-z0-9-]+:)*dark:(?:[a-z0-9-]+:)*bg-\[([^\]]+)\]$/i;

// Named CSS colours light enough to be a light surface. Not exhaustive — an
// unrecognised name returns null (unknown), which counts as light for a plain
// `bg-[...]` and as NOT-dark for a `dark:bg-[...]`, keeping both directions
// biased toward reporting.
const LIGHT_NAMED = new Set([
  'white', 'snow', 'ivory', 'azure', 'floralwhite', 'ghostwhite', 'seashell',
  'whitesmoke', 'aliceblue', 'mintcream', 'honeydew', 'lavenderblush',
  'oldlace', 'linen', 'cornsilk', 'beige', 'lightyellow', 'lightgoldenrodyellow',
]);

/**
 * Relative lightness of an arbitrary Tailwind colour value, 0 (black) to 1
 * (white), or null when the value cannot be parsed.
 *
 * Tailwind writes arbitrary values with underscores standing in for spaces
 * (`bg-[rgb(255_255_255)]`), so those are normalised first.
 */
function arbitraryLightness(raw) {
  const value = String(raw).trim().replace(/_/g, ' ').toLowerCase();

  // A CSS custom property IS the theming mechanism this rule pushes people
  // toward — `bg-[var(--ff-surface-elevated)]` flips with the theme, so it is
  // never an unthemed light surface. It must be treated as safe rather than as
  // an unparseable unknown, or the rule would flag the correct pattern.
  if (value.includes('var(')) return THEMED;

  const hex = /^#([0-9a-f]{3,8})$/.exec(value);
  if (hex) {
    let d = hex[1];
    if (d.length === 3 || d.length === 4) d = d.slice(0, 3).split('').map((c) => c + c).join('');
    if (d.length < 6) return null;
    const r = parseInt(d.slice(0, 2), 16) / 255;
    const g = parseInt(d.slice(2, 4), 16) / 255;
    const b = parseInt(d.slice(4, 6), 16) / 255;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(value);
  if (rgb) {
    const [r, g, b] = [rgb[1], rgb[2], rgb[3]].map((n) => Number(n) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  const hsl = /^hsla?\(\s*[\d.]+(?:deg)?[\s,]+[\d.]+%[\s,]+([\d.]+)%/.exec(value);
  if (hsl) return Number(hsl[1]) / 100;

  if (LIGHT_NAMED.has(value)) return 1;
  if (value === 'black' || value === 'transparent' || value === 'currentcolor') return 0;
  return null;
}

/** Sentinel: value follows the theme, so it is safe in both directions. */
const THEMED = -1;
/** A light surface: bright enough that theme-following text disappears on it. */
const LIGHT_THRESHOLD = 0.75;
/** A genuinely dark dark-mode surface, matching the >= 600 palette-shade floor. */
const DARK_THRESHOLD = 0.35;

// A whole-token match, allowing a `/NN` opacity suffix and any variant prefixes
// (`hover:`, `md:`, `group-hover:` ...). The `dark:` prefix is excluded here —
// `dark:bg-white` is a dark-mode declaration, not an unthemed light surface.
const LIGHT_SURFACE_RE = new RegExp(
  '^(?!.*(?:^|:)dark:)(?:[a-z0-9-]+:)*(' +
    LIGHT_SURFACE_BASES.join('|') +
  ')(?:\\/(\\d{1,3}))?$'
);

const PALETTES =
  'gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|' +
  'cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';

// Theme tokens whose value FLIPS with the theme, so they are genuinely dark in
// dark mode. `dark:bg-card` is a real fix; `dark:bg-white` is not.
const THEME_SURFACE_TOKENS = 'card|background|secondary|muted|popover|accent|primary';

// A `dark:` variant that actually addresses the light-on-light failure.
//
// It is NOT enough for a `dark:bg-*`/`dark:text-*` token to merely EXIST. The
// original rule accepted any of them, which meant the natural way to silence a
// lint error — add a dark: variant — could reship the identical bug:
//
//   "bg-white dark:bg-white"      still white in dark mode
//   "bg-white dark:bg-gray-100"   still light in dark mode
//   "bg-white dark:text-white"    white text on a white surface
//
// All three passed. So the dark-mode VALUE has to be checked, not just its
// presence. Two independent ways to be correct:
//
//   1. the dark-mode BACKGROUND is actually dark  (shade >= 600, black, or a
//      theme token that flips), or
//   2. the surface stays light but the dark-mode TEXT is actually dark
//      (shade >= 400 or black), which is readable on it.
//
// Anything unrecognised counts as NOT a fix, keeping the bias toward false
// positives. Every `dark:bg-*` in this repo today is a 700/800/900 shade, so
// the floor does not reject existing honest code.
const DARK_BG_FIX_RE = new RegExp(
  '^(?:[a-z0-9-]+:)*dark:(?:[a-z0-9-]+:)*bg-(?:black|(?:' + THEME_SURFACE_TOKENS + ')|(?:' +
  PALETTES + ')-(?:[6-9]\\d{2}))(?:\\/\\d{1,3})?$'
);
const DARK_TEXT_FIX_RE = new RegExp(
  '^(?:[a-z0-9-]+:)*dark:(?:[a-z0-9-]+:)*text-(?:black|(?:' +
  PALETTES + ')-(?:[4-9]\\d{2}))(?:\\/\\d{1,3})?$'
);

// A literal, dark-enough text colour. Explicitly EXCLUDES:
//   - text-white and the 50/100/200/300 tints (not dark-safe on a white surface)
//   - theme tokens (text-foreground, text-card-foreground, ...) which flip to
//     near-white in dark mode — the very bug this rule exists to catch.
const DARK_SAFE_TEXT_RE =
  /^(?:[a-z0-9-]+:)*text-(?:black|(?:gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:[4-9]\d{2}))(?:\/\d{1,3})?$/;

// Elements that cannot render text children, so can never be light-on-light.
//
// `input` was originally on this list and has been REMOVED. Its placeholder and
// value are real rendered text subject to the same theme-following colour, so
// exempting it was a genuine hole rather than an AST-provable exemption like
// the others here. Removing it costs nothing measurable: re-scanned across all
// 2112 .tsx files, it produces zero new findings — there was no false-positive
// price to pay for closing it.
const TEXTLESS_ELEMENTS = new Set([
  'img', 'canvas', 'video', 'audio', 'iframe', 'embed', 'object',
  'hr', 'br', 'source', 'track', 'picture', 'progress', 'meter',
]);

// Elements that render text WITHOUT any JSX children, so the "no children"
// exemption must not apply to them: an <input>'s placeholder and value are
// painted onto its own background.
const SELF_TEXT_ELEMENTS = new Set(['input', 'textarea']);

/** Split a class string into tokens. */
function tokens(value) {
  return String(value).split(/\s+/).filter(Boolean);
}

/**
 * Collect every static string that contributes to one className expression,
 * walking through cn()/clsx()/template literals/ternaries/&&.
 * Dynamic segments (`${expr}`) are invisible; that is part of failing toward
 * false positives — an unresolvable segment never counts as a fix.
 */
function collectStrings(node, out) {
  if (!node || typeof node !== 'object') return;
  switch (node.type) {
    case 'Literal':
      if (typeof node.value === 'string') out.push(node.value);
      return;
    case 'TemplateLiteral':
      for (const q of node.quasis) out.push(q.value.cooked ?? q.value.raw ?? '');
      for (const e of node.expressions) collectStrings(e, out);
      return;
    case 'JSXExpressionContainer':
      collectStrings(node.expression, out);
      return;
    case 'ConditionalExpression':
      collectStrings(node.consequent, out);
      collectStrings(node.alternate, out);
      return;
    case 'LogicalExpression':
    case 'BinaryExpression':
      collectStrings(node.left, out);
      collectStrings(node.right, out);
      return;
    case 'CallExpression':
      for (const a of node.arguments) collectStrings(a, out);
      return;
    case 'ArrayExpression':
      for (const el of node.elements) collectStrings(el, out);
      return;
    case 'ObjectExpression':
      // BOTH keys and values. The clsx/cn conditional idiom puts the class name
      // in the KEY — `cn({ 'bg-white': isActive })` — so reading values alone
      // misses it entirely, which is the single most common way a conditional
      // surface class is written.
      for (const p of node.properties) {
        if (p.type !== 'Property') continue;
        if (p.key) {
          if (p.key.type === 'Literal' && typeof p.key.value === 'string') out.push(p.key.value);
          else if (p.key.type === 'Identifier' && !p.computed) out.push(p.key.name);
        }
        collectStrings(p.value, out);
      }
      return;
    default:
      return;
  }
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow hard-coded light background classes without a dark: variant or a paired dark-safe text colour',
      category: 'Possible Errors',
      recommended: true,
    },
    schema: [
      {
        type: 'object',
        properties: {
          // Opacity (percent) at or above which `bg-white/NN` counts as a
          // surface rather than a translucent tint.
          opaqueFrom: { type: 'integer', minimum: 0, maximum: 100, default: 60 },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      unthemedLightSurface:
        "Hard-coded light surface '{{cls}}' with no dark: variant and no paired dark-safe text colour — " +
        'this renders light-on-light in dark mode (the Fleet map panel shipped at 1.04:1 this way). ' +
        "Prefer the theme token ('bg-card' / 'bg-secondary'). If the surface is deliberately light-only " +
        "(printable page, signature pad, photo lightbox), pin the text colour too, e.g. 'text-gray-900'.",
    },
  },

  create(context) {
    const opaqueFrom =
      (context.options && context.options[0] && context.options[0].opaqueFrom) ?? 60;

    /** Is this token a light SURFACE (not a low-opacity tint)? */
    function lightSurfaceIn(tok) {
      if (/(?:^|:)dark:/.test(tok)) return null;
      const arbitrary = ARBITRARY_BG_RE.exec(tok);
      if (arbitrary) {
        const lightness = arbitraryLightness(arbitrary[1]);
        // Unparseable counts as light: an unknown value must not buy silence.
        if (lightness === THEMED) return null;
        return lightness === null || lightness >= LIGHT_THRESHOLD ? tok : null;
      }
      const m = LIGHT_SURFACE_RE.exec(tok);
      if (!m) return null;
      if (m[2] !== undefined && Number(m[2]) < opaqueFrom) return null;
      return tok;
    }

    function check(node, valueNode) {
      const strings = [];
      collectStrings(valueNode, strings);
      if (strings.length === 0) return;

      const all = strings.flatMap(tokens);

      const offender = all.map(lightSurfaceIn).find(Boolean);
      if (!offender) return;

      // Either escape hatch, evaluated across the WHOLE className expression.
      const hasDarkFix = all.some((t) => {
        if (DARK_BG_FIX_RE.test(t) || DARK_TEXT_FIX_RE.test(t)) return true;
        // A dark arbitrary value (`dark:bg-[#111]`) is a legitimate fix. Without
        // this, hitting an exact brand colour that way is rejected, which is the
        // shape most likely to make someone reach for eslint-disable.
        const darkArbitrary = DARK_ARBITRARY_BG_RE.exec(t);
        if (!darkArbitrary) return false;
        const lightness = arbitraryLightness(darkArbitrary[1]);
        return lightness === THEMED || (lightness !== null && lightness >= 0 && lightness <= DARK_THRESHOLD);
      });
      const hasDarkSafeText = all.some((t) => DARK_SAFE_TEXT_RE.test(t));
      if (hasDarkFix || hasDarkSafeText) return;

      context.report({ node, messageId: 'unthemedLightSurface', data: { cls: offender } });
    }

    /** Does this identifier/key name suggest it holds class strings? */
    function looksLikeClassHolder(name) {
      return typeof name === 'string' && /class/i.test(name);
    }

    return {
      JSXAttribute(node) {
        const name = node.name && node.name.name;
        if (name !== 'className' && name !== 'class') return;
        if (!node.value) return;

        const opening = node.parent;
        if (opening && opening.type === 'JSXOpeningElement') {
          const el = opening.name;
          // Exemption (a): a replaced/void element renders no text.
          if (el && el.type === 'JSXIdentifier' && TEXTLESS_ELEMENTS.has(el.name)) return;

          // Exemption (b): an element with no children renders no text.
          // Self-closing, or a JSXElement whose children are only whitespace.
          //
          // `dangerouslySetInnerHTML` defeats this: the element has no JSX
          // children yet renders arbitrary text, so it is exactly the
          // light-on-light case the rule exists for. Never exempt it.
          const injectsHtml = opening.attributes.some(
            (a) => a.type === 'JSXAttribute' && a.name && a.name.name === 'dangerouslySetInnerHTML'
          );
          const rendersOwnText =
            el && el.type === 'JSXIdentifier' && SELF_TEXT_ELEMENTS.has(el.name);
          if (!injectsHtml && !rendersOwnText) {
            const parent = opening.parent;
            const children =
              parent && parent.type === 'JSXElement' ? parent.children : [];
            const hasChildren = children.some(
              (c) =>
                !(c.type === 'JSXText' && c.value.trim() === '') &&
                !(c.type === 'JSXExpressionContainer' && c.expression.type === 'JSXEmptyExpression')
            );
            if (opening.selfClosing || !hasChildren) return;
          }
        }

        check(node, node.value);
      },

      // Hoisted class strings: `const cardClass = 'bg-white p-4'`,
      // `const STAGE_BADGE = { done: { className: 'bg-gray-100' } }`.
      VariableDeclarator(node) {
        if (!node.id || node.id.type !== 'Identifier') return;
        if (!looksLikeClassHolder(node.id.name)) return;
        if (!node.init) return;
        check(node, node.init);
      },

      Property(node) {
        const key = node.key && (node.key.name || node.key.value);
        if (!looksLikeClassHolder(key)) return;
        check(node, node.value);
      },
    };
  },
};
