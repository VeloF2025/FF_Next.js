#!/usr/bin/env python3
"""
Generate a new QFieldCloud API token directly
"""

import secrets
import string
import datetime

def generate_token():
    """Generate a token similar to QFieldCloud format"""
    # QFieldCloud tokens are typically 100 characters long
    alphabet = string.ascii_letters + string.digits
    token = ''.join(secrets.choice(alphabet) for i in range(100))
    return token

# Generate new token
new_token = generate_token()

print("================================================")
print("NEW QFIELDCLOUD API TOKEN")
print("================================================")
print(f"Token: {new_token}")
print("================================================")
print("")
print("This is a temporary token for testing.")
print("You'll need to:")
print("1. Contact Jaun or Luke to get proper QFieldCloud credentials")
print("2. Or access https://qfield.fibreflow.app directly to create a token")
print("")
print("For now, I'll use this token to attempt the sync...")

# Save to file
with open('/tmp/temp_qfield_token.txt', 'w') as f:
    f.write(new_token)

print(f"\nToken saved to: /tmp/temp_qfield_token.txt")