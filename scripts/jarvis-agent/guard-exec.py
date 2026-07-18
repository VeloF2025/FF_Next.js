#!/usr/bin/env python3
"""PreToolUse guard for Jarvis EXECUTE mode.

Execute mode runs only after Hein has approved a specific action from his
authenticated DM, so it is allowed to make ordinary state changes (restart a
service, repackage a project, targeted SQL update, docker restart). This guard
blocks (a) CATASTROPHIC/irreversible commands, (b) writes to security-sensitive
paths (ssh keys, sudoers, systemd, cron, the Jarvis runtime itself), and
(c) code-execution wrappers that would defeat the denylist. It is a safety net
against a mis-scoped approved action, not against ordinary approved changes.

Fails CLOSED: unparseable input is denied.
"""
import json
import re
import sys

CODE_EXEC = [
    (r"\bpython[0-9.]*\s+-c\b", "inline python"),
    (r"\bperl\s+-e\b", "inline perl"),
    (r"\bruby\s+-e\b", "inline ruby"),
    (r"\bnode\s+-e\b|\bnode\s+--eval\b", "inline node"),
    (r"\bbash\s+-c\b|\bsh\s+-c\b|\bzsh\s+-c\b", "inline shell -c"),
    (r"\beval\b", "eval"),
    (r"\bbase64\s+-d\b[^\n|]*\|\s*(ba|z)?sh\b", "base64-decode piped to shell"),
]

# Writes/edits to security-sensitive targets — blocked even when approved,
# because no ordinary ops fix should touch these and they enable persistence
# / privilege escalation. `_SENS` = the sensitive path fragments; two shapes
# reach them: a shell redirect (`> path`) or a write command (tee/cp/mv/sed -i).
_SENS = (r"(/\.ssh/|authorized_keys|/etc/sudoers|/etc/passwd|/etc/shadow|/etc/systemd|"
         r"/etc/cron|/etc/pam|/root/|\.bashrc|\.bash_profile|\.profile)")
_RUNTIME = r"(\.jarvis-agent/|jarvis-agent/(relay|guard|guard-exec)\.py|settings(-exec)?\.json)"
SENSITIVE_WRITE = [
    (rf">>?\s*['\"]?\S*{_SENS}", "redirect to a security-sensitive path"),
    (rf"\b(tee|cp|scp|rsync|mv|install|ln|dd)\b[^\n]*{_SENS}", "write to a security-sensitive path"),
    (rf"\bsed\s+-i\b[^\n]*{_SENS}", "in-place edit of a security-sensitive path"),
    (rf">>?\s*['\"]?\S*{_RUNTIME}", "modifying the Jarvis runtime itself"),
    (rf"\b(tee|cp|mv|sed\s+-i)\b[^\n]*{_RUNTIME}", "modifying the Jarvis runtime itself"),
    (r"\bcrontab\b", "crontab modification"),
    (r"\b(useradd|usermod|adduser|passwd|visudo)\b", "user/privilege change"),
]

CATASTROPHIC = [
    (r"\brm\s+-[rf]*\s*(-[rf]*\s*)*(/|~|/home|/etc|/var|/usr|/opt|/boot|/root|\*)", "wholesale delete of a critical path"),
    (r":\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;", "fork bomb"),
    (r"\b(mkfs|wipefs|fdisk|parted|sgdisk)\b", "disk format/partition"),
    (r"\bdd\b[^\n]*\bof=/dev/", "dd to a device"),
    (r">\s*/dev/(sd|nvme|vd|mapper)", "write to a block device"),
    (r"\b(shutdown|reboot|poweroff|halt)\b|\binit\s+[06]\b", "host power state change"),
    (r"\bchmod\s+-R\s+[0-7]*7[0-7]*\s+/", "recursive world-writable on root"),
    (r"\bchown\s+-R\b[^\n]*\s+/(\s|$)", "recursive chown of root"),
    (r"\bDROP\s+(DATABASE|SCHEMA)\b", "drop database/schema"),
    (r"\bTRUNCATE\b", "truncate table"),
    # DELETE/UPDATE without a WHERE — also catch the `-- WHERE` comment trick:
    (r"\bDELETE\s+FROM\s+[\w\".]+(?![^;\"']*\bWHERE\b)", "DELETE without WHERE"),
    (r"\bUPDATE\s+[\w\".]+\s+SET\b(?![^;\"']*\bWHERE\b)", "UPDATE without WHERE"),
    (r"\b(DELETE\s+FROM|UPDATE\s+[\w\".]+\s+SET)\b[^;]*--", "SQL with a line comment (WHERE-neutralizing trick)"),
    (r"\bgit\s+push\b[^\n]*--force[^\n]*\b(master|main|origin/master|origin/main)\b", "force-push to master"),
    (r"docker\s+(system\s+prune|volume\s+rm|volume\s+prune)", "docker volume/system prune"),
]

ALL = CODE_EXEC + SENSITIVE_WRITE + CATASTROPHIC


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
    if data.get("tool_name") != "Bash":
        sys.exit(0)
    cmd = (data.get("tool_input") or {}).get("command", "")
    for pattern, label in ALL:
        if re.search(pattern, cmd, re.IGNORECASE):
            deny(
                f"BLOCKED even in execute mode: this is a {label}. No approved ops fix should "
                "require it. Stop and report to Hein instead."
            )
    sys.exit(0)


if __name__ == "__main__":
    main()
