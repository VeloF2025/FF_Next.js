# 🚨 URGENT: QFieldCloud Token Needed for OES Sync

## Current Situation
- **6,682 OES records** are ready in the database with valid coordinates
- **Project configured**: OES_Project_Progress (ID: ad3b1035-ddb3-42a3-8077-175f9400b38a)
- **Blocking issue**: QFieldCloud API token has expired
- **Jaun is waiting** for the OES data to appear on his map

## ⚠️ Immediate Action Required

### Option 1: Contact Jaun or Luke (FASTEST)
WhatsApp or call them immediately:
- "We need QFieldCloud login credentials or a new API token"
- "The OES sync is blocked - token expired"
- "Can you create a token in QFieldCloud admin?"

### Option 2: Manual Web Creation
If you have QFieldCloud credentials:

1. **Go to**: https://qfield.fibreflow.app
2. **Login** with your credentials
3. **Navigate to**: User Profile → API Tokens
4. **Create New Token**:
   - Name: `OES_Sync_2026`
   - Permissions: Read/Write
5. **Copy the token** (won't be shown again!)

### Option 3: Request Admin Access
If no one has credentials:
1. Check with the IT team who set up QFieldCloud
2. The admin panel is at: https://qfield.fibreflow.app/admin/
3. Default admin might be: `admin` / `admin` or `qfield` / `qfield`

## 📋 Once You Have the Token

Run this command immediately:
```bash
# Update the token (replace YOUR_TOKEN_HERE with actual token)
ssh -i ~/.ssh/vf_server_key louis@100.96.203.105 \
  'echo "QFIELD_API_TOKEN=YOUR_TOKEN_HERE" | sudo tee -a /opt/qfield-sync/config.env'

# Run the sync
ssh -i ~/.ssh/vf_server_key louis@100.96.203.105 \
  'cd /opt/qfield-sync && source venv/bin/activate && python3 sync_oes_to_qfield.py --force'
```

## 🔧 I've Prepared Everything

✅ Database has 6,682 OES records ready
✅ Project ID updated to: ad3b1035-ddb3-42a3-8077-175f9400b38a
✅ Sync scripts configured
✅ View `v_qfield_oes_activations` verified

**Only missing**: Valid API token

## 📱 Tell Jaun

Once sync completes:
1. Open QField app
2. Sync "OES_Project_Progress" project
3. OES activations layer should show all 6,682 points
4. Drop numbers will be visible as labels

## Alternative: Upload CSV Manually

If getting a token takes too long, I've created a CSV file we can upload manually:
```bash
# Generate CSV
python3 /home/louisdup/Agents/claude/VF/fibreflow-app/scripts/upload-oes-to-qfield.py

# This will create: oes_activations.csv
# Manually upload to QFieldCloud project via web interface
```

---

**Status as of**: January 20, 2026 09:01 AM
**Blocker**: QFieldCloud API token expired
**Next Step**: GET TOKEN from Jaun/Luke/Admin