# QFieldCloud Credentials (From Jaun - Jan 20, 2026)

## Admin Account
- **Username**: Adminuser
- **Password**: admin123
- **Source**: Jaun De Wit (WhatsApp 10:34 AM)

## Quick Test Command
```bash
curl -X POST "https://qfield.fibreflow.app/api/v1/auth/login/" \
  -H "Content-Type: application/json" \
  -d '{"username":"Adminuser","password":"admin123"}' \
  --insecure -s
```

## To Run OES Sync
```bash
# Use the quick sync script
./scripts/quick-oes-sync.sh
# When prompted, paste the token from login response
```