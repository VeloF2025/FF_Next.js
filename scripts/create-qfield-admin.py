#!/usr/bin/env python3
"""
Create QFieldCloud admin user and API token
"""

import os
import sys

# Django setup
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'qfieldcloud.settings')

import django
django.setup()

from django.contrib.auth import get_user_model
from rest_framework.authtoken.models import Token

User = get_user_model()

def create_admin_and_token():
    """Create admin user and API token for OES sync"""

    # Admin user details
    username = 'oes_admin'
    email = 'admin@velocityfibre.co.za'
    password = 'VeloOES@2026'

    try:
        # Check if user exists
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
            print(f"✅ Created admin user: {username}")
        else:
            print(f"ℹ️ Admin user already exists: {username}")
            # Update password just in case
            user.set_password(password)
            user.save()
            print(f"✅ Updated password for: {username}")

        # Create or get API token
        token, token_created = Token.objects.get_or_create(user=user)

        if token_created:
            print(f"✅ Created new API token")
        else:
            print(f"ℹ️ Using existing API token")

        print("\n" + "="*60)
        print("QFIELDCLOUD CREDENTIALS")
        print("="*60)
        print(f"URL: https://qfield.fibreflow.app")
        print(f"Admin URL: https://qfield.fibreflow.app/admin/")
        print(f"Username: {username}")
        print(f"Password: {password}")
        print(f"API Token: {token.key}")
        print("="*60)

        # Save token to file for easy access
        with open('/tmp/qfield_token.txt', 'w') as f:
            f.write(f"# QFieldCloud API Token\n")
            f.write(f"QFIELD_API_TOKEN={token.key}\n")
            f.write(f"# Username: {username}\n")
            f.write(f"# Password: {password}\n")

        print(f"\n✅ Token saved to: /tmp/qfield_token.txt")

        return token.key

    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return None

if __name__ == "__main__":
    token = create_admin_and_token()
    if token:
        print(f"\n✅ SUCCESS! Use this token for OES sync:")
        print(f"   {token}")
    else:
        print("\n❌ FAILED to create token")
        sys.exit(1)