#!/bin/bash
# =============================================================================
# deploy-local.sh — Fresh Deployment Control Launcher
# =============================================================================
# Fetches and verifies the current origin/master deployment orchestrator before
# any deploy logic runs. The caller checkout may remain dirty/frozen.
# =============================================================================

set -euo pipefail

# Exported Bash functions take precedence over PATH. Remove inherited functions
# before resolving any deployment-control command.
while IFS= read -r inherited_function; do
  unset -f -- "$inherited_function"
done < <(builtin compgen -A function)

export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
unset GIT_DIR GIT_WORK_TREE GIT_OBJECT_DIRECTORY
unset GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_REPLACE_REF_BASE
unset GIT_COMMON_DIR GIT_NAMESPACE GIT_TEMPLATE_DIR GIT_EXEC_PATH
unset GIT_SSH GIT_SSH_COMMAND GIT_SSH_VARIANT GIT_PROXY_COMMAND
unset GIT_ASKPASS SSH_ASKPASS
unset GIT_SSL_NO_VERIFY GIT_SSL_CAINFO GIT_SSL_CAPATH
unset CURL_CA_BUNDLE SSL_CERT_FILE SSL_CERT_DIR
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY
unset http_proxy https_proxy all_proxy no_proxy
unset GIT_CONFIG_COUNT GIT_CONFIG_PARAMETERS GIT_CONFIG_GLOBAL
unset GIT_CONFIG_SYSTEM GIT_CONFIG_NOSYSTEM
unset XDG_CONFIG_HOME GH_CONFIG_DIR
for git_config_var in ${!GIT_CONFIG_KEY_@} ${!GIT_CONFIG_VALUE_@}; do
  unset "$git_config_var"
done
export GIT_NO_REPLACE_OBJECTS=1
export GIT_EXEC_PATH=$(/usr/bin/git --exec-path)
export GIT_TERMINAL_PROMPT=0

trusted_home=$(
  /usr/bin/getent passwd "$(/usr/bin/id -u)" | /usr/bin/cut -d: -f6
)
if [[ -z "$trusted_home" || ! -d "$trusted_home" ]]; then
  echo "ERROR: cannot resolve the invoking account's trusted home" >&2
  exit 1
fi
export GH_CONFIG_DIR="$trusted_home/.config/gh"
# Keep bootstrap resolution on system binaries while retaining the invoking
# account's installed deployment tools (notably sentry-cli) for the trusted body.
export PATH="$PATH:$trusted_home/.local/bin"

source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(git -C "$source_dir/.." rev-parse --show-toplevel 2>/dev/null) || {
  echo "ERROR: deploy launcher is not inside a Git checkout" >&2
  exit 1
}
origin=$(git -C "$repo_root" config --local --get remote.origin.url)

if [[ -n "${XDG_CACHE_HOME:-}" ]]; then
  control_dir="$XDG_CACHE_HOME/fibreflow-deploy-control"
elif [[ -n "${HOME:-}" ]]; then
  control_dir="$HOME/.cache/fibreflow-deploy-control"
else
  control_dir="/tmp/fibreflow-deploy-control-${UID}"
fi
umask 077
mkdir -p "$control_dir"
if [[ -L "$control_dir" || ! -d "$control_dir" ]]; then
  echo "ERROR: deploy control cache is not a regular directory" >&2
  exit 1
fi
chmod 700 "$control_dir"
lock_path="$control_dir/bootstrap.lock"
if [[ -e "$lock_path" && ( -L "$lock_path" || ! -f "$lock_path" ) ]]; then
  echo "ERROR: deploy control lock must be a regular file" >&2
  exit 1
fi
: >> "$lock_path"
if [[ -L "$lock_path" || ! -f "$lock_path" ]]; then
  echo "ERROR: deploy control lock must be a regular file" >&2
  exit 1
fi
exec 8>>"$lock_path"
flock -x 8

control_git=$(mktemp -d "$control_dir/.repo.XXXXXX")
template_dir=$(mktemp -d "$control_dir/.template.XXXXXX")
sanitized_global=$(mktemp "$control_dir/.gitconfig.XXXXXX")
temp_script=""
cleanup() {
  if [[ -n "$temp_script" ]]; then
    rm -f -- "$temp_script"
  fi
  if [[ -n "$control_git" ]]; then
    rm -rf -- "$control_git"
  fi
  if [[ -n "$sanitized_global" ]]; then
    rm -f -- "$sanitized_global"
  fi
  if [[ -n "$template_dir" ]]; then
    rmdir -- "$template_dir"
  fi
}
trap cleanup EXIT

# Preserve only the GitHub credential helpers from the invoking account's
# canonical config files. Caller-selected HOME/XDG paths, includes, URL
# rewrites, and command-scope config stay outside the trust boundary.
for credential_config in \
  "$trusted_home/.gitconfig" \
  "$trusted_home/.config/git/config"
do
  [[ -f "$credential_config" && ! -L "$credential_config" ]] || continue
  while IFS= read -r credential_helper; do
    git config --file "$sanitized_global" --add \
      credential.https://github.com.helper "$credential_helper"
  done < <(
    git config --no-includes --file "$credential_config" \
      --get-all credential.https://github.com.helper || true
  )
