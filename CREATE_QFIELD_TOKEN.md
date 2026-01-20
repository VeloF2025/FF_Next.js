# Creating QFieldCloud API Token for OES Sync

## Quick Steps to Create Token

### Option 1: Via Web Browser (Recommended)

1. **Login to QFieldCloud**
   - URL: https://qfield.fibreflow.app
   - Username: (admin or your account)
   - Password: (your password)

2. **Navigate to User Settings**
   - Click on your username (top right)
   - Select "Settings" or "Profile"

3. **Create API Token**
   - Find "API Tokens" or "Access Tokens" section
   - Click "Create New Token" or "Generate Token"
   - Name: "OES_Sync_Token_2026"
   - Permissions: Read/Write access to projects
   - Copy the token immediately (it won't be shown again!)

4. **Save Token**
   - The token will look like: `YmFcDD4fNHu5P0j2i2xCn5AVt7JjmSnJOVHntObwCHHlE35nAE0C9LuNF9N0coTk5gNLcUsvYRUb0GH0ZJT2bGcyej5Y3apeVsPS`
   - Save it securely

### Option 2: Via API (If you have existing credentials)

```bash
# Get auth token first
curl -X POST https://qfield.fibreflow.app/api/v1/auth/login/ \
  -H "Content-Type: application/json" \
  -d '{
    "username": "YOUR_USERNAME",
    "password": "YOUR_PASSWORD"
  }'

# Use the returned token to create API token
curl -X POST https://qfield.fibreflow.app/api/v1/auth/tokens/ \
  -H "Authorization: Token YOUR_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "OES_Sync_Token_2026",
    "expires": null
  }'
```

## Once You Have the Token

Provide it to me and I'll:
1. Update the sync configuration
2. Run the sync to upload all 6,682 OES records
3. Verify Jaun can see the data in OES_Project_Progress

## Need Admin Access?

If you don't have QFieldCloud credentials, we need to:
1. Check with the QFieldCloud admin (possibly Luke or system admin)
2. Or create a new admin account via Django admin

## Server Admin Access (If needed)

The QFieldCloud server runs on VF Server port 8082. Admin panel might be at:
- https://qfield.fibreflow.app/admin/
- Or we can create admin via Django command line

---

**Current Status:**
- Project: OES_Project_Progress (ID: ad3b1035-ddb3-42a3-8077-175f9400b38a)
- Data Ready: 6,682 OES records with coordinates
- Blocking Issue: API token expired
- Next Step: Get new token and complete sync