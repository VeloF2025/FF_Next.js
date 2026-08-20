#!/usr/bin/env bash
# Resolve CRON_SECRET for a cron script, without ever holding it in a tracked file.
#
# This exists because two cron scripts used to assign the live secret as a literal on
# line 10 / line 15. That value is in the repository's history and must be treated as
# compromised; rotating it is worthless if the next script commits the new one too.
#
# Resolution order: an already-exported CRON_SECRET wins (lets an operator run the
# script by hand without touching env files), then .env.local, then .env. The two
# deploy dirs disagree about which file holds which key, so both are tried.
#
# UNREADABLE is reported separately from ABSENT: if an ACL change makes an env file
# unreadable to the cron user, "not found" would send someone hunting for a missing
# key that is sitting right there.

# Usage: CRON_SECRET="$(resolve_cron_secret "$PROJECT_DIR" "$LOG_PREFIX")" || exit 1
resolve_cron_secret() {
  local project_dir="$1" log_prefix="${2:-[cron]}" envfile val

  if [ -n "${CRON_SECRET:-}" ]; then
    printf '%s' "$CRON_SECRET"
    return 0
  fi

  for envfile in "$project_dir/.env.local" "$project_dir/.env"; do
    [ -e "$envfile" ] || continue
    if [ ! -r "$envfile" ]; then
      echo "$log_prefix WARNING: $envfile exists but is not readable by $(id -un)" >&2
      continue
    fi
    # Strip only WRAPPING quotes — `tr -d '"'` would mangle a value containing a
    # literal quote. `cut -f2-` keeps any '=' inside the value.
    val=$(grep -m1 '^CRON_SECRET=' "$envfile" | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/' || true)
    if [ -n "$val" ]; then
      printf '%s' "$val"
      return 0
    fi
  done

  echo "$log_prefix ERROR: CRON_SECRET not set (checked environment, $project_dir/.env.local, $project_dir/.env)" >&2
  return 1
}
