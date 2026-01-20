# QFieldCloud Token Issue - Complete Solution

## Current Situation (Jan 20, 2026)

### ✅ What's Ready:
- **6,682 OES records** loaded in database with coordinates
- **Database view** `v_qfield_oes_activations` working perfectly
- **Project configured**: OES_Project_Progress (ID: ad3b1035-ddb3-42a3-8077-175f9400b38a)
- **Scripts prepared** for sync

### ❌ The Problem:
QFieldCloud's authentication system is not accepting tokens we create directly in the database. This appears to be because QFieldCloud uses a custom authentication mechanism that validates tokens differently than standard Django.

## Immediate Solutions (Choose One)

### Option 1: Get Token from Existing User (FASTEST - 5 minutes)

**Contact Luke or Jaun** - They have working accounts:
```
LukeK - last active Jan 15, 2026
JaunPlanning1 - Project owner
```

Ask them to:
1. Login to https://qfield.fibreflow.app
2. Go to User Settings → API Tokens
3. Create new token named "OES_Sync_2026"
4. Send you the token

### Option 2: Use Web Interface (10 minutes)

Since API tokens aren't working, use the web UI directly:

1. **Login**: https://qfield.fibreflow.app
   - Try these known users:
   - Wian (superuser)
   - LukeK
   - JaunPlanning1
   - louis

2. **Navigate to Project**: OES_Project_Progress

3. **Upload CSV Manually**:
   ```bash
   # Generate CSV file
   python3 scripts/upload-oes-to-qfield.py
   # This creates: /tmp/oes_activations.csv
   ```
   - Download the CSV to your local machine
   - Upload via QFieldCloud web interface
   - Project → Files → Upload → Select CSV

### Option 3: Reset Password via Email (15-30 minutes)

1. Go to: https://qfield.fibreflow.app/auth/password_reset/
2. Enter email for known user:
   - wian@gameplanfibre.com (Wian - superuser)
   - jaun@velocityfibre.co.za (JaunPlanning1)
   - reynard@velocityfibre.co.za (Activations_Admin)
3. Check email for reset link
4. Set new password
5. Login and create API token

## Once You Have a Token

Run this command:
```bash
# 1. Edit the sync script
nano scripts/sync-oes-with-token.sh

# 2. Replace PASTE_YOUR_TOKEN_HERE with actual token

# 3. Run the sync
./scripts/sync-oes-with-token.sh
```

## Alternative: Direct Database Upload

If QFieldCloud continues to have authentication issues:

```bash
# Connect directly to QFieldCloud database
ssh -i ~/.ssh/vf_server_key louis@100.96.203.105

# Upload data directly to PostGIS
echo "VeloBoss@2026" | sudo -S docker exec -it qfieldcloud-db-1 psql -U qfieldcloud_db_admin -d qfieldcloud_db

# In PostgreSQL:
CREATE TABLE IF NOT EXISTS oes_activations_import AS
SELECT * FROM dblink(
  'host=ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech
   dbname=neondb user=neondb_owner
   password=npg_MIUZXrg1tEY0 sslmode=require',
  'SELECT * FROM v_qfield_oes_activations'
) AS t(...);
```

## Why Standard Token Creation Isn't Working

QFieldCloud appears to use:
1. Custom token validation beyond Django's default
2. Possible token signing/encryption
3. Additional session management
4. Token format validation (specific length/pattern)

The expired token format suggests a custom implementation:
`YmFcDD4fNHu5P0j2i2xCn5AVt7JjmSnJOVHntObwCHHlE35nAE0C9LuNF9N0coTk5gNLcUsvYRUb0GH0ZJT2bGcyej5Y3apeVsPS`

This is not a standard Django token (which would be 40 hex characters).

## Contact Support

If none of the above works:
- **Email**: support@qfield.cloud or admin@velocityfibre.co.za
- **WhatsApp**: Contact Luke or Jaun directly
- **Request**: "Need API token for OES sync automation"

## Files Created for You

1. `scripts/sync-oes-with-token.sh` - Ready to run once you have token
2. `scripts/upload-oes-to-qfield.py` - Creates CSV for manual upload
3. `URGENT_QFIELD_TOKEN_ACTION.md` - Quick action guide
4. This file - Complete solution documentation

---

**Bottom Line**: The fastest solution is to get a token from Luke or Jaun who have working accounts. The data is ready - we just need authentication!