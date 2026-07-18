#!/usr/bin/env python3
"""PreToolUse guard hook for the Jarvis DIAGNOSIS agent (read-only mode).

Claude Code runs this before every Bash tool call. It denies commands that
change system state, read secrets, or wrap arbitrary code execution — forcing
the agent down the "propose an approval_request" path. Defense-in-depth: the
system prompt is the primary control and Write/Edit are denied at the
permissions layer, but this is the enforced backstop.

Fails CLOSED: on unparseable input it DENIES (a security guard must not silently
allow when it can't inspect the command).
"""
import json
import re
import sys

# Code-execution wrappers — these defeat any string denylist, so block them
# outright. (Note `python3 manage.py shell -c` is NOT matched — only a `-c`/`-e`
# flag directly after the interpreter is.)
CODE_EXEC = [
    (r"\bpython[0-9.]*\s+-c\b", "inline python"),
    (r"\bperl\s+-e\b", "inline perl"),
    (r"\bruby\s+-e\b", "inline ruby"),
    (r"\bnode\s+-e\b|\bnode\s+--eval\b", "inline node"),
    (r"\bphp\s+-r\b", "inline php"),
    (r"\bbash\s+-c\b|\bsh\s+-c\b|\bzsh\s+-c\b", "inline shell -c"),
    (r"\beval\b", "eval"),
    (r"\bbase64\s+-d\b[^\n|]*\|\s*(ba|z)?sh\b", "base64-decode piped to shell"),
    (r"\bxargs\b[^\n]*\b(rm|sh|bash|kill)\b", "xargs into a dangerous command"),
]

# Reading secrets / dumping the environment.
SECRET_READ = [
    (r"\b(cat|less|more|head|tail|grep|egrep|awk|sed|xxd|od|strings|cp|scp|rsync|nl|tac|dd)\b[^\n]*"
     r"(credentials\.local\.md|\.env(\.|\b)|id_rsa|id_ed25519|id_ecdsa|\.pem\b|\.key\b|authorized_keys|/\.ssh/|secrets?\.|\.pgpass)",
     "reading a secret/credential file"),
    (r"\b(env|printenv|set)\b\s*$|\bprintenv\b\s+\w", "dumping environment variables"),
]

# State-changing / destructive commands.
DENY = [
    (r"\brm\b", "file deletion"),
    (r"\bmv\s|\bcp\s", "file move/copy"),
    (r"\bsed\s+-i\b|\btee\b", "in-place file write"),
    (r">>?\s*(?!/dev/null\b|&\s*[0-9])\S", "output redirection to a file"),
    (r"\bsystemctl\b[^\n]*\b(restart|stop|start|enable|disable|reload|kill|mask|unmask)\b", "service state change"),
    (r"\bservice\s+\S+\s+(restart|stop|start|reload)\b", "service state change"),
    (r"\b(pkill|killall|kill)\b|\bfuser\s+-k\b", "process kill"),
    (r"\b(reboot|shutdown|poweroff|halt)\b|\binit\s+[06]\b", "host power state change"),
    (r"\bdocker\b[^\n]*\b(restart|stop|kill|rm|rmi|prune|start|pause|down|up)\b", "docker state change"),
    (r"\b(chmod|chown|chattr)\b", "permission/ownership change"),
    (r"\bgit\s+(push|reset|rebase|merge|commit|checkout|switch|clean|revert|cherry-pick|stash|branch\s+-[dD]|tag\s+-d)\b", "git write operation"),
    (r"\bcrontab\s+(-r|[^ -])", "crontab modification"),
    (r"\b(apt|apt-get|yum|dnf|pip|pip3|npm|yarn|bun|snap)\s+(install|remove|uninstall|update|upgrade|add)\b", "package install/change"),
    (r"\bmc\s+(rm|mv|rb|cp|put|mirror)\b", "minio object mutation"),
    (r"\b(dd|mkfs|fdisk|parted|wipefs)\b", "disk operation"),
    (r"\b(INSERT\s+INTO|UPDATE\s+[\w\".]+\s+SET|DELETE\s+FROM|DROP\s+(TABLE|DATABASE|INDEX|SCHEMA|ROLE)|TRUNCATE|ALTER\s+(TABLE|SYSTEM)|GRANT\s|REVOKE\s|CREATE\s+(TABLE|INDEX|ROLE|USER|DATABASE))\b", "SQL write/DDL"),
    (r"deploy-local\.sh|reclaim-obsolete|apply-migration|run-migration|run-backfill", "known mutating script"),
    (r"\b(curl|wget)\b[^|]*(-X\s*(POST|PUT|DELETE|PATCH)|--request\s*(POST|PUT|DELETE|PATCH)|--data|--post-data|(^|\s)-d(\s|=))", "HTTP write request"),
]

ALL = CODE_EXEC + SECRET_READ + DENY


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
                f"BLOCKED: this command is a {label}. The diagnosis agent is read-only and "
                "must not run state changes, read secrets, or wrap code execution. If a fix is "
                "needed, put it in \"approval_request\" for Hein to approve. Read-only diagnosis "
                "(status, SELECT queries, logs, health curls) is allowed."
            )
    sys.exit(0)


if __name__ == "__main__":
    main()
