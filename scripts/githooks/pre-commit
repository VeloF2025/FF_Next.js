#!/bin/bash
# =============================================================================
# Pre-Commit Hook: Secret Scanner
# =============================================================================
# Blocks commits that add credential-like content (passwords, tokens, keys).
# Delegates to scripts/secret-scan.sh in --staged mode.
#
# INSTALL: bash scripts/install-hooks.sh
# Bypass (emergency only, never for real secrets): git commit --no-verify
# =============================================================================

set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel)
exec bash "$REPO_ROOT/scripts/secret-scan.sh" --staged
