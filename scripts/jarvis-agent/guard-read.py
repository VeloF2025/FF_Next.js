#!/usr/bin/env python3
"""PreToolUse guard for the Read / Grep / Glob tools.

The Bash guards only see Bash commands; a native `Read(".claude/credentials.local.md")`
never reaches them. This hook covers the file-access tools and denies any read of
a credential / key / secret file, in both diagnosis and verify modes.

Fails CLOSED: unparseable input is denied.
"""
import json
import re
import sys

SECRET_PATH = re.compile(
    r"(credentials\.local\.md"
    r"|(^|/)[^/\s'\"]*\.env(\.[\w.-]+)?($|['\"\s])"   # any *.env / *.env.* basename (incl. jarvis-agent.env)
    r"|jarvis-agent\.env"
    r"|\bid_rsa\b|\bid_ed25519\b|\bid_ecdsa\b"
    r"|\.pem($|['\"\s])|\.key($|['\"\s])|authorized_keys|\.pgpass|\.npmrc"
    r"|/\.ssh(/|$|['\"\s])|(^|/)\.ssh(/|$)"            # ssh dir
    r"|/\.jarvis-agent(/|$|['\"\s])"                  # relay runtime (holds secrets)
    r"|/root/\."                                       # dotfiles under /root
    r"|secrets?\.(ya?ml|json|env|txt)|credentials(\.|_))",
    re.IGNORECASE,
)


def deny(reason: str) -> None:
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse", "permissionDecision": "deny",
        "permissionDecisionReason": reason,
    }}))
    sys.exit(0)


def main() -> None:
    try:
        data = json.load(sys.stdin)
    except Exception:
        deny("guard could not parse the tool call — denying (fail closed).")
    if data.get("tool_name") not in ("Read", "Grep", "Glob"):
        sys.exit(0)
    ti = data.get("tool_input") or {}
    targets = [str(ti.get(k, "")) for k in ("file_path", "path", "pattern", "glob")]
    for t in targets:
        if t and SECRET_PATH.search(t):
            deny(
                "BLOCKED: reading credential/secret files is not allowed. Jarvis never needs "
                "to read or reveal a secret to answer a question."
            )
    sys.exit(0)


if __name__ == "__main__":
    main()
