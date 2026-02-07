#!/bin/bash

# Create QFieldCloud admin user for OES sync
# This runs Django management commands inside the container

echo "=================================================="
echo "Creating QFieldCloud Admin User for OES Sync"
echo "=================================================="
echo ""

SERVER="100.96.203.105"
SSH_USER="louis"
SSH_PASS="${VELO_SSH_PASSWORD:?ERROR: VELO_SSH_PASSWORD not set}"

echo "1. Creating admin user in QFieldCloud Django..."

# Python script to create admin
cat << 'EOF' > /tmp/create_admin.py
import os
import sys
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'qfieldcloud.settings')

import django
django.setup()

from django.contrib.auth import get_user_model
from rest_framework.authtoken.models import Token

User = get_user_model()

# Create admin user
username = 'oes_admin'
email = 'oes@velocityfibre.co.za'
password = 'OES@QField2026'

try:
    user, created = User.objects.get_or_create(
        username=username,
        defaults={
            'email': email,
            'is_staff': True,
            'is_superuser': True,
            'is_active': True
        }
    )

    if created:
        user.set_password(password)
        user.save()
        print(f"Created admin user: {username}")
    else:
        user.set_password(password)
        user.save()
        print(f"Updated password for: {username}")

    # Create API token
    token, token_created = Token.objects.get_or_create(user=user)

    print(f"\n{'='*60}")
    print("QFIELDCLOUD ADMIN CREATED SUCCESSFULLY")
    print('='*60)
    print(f"Username: {username}")
    print(f"Password: {password}")
    print(f"Email: {email}")
    print(f"API Token: {token.key}")
    print('='*60)

    # Save to file
    with open('/tmp/qfield_token.txt', 'w') as f:
        f.write(f"{token.key}\n")

except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
EOF

# Copy script to server
scp -i ~/.ssh/vf_server_key /tmp/create_admin.py $SSH_USER@$SERVER:/tmp/

# Execute in container
ssh -i ~/.ssh/vf_server_key $SSH_USER@$SERVER "echo '$SSH_PASS' | sudo -S docker cp /tmp/create_admin.py qfieldcloud-app-1:/tmp/ && echo '$SSH_PASS' | sudo -S docker exec qfieldcloud-app-1 python /tmp/create_admin.py"

echo ""
echo "2. Getting the API token..."
ssh -i ~/.ssh/vf_server_key $SSH_USER@$SERVER "echo '$SSH_PASS' | sudo -S docker exec qfieldcloud-app-1 cat /tmp/qfield_token.txt 2>/dev/null" > /tmp/oes_token.txt

TOKEN=$(cat /tmp/oes_token.txt)

if [ -n "$TOKEN" ]; then
    echo ""
    echo "=================================================="
    echo "API TOKEN FOR OES SYNC:"
    echo "$TOKEN"
    echo "=================================================="
    echo ""
    echo "Token saved to: /tmp/oes_token.txt"
    echo ""
    echo "3. Next steps:"
    echo "   - I'll update the sync configuration with this token"
    echo "   - Run the sync to upload OES data"
    echo "   - Verify data appears in QFieldCloud"
else
    echo "Failed to create token. Check errors above."
fi