done
export GIT_CONFIG_GLOBAL="$sanitized_global"
export GIT_CONFIG_NOSYSTEM=1

git init --bare --quiet --template="$template_dir" "$control_git"

# --filter=blob:none: this repo exists to read exactly one file —
# scripts/deploy-local-main.sh, ~31 KB. Without the filter the fetch pulls every
# blob in master's tree, several hundred MB of a 1.57 GiB repository, all but one
# of which is discarded when $control_git is deleted at the end of the run.
#
# On a healthy link that waste is invisible. On 2026-08-19 it stopped deploys
# entirely: three consecutive runs died mid-transfer ("early EOF", "curl 92
# HTTP/2 stream CANCEL", "curl 18 transfer closed") after 40, 7 and 24 minutes.
# Forcing HTTP/1.1 changed the error and nothing else — the transfer was simply
# too large for the link to hold. The same fetch with this filter completed in
# 12 seconds.
#
# The trust boundary is unchanged: same remote, same ref, same commit, and the
# `git show` below still materialises the identical blob (verified byte-for-byte
# against origin/master, sha256 a2a3e5e0…). A filtered clone records the origin
# as a promisor, so that show lazily fetches the one blob it needs.
# The filter is an optimisation, and it does not hold for every origin shape:
# Git refuses to register a remote whose name begins with '/' as a promisor, so
# a path-style origin that advertises filter support fails the fetch outright
# ("missing blob object"). A remote that does not advertise the capability is
# fine — it silently sends everything. Try the cheap fetch, fall back to the
# original one, and only give up if both fail.
if ! git --git-dir="$control_git" fetch --quiet --depth=1 \
  --filter=blob:none "$origin" master 2>/dev/null; then
  if ! git --git-dir="$control_git" fetch --quiet --depth=1 "$origin" master; then
    echo "ERROR: cannot refresh deploy control from origin/master; refusing stale orchestration" >&2
    exit 1
  fi
fi

control_sha=$(git --git-dir="$control_git" rev-parse FETCH_HEAD)
expected_blob=$(git --git-dir="$control_git" \
  rev-parse "${control_sha}:scripts/deploy-local-main.sh") || {
  echo "ERROR: origin/master does not contain scripts/deploy-local-main.sh" >&2
  exit 1
}
control_script="$control_dir/deploy-local-main-${control_sha}.sh"
temp_script=$(mktemp "$control_dir/.deploy-local-main-${control_sha}.XXXXXX")

# The filtered fetch above leaves this blob on the server; `show` pulls it back
# through the promisor. That works for the https origin every real deploy uses,
# and was verified against it. It does NOT work for a path-style origin — Git
# refuses to register a remote whose name begins with '/' as a promisor, and the
# lazy fetch then fails with "missing blob object". A remote that does not
# advertise filter support is fine either way: it silently sends everything, so
# the blob is already local.
#
# Rather than depend on the origin's shape, fall back to a full fetch of the
# same commit. The SHA is re-checked because master may have moved between the
# two fetches, and materialising a different commit than the one already
# verified is exactly the stale orchestration this file refuses to run.
if ! git --git-dir="$control_git" \
  show "${control_sha}:scripts/deploy-local-main.sh" > "$temp_script" 2>/dev/null; then
  if ! git --git-dir="$control_git" fetch --quiet --depth=1 "$origin" master; then
    rm -f -- "$temp_script"
    echo "ERROR: cannot materialize deployment control from origin/master" >&2
    exit 1
  fi
  refetched_sha=$(git --git-dir="$control_git" rev-parse FETCH_HEAD)
  if [[ "$refetched_sha" != "$control_sha" ]]; then
    rm -f -- "$temp_script"
    echo "ERROR: origin/master moved during deploy control refresh; refusing" >&2
    exit 1
  fi
  if ! git --git-dir="$control_git" \
    show "${control_sha}:scripts/deploy-local-main.sh" > "$temp_script"; then
    rm -f -- "$temp_script"
    echo "ERROR: cannot materialize deployment control from origin/master" >&2
    exit 1
  fi
fi
actual_blob=$(git hash-object "$temp_script")
if [[ "$actual_blob" != "$expected_blob" ]]; then
  rm -f -- "$temp_script"
  echo "ERROR: fetched deployment control failed Git blob verification" >&2
  exit 1
fi
if ! bash -n "$temp_script"; then
  rm -f -- "$temp_script"
  echo "ERROR: fetched deployment control has invalid shell syntax" >&2
  exit 1
fi

chmod 700 "$temp_script"
mv -fT -- "$temp_script" "$control_script"
temp_script=""
if [[ -L "$control_script" || ! -f "$control_script" ]]; then
  echo "ERROR: materialized deployment control is not a regular file" >&2
  exit 1
fi
actual_blob=$(git hash-object "$control_script")
if [[ "$actual_blob" != "$expected_blob" ]]; then
  echo "ERROR: materialized deployment control failed final verification" >&2
  exit 1
fi

echo "Deploy control: ${control_sha:0:12} (origin/master)"
rm -rf -- "$control_git"
control_git=""
rm -f -- "$sanitized_global"
sanitized_global=""
rmdir -- "$template_dir"
template_dir=""
trap - EXIT
flock -u 8
exec 8>&-
exec bash "$control_script" "$@"
