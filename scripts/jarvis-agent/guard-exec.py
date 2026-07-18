#!/usr/bin/env python3
"""PreToolUse guard for Jarvis EXECUTE mode.

Execute mode runs only after Hein has approved a specific action from his
authenticated DM, so it is allowed to make ordinary state changes (restart a
service, repackage a project, targeted SQL update, docker restart, edit a
config). This guard is a last-resort safety net: it blocks only CATASTROPHIC /
irreversible commands that no single ops fix should ever need — protection
against a mis-scoped approved action, not against normal changes.
"""
import json
import re
import sys

CATASTROPHIC = [
    (r"\brm\s+-[rf]*\s+(-[rf]*\s+)*(/|~|/home|/etc|/var|/usr|/opt|/boot|/root|\*|\.\s*$|/\s)", "wholesale delete of a critical path"),
    (r":\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;", "fork bomb"),
    (r"\b(mkfs|wipefs|fdisk|parted|sgdisk)\b", "disk format/partition"),
    (r"\bdd\b[^\n]*\bof=/dev/", "dd to a device"),
    (r">\s*/dev/(sd|nvme|vd|mapper)", "write to a block device"),
    (r"\b(shutdown|reboot|poweroff|halt)\b|\binit\s+[06]\b", "host power state change"),
    (r"\bchmod\s+-R\s+[0-7]*7[0-7]*\s+/", "recursive world-writable on root"),
    (r"\bchown\s+-R\b[^\n]*\s+/(\s|$)", "recursive chown of root"),
    (r"\bDROP\s+(DATABASE|SCHEMA)\b", "drop database/schema"),
    (r"\bTRUNCATE\b", "truncate table"),
    (r"\bDELETE\s+FROM\s+[\w\".]+(?![^;\"']*\bWHERE\b)", "DELETE without WHERE"),
    (r"\bUPDATE\s+[\w\".]+\s+SET\b(?![^;\"']*\bWHERE\b)", "UPDATE without WHERE"),
    (r"\bgit\s+push\b[^\n]*--force[^\n]*\b(master|main|origin/master|origin/main)\b", "force-push to master"),
    (r"docker\s+(system\s+prune|volume\s+rm|volume\s+prune)", "docker volume/system prune"),
]


def main() -> None:
    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)
    if data.get("tool_name") != "Bash":
        sys.exit(0)
    cmd = (data.get("tool_input") or {}).get("command", "")
    for pattern, label in CATASTROPHIC:
        if re.search(pattern, cmd, re.IGNORECASE):
            print(json.dumps({
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": (
                        f"BLOCKED even in execute mode: this is a {label}. No approved ops "
                        "fix should require it. Stop and report to Hein instead."
                    ),
                }
            }))
            sys.exit(0)
    sys.exit(0)


if __name__ == "__main__":
    main()
