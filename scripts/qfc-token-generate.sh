#!/usr/bin/env bash
# Generate a new QFieldCloud API token via Django shell.
# Runs locally on Velocity (requires docker access).
#
# Usage:
#   bash scripts/qfc-token-generate.sh [username]
#   bash scripts/qfc-token-generate.sh admin
#
# Output: prints just the token string (for piping/capture)

set -euo pipefail

USERNAME="${1:-admin}"

TOKEN=$(docker exec qfieldcloud-app-1 python manage.py shell -c "
from django.contrib.auth import get_user_model
from rest_framework.authtoken.models import Token

User = get_user_model()
try:
    user = User.objects.get(username='${USERNAME}')
except User.DoesNotExist:
    print('ERROR: user ${USERNAME} not found')
    exit(1)

# Delete old token and create fresh one
Token.objects.filter(user=user).delete()
token = Token.objects.create(user=user)
print(token.key)
" 2>/dev/null)

if [[ "$TOKEN" == ERROR* ]]; then
    echo "$TOKEN" >&2
    exit 1
fi

echo "$TOKEN"
