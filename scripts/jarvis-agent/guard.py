#!/usr/bin/env python3
"""PreToolUse guard hook for the Jarvis agent.

Claude Code runs this before every Bash tool call. It denies commands that
change system state, forcing the agent down the "contact Hein for approval"
path. This is a defense-in-depth backstop — the agent's system prompt is the
primary control, and Write/Edit are already denied at the permissions layer.

Deny = print a PreToolUse deny decision and exit 0.
Allow = exit 0 with no output.
"""
import json
import re
import sys

# Patterns that indicate a state-changing / destructive command. Applied to the
# whole command string, including anything inside `ssh host "..."` remote parts.
DENY = [
    (r"\brm\s+-|\brm\s+/|\brmdir\b|\bunlink\b|\bshred\b", "file deletion"),
    (r"\bmv\s|\bcp\s", "file move/copy"),
    (r"\bsed\s+-i\b|\btee\b", "in-place file write"),
    (r"(^|[^0-9>])>\s*(?!/dev/null)\S|>>\s*(?!/dev/null)\S", "output redirection to a file"),
    (r"\bsystemctl\s+(restart|stop|start|enable|disable|reload|kill|mask|unmask)\b", "service state change"),
    (r"\bservice\s+\S+\s+(restart|stop|start|reload)\b", "service state change"),
    (r"\b(pkill|killall|kill)\b|\bfuser\s+-k\b", "process kill"),
    (r"\b(reboot|shutdown|poweroff|halt|init\s+[06])\b", "host power state change"),
    (r"\bdocker(\s+compose)?\s+(restart|stop|kill|rm|rmi|prune|start|pause|down|up)\b", "docker state change"),
    (r"\bdocker-compose\s+(down|up|restart|stop|kill|rm)\b", "docker-compose state change"),
    (r"\b(chmod|chown|chattr)\b", "permission/ownership change"),
    (r"\bgit\s+(push|reset|rebase|merge|commit|checkout|clean|revert|cherry-pick|stash\s+drop|branch\s+-[dD]|tag\s+-d)\b", "git write operation"),
    (r"\bcrontab\s+(-r|[^ -])", "crontab modification"),
    (r"\b(apt|apt-get|yum|dnf|pip|pip3|npm|yarn|bun)\s+(install|remove|uninstall|update|upgrade|add)\b", "package install/change"),
    (r"\bmc\s+(rm|mv|rb|cp|put|mirror)\b", "minio object mutation"),
    (r"\b(dd|mkfs|fdisk|parted)\b", "disk operation"),
    (r"\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|DROP\s+(TABLE|DATABASE|INDEX|SCHEMA|ROLE)|TRUNCATE|ALTER\s+(TABLE|SYSTEM)|GRANT\s|REVOKE\s|CREATE\s+(TABLE|INDEX|ROLE|USER|DATABASE))\b", "SQL write/DDL"),
    (r"deploy-local\.sh|reclaim-obsolete|apply-migration|run-migration|run-backfill", "known mutating script"),
    (r"curl\b[^|]*(-X\s*(POST|PUT|DELETE|PATCH)|--request\s*(POST|PUT|DELETE|PATCH)|(^|\s)(-d|--data))", "HTTP write request"),
]


def main() -> None:
    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)  # fail open on malformed input; other layers still guard

    if data.get("tool_name") != "Bash":
        sys.exit(0)
    cmd = (data.get("tool_input") or {}).get("command", "")

    for pattern, label in DENY:
        if re.search(pattern, cmd, re.IGNORECASE):
            reason = (
                f"BLOCKED: this command performs a {label}, which changes system state. "
                "Jarvis must not run state-changing actions directly. Instead, set "
                "\"approval_request\" in your final JSON with the proposed command so Hein is "
                "asked to approve on WhatsApp. Read-only diagnosis is allowed."
            )
            print(json.dumps({
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": reason,
                }
            }))
            sys.exit(0)
    sys.exit(0)


if __name__ == "__main__":
    main()
