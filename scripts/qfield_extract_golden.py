#!/usr/bin/env python3
"""
Golden --dry-run capture for extract-gpkg-photos.py — the live-data half of the
decomposition safety net.

test_qfield_extract_characterization.py pins the DECISION logic against a stub DB.
It therefore cannot see SQL that is malformed or disagrees with the live schema —
a parse-time error would sail past it (this repo has shipped exactly that class of
bug before). This script closes that half: it runs the REAL extractor against the
REAL database and the REAL MinIO for every registered project, and records what
each one did.

Workflow around a refactor:

    # on the current code
    DATABASE_URL=... python3 scripts/qfield_extract_golden.py --out before.txt
    # on the refactored code
    DATABASE_URL=... python3 scripts/qfield_extract_golden.py --out after.txt
    diff before.txt after.txt      # must be empty

--dry-run writes nothing, so this is safe to run at any time, including against
production data. It does not commit and does not touch sync-state.

Volatile fields (GPKG version ids, byte sizes, elapsed times, absolute paths) are
normalised out, because they change between runs for reasons unrelated to a
refactor. Photo COUNTS are deliberately NOT normalised — they are the signal.

Caveat worth knowing: upstream state can genuinely change between two captures if a
crew uploads photos in the gap, which shows up as a real diff. Run the pair
back-to-back, and if a project's counts move, re-capture both before concluding the
refactor caused it.
"""
import argparse
import os
import re
import subprocess
import sys

SCRIPTS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPTS)

from qfield_project_registry import PROJECTS  # noqa: E402

EXTRACTOR = os.path.join(SCRIPTS, "extract-gpkg-photos.py")

# Volatile → stable. Order matters; each is applied in sequence to every line.
NORMALISERS = [
    (re.compile(r"v\d{14}-[0-9a-f]+"), "<VERSION>"),
    (re.compile(r"\(\d+KB\)"), "(<SIZE>)"),
    (re.compile(r"/tmp/[^\s]+\.gpkg"), "<TMPFILE>"),
    (re.compile(r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[^\s]*"), "<TIMESTAMP>"),
    (re.compile(r"\bin \d+\.\d+s\b"), "in <ELAPSED>"),
]


def normalise(text):
    out = []
    for line in text.splitlines():
        for pattern, repl in NORMALISERS:
            line = pattern.sub(repl, line)
        out.append(line.rstrip())
    return out


def capture(project, timeout, force=True):
    """Run one project's dry-run; return normalised lines (or an error marker).

    force defaults ON. Without it most projects short-circuit at the delta check
    ("SKIP: Already processed this version") and the capture records almost nothing —
    precisely the code the refactor is about to move would go unexercised. --force
    only bypasses the delta check and the sync-state lookup; every write in
    extract_project is gated on `if not dry_run`, so this still writes nothing.
    """
    cmd = [sys.executable, EXTRACTOR, "--project", project, "--dry-run"]
    if force:
        cmd.append("--force")
    try:
        res = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout,
            cwd=os.path.dirname(SCRIPTS),
        )
    except subprocess.TimeoutExpired:
        return [f"!! TIMEOUT after {timeout}s"]
    lines = normalise(res.stdout)
    if res.returncode != 0:
        lines.append(f"!! EXIT {res.returncode}")
        lines.extend(normalise(res.stderr)[-10:])
    return lines


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="file to write the capture to")
    ap.add_argument("--project", action="append",
                    help="limit to these projects (repeatable); default is all registered")
    ap.add_argument("--timeout", type=int, default=600, help="per-project timeout (default 600s)")
    ap.add_argument("--no-force", action="store_true",
                    help="do not pass --force; most projects will then short-circuit at "
                         "the delta check and the capture will hold little signal")
    args = ap.parse_args()

    if not os.environ.get("DATABASE_URL"):
        print("ERROR: DATABASE_URL not set", file=sys.stderr)
        return 1

    targets = args.project or sorted(PROJECTS)
    unknown = [p for p in targets if p not in PROJECTS]
    if unknown:
        print(f"ERROR: not in the registry: {unknown}", file=sys.stderr)
        return 1

    body = []
    for name in targets:
        print(f"  capturing {name} ...", file=sys.stderr)
        body.append(f"===== {name} =====")
        body.extend(capture(name, args.timeout, force=not args.no_force))
        body.append("")

    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write("\n".join(body) + "\n")

    errors = sum(1 for line in body if line.startswith("!!"))
    print(f"\nWrote {args.out}: {len(targets)} project(s), {len(body)} lines, "
          f"{errors} error marker(s).", file=sys.stderr)
    if errors:
        print("NOTE: error markers are recorded, not suppressed — a refactor that turns "
              "an error into a success (or vice versa) must show up in the diff.",
              file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
