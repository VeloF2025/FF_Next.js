# Git hooks — how they are wired, and why this way

Full reference for `scripts/install-hooks.sh` and `scripts/githooks/`. The script
keeps only short comments explaining individual lines; the history and the
reasoning live here.

## What is installed

One command per clone:

```bash
bash scripts/install-hooks.sh
```

It sets `core.hooksPath` to an **absolute** path at the **main worktree's**
`scripts/githooks`. The hooks are tracked files, run in place — nothing is
copied anywhere.

| Hook | Guards |
|------|--------|
| `pre-commit` | secret scan of the staged diff |
| `pre-push` | master-push protection, secret scan of the pushed range, auth isolation |

Requires git >= 2.9 (`core.hooksPath` is silently ignored by older gits, so the
installer refuses rather than set a key that will never be read).

## Why `core.hooksPath` and not copying into `.git/hooks`

The installer used to **copy** the hook scripts into `.git/hooks`. That design
caused the exact bug it was later rewritten to prevent: on one workstation the
installed `pre-push` had diverged from the tracked script and carried a
master-push guard the tracked one lacked. Installing would have added the secret
scan and **deleted that guard in the same command, silently** (#2438).

Hardening the copy took three review rounds and fourteen findings — backup on
divergence, collision-safe backup names, symlink replacement, an unguarded
`chmod` that let git skip a non-executable hook while the script reported
success, repo-shape resolution, refusal paths. Every one was a real Unix edge
case around copying a file into a directory git owns. The list was not
converging, so the design changed instead.

`core.hooksPath` removes the class rather than guarding it:

- nothing is copied → nothing can be clobbered, so no backups are needed
- nothing is written to `.git/hooks` → no permission, ownership or chmod failure path
- hooks are tracked → version-controlled, reviewed, identical on every clone

## Why the path is ABSOLUTE

`core.hooksPath` is stored **once for the whole repository**, but a **relative**
value resolves against **each checkout's own root**. In a repo with many
worktrees that is a silent hole: a worktree on a branch predating the hooks has
no `scripts/githooks`, so git finds nothing there and skips the hooks without a
word.

Measured on the development machine when this was found: **42 of 43 worktrees**
lacked the directory — the gate would have been off in all of them while the
installer reported success (#2449).

So the value is absolute and anchored to the main worktree, which is the one
stable location; worktrees are created and deleted constantly. Every checkout
then runs the same real directory regardless of its branch.

**The trade-off, stated plainly:** a worktree on an old branch runs the main
tree's hooks, not its own branch's. For a security gate that is the better
direction — the newest gate everywhere beats each branch's historical one.

## The residual failure mode (accepted, not fixed)

Anchoring to a working-tree path means the gate is only as present as that
directory. If the anchor worktree stops having `scripts/githooks` — checking out
a commit that predates it is the realistic way — git finds nothing at the
configured path and **silently runs no hooks at all**, in the main tree and in
every worktree, *including worktrees whose own copy is intact*.

Measured: a worktree with its own executable `pre-commit` went from "blocked,
exit 1" to "committed, exit 0, no output" when the main tree's directory was
moved aside. Nothing local detects this — git does not warn when a configured
`hooksPath` is absent.

This is **not fixable within this design.** The hooks are tracked files, so any
working-tree anchor is branch-dependent, and the alternative (copy into
`.git/hooks`) is the design this replaced.

What makes it acceptable: **local hooks are the fast feedback, not the gate of
record.** The same secret scan runs in CI over the pushed commit range, where a
developer's local config cannot switch it off. Losing the local hooks costs early
warning, not enforcement.

An earlier version of the script's header claimed the opposite — that the only
way left to lose the hooks was "a deliberate act with a visible cause". That was
wrong, and a reviewer disproved it by moving a directory.

## Resolving the anchor worktree — four traps, all measured

The resolution loop in the installer looks over-built. Each guard is a defect
that was reproduced:

1. **`awk '{print $2}'` splits on whitespace.** A repository path containing a
   **space** resolved to everything before the space, so the target could never
   exist and the installer refused with a wrong diagnosis ("on a commit
   predating these hooks") on a checkout that was fine. Split on the `worktree `
   prefix instead. This was a regression introduced *by* the absolute-path fix —
   the previous `git rev-parse --show-toplevel` form was space-safe.
2. **The first porcelain entry is not always a working tree.** For a **bare**
   repo it is the bare git-dir; inside a **submodule** it is
   `.git/modules/<name>`. Neither ever has `scripts/githooks` checked out, so the
   installer refused forever *and* printed a remedy
   (`git -C <git-dir> checkout master`) that itself fails with "this operation
   must be run in a work tree". Each candidate must therefore be confirmed as the
   **root of a real working tree** before being accepted.
3. **In a pure bare-hub layout the anchor is creation-order accident.** With a
   bare repo and two or more live worktrees there is no "primary" checkout, so
   the loop takes the first listed one. Installing from `bob-wt` anchors to
   `alice-wt` — hooks fire, but on a directory someone else owns, and if alice
   removes her worktree during ordinary cleanup everyone's hooks go dark with
   bob having no idea hers was load-bearing. The installer prints the resolved
   path, which is the only signal. FF_Next.js does not use this layout (normal
   main checkout plus linked worktrees), so this is a documented limitation
   rather than a fixed defect.
4. **A failed install must not leave config behind.** The exec-bit check
   originally ran *after* the config write: the script printed the green
   `core.hooksPath = ...` banner, then the red "not executable" line, exited 1 —
   and left the config pointing at hooks git would silently skip. An empty
   directory did the same. Validation now happens before the write.

## Fail-closed parsing of `git version`

The version gate must fail **closed**, and getting it wrong is how this gate
once became the very thing it guards against:

- `sed` echoes its input unchanged when the pattern does not match, so an
  unparseable `git version` left non-numeric values in the comparison.
- `[ "$x" -lt 2 ]` then **errors** rather than returning true or false, `set -e`
  does not apply inside an `if` condition, both sides of the `||` errored, the
  whole condition evaluated false, and the script fell through to a green banner.
  Measured with a shimmed `git`: exit 0, config set, two swallowed "integer
  expression expected" lines. Reachable through a wrapped `git` — corporate
  security tooling, a version manager.
- A digits-only check was **not** sufficient: an all-digit but huge value makes
  `[ -lt ]` fail the same way. Measured with a 32-digit major: exit 0, config
  set, green banner. An earlier probe of this vector used 13 digits, which fits
  in an int64 and compares fine, so it reported the hole as closed — a weak probe
  manufacturing confidence.

Hence: extract with a pattern that can only yield digits, and require both parts
to be non-empty digit strings **bounded to 5 characters** before comparing
anything. Bounding the input is what makes the comparison safe to run.

## What this does NOT change

- Still one command per clone — a fresh clone has no hooks until it is run.
- `--no-verify` still bypasses everything.
- Someone can still unset the config.
- `core.hooksPath` redirects **all** hook types, so a developer's own
  `commit-msg` or `post-checkout` in `.git/hooks` stops firing the moment this
  runs. The installer reports every executable hook it finds there and deletes
  nothing — one of them may be the only copy of a local guard.

## Tests

`scripts/install-hooks.test.mjs` (25 cases) and `scripts/pre-push.test.mjs`
(17 cases), both run in CI. The install tests prove hooks genuinely **fire** —
by making a real commit and asserting it is blocked — rather than that a config
value looks right. Cases exist for the spaced path, the bare-repo layout, the
old-git fallback, "main lacks the hooks but the current worktree has them", and
"a failed install leaves the config unset"; each was confirmed to fail when the
corresponding guard is mutated away.
