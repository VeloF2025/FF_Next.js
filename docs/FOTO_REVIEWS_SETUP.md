# Foto Reviews System - Setup Guide

## Quick Start

Follow these steps to deploy the Foto Reviews Human-in-the-Loop system.

## Prerequisites

- FibreFlow application running (Next.js)
- 1Map antigravity system installed at `/home/louisdup/Agents/antigravity/`
- SQLite database at `/home/louisdup/Agents/antigravity/1map_data.db`
- DR Queue Worker running

## Step 1: Run Database Migration

The migration adds new columns to `dr_jobs` table and creates the `approval_history` table.

### Option A: Using sqlite3 command

```bash
cd /home/louisdup/Agents/antigravity
sqlite3 1map_data.db < migrations/add_approval_workflow.sql
```

### Option B: Using Python (if sqlite3 not installed)

```bash
cd /home/louisdup/Agents/antigravity

python3 << 'EOF'
import sqlite3

# Read migration SQL
with open('migrations/add_approval_workflow.sql', 'r') as f:
    migration_sql = f.read()

# Connect and execute
conn = sqlite3.connect('1map_data.db')
cursor = conn.cursor()

# Execute each statement (SQLite doesn't support multiple statements at once)
statements = migration_sql.split(';')
for statement in statements:
    statement = statement.strip()
    if statement and not statement.startswith('--'):
        try:
            cursor.execute(statement)
            print(f"✅ Executed: {statement[:50]}...")
        except Exception as e:
            print(f"❌ Error: {e}")

conn.commit()
conn.close()
print("\n✅ Migration completed!")
EOF
```

### Verify Migration

```bash
cd /home/louisdup/Agents/antigravity

python3 << 'EOF'
import sqlite3

conn = sqlite3.connect('1map_data.db')
cursor = conn.cursor()

# Check dr_jobs columns
cursor.execute("PRAGMA table_info(dr_jobs)")
columns = cursor.fetchall()
print("dr_jobs columns:")
for col in columns:
    print(f"  - {col[1]} ({col[2]})")

print("\n")

# Check if approval_history table exists
cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='approval_history'")
result = cursor.fetchone()
if result:
    print("✅ approval_history table exists")
    cursor.execute("PRAGMA table_info(approval_history)")
    columns = cursor.fetchall()
    for col in columns:
        print(f"  - {col[1]} ({col[2]})")
else:
    print("❌ approval_history table NOT found")

conn.close()
EOF
```

## Step 2: Restart DR Queue Worker

The worker needs to be restarted to pick up the new `set_approval_pending` method.

```bash
# If running as systemd service
sudo systemctl restart dr-queue-worker

# If running manually
cd /home/louisdup/Agents/antigravity
# Stop the current worker (Ctrl+C)
python3 dr_queue_worker.py
```

**Verify worker is running:**
```bash
# Check logs
tail -f /home/louisdup/Agents/antigravity/dr_queue_worker.log

# Should see:
# "📋 Job {job_id} awaiting human review approval"
```

## Step 3: Build and Deploy Frontend

### Local Development

```bash
cd /home/louisdup/VF/Apps/FF_React

# Build the application
npm run build

# Start on port 3005
PORT=3005 npm start
```

Visit: http://localhost:3005/foto-reviews

### VPS Deployment (Development)

```bash
# Deploy to dev.fibreflow.app
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 \
  "cd /var/www/fibreflow-dev && git pull && npm ci && npm run build && pm2 restart fibreflow-dev"
```

Visit: https://dev.fibreflow.app/foto-reviews

### VPS Deployment (Production)

**ONLY after testing on dev!**

```bash
# First, commit and push to master
git add .
git commit -m "feat: Add Foto Reviews Human-in-the-Loop system"
git push origin master

# Deploy to app.fibreflow.app
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 \
  "cd /var/www/fibreflow && git pull && npm ci && npm run build && pm2 restart fibreflow-prod"
```

Visit: https://app.fibreflow.app/foto-reviews

## Step 4: Test the System

### Test 1: Submit a DR for Review

```bash
# Create a test job (from antigravity directory)
cd /home/louisdup/Agents/antigravity

python3 << 'EOF'
from dr_queue_db import DRQueueDatabase

db = DRQueueDatabase()
job_id = db.create_job(
    dr_number="TEST_DR_12345",
    source="manual_test",
    priority="high",
    callback_url="http://example.com/webhook",
    metadata={"project": "Test Project"}
)

print(f"✅ Created test job: {job_id}")
print(f"Visit: https://app.fibreflow.app/foto-reviews")
EOF
```

### Test 2: Check Dashboard

1. Visit `/foto-reviews`
2. Should see test DR in pending reviews
3. Click on DR number
4. Review detail modal should open
5. Try each action:
   - Edit feedback
   - Approve
   - Reject

### Test 3: Verify Database Updates

```bash
cd /home/louisdup/Agents/antigravity

python3 << 'EOF'
import sqlite3

conn = sqlite3.connect('1map_data.db')
cursor = conn.cursor()

# Get test job status
cursor.execute("""
    SELECT id, dr_number, approval_status, original_feedback, reviewer_name
    FROM dr_jobs
    WHERE dr_number = 'TEST_DR_12345'
""")

job = cursor.fetchone()
if job:
    print(f"Job ID: {job[0]}")
    print(f"DR Number: {job[1]}")
    print(f"Approval Status: {job[2]}")
    print(f"Original Feedback: {job[3]}")
    print(f"Reviewer: {job[4]}")
else:
    print("❌ Test job not found")

# Check approval history
cursor.execute("""
    SELECT action, user_name, notes, timestamp
    FROM approval_history
    WHERE job_id IN (SELECT id FROM dr_jobs WHERE dr_number = 'TEST_DR_12345')
    ORDER BY timestamp DESC
""")

history = cursor.fetchall()
if history:
    print("\nApproval History:")
    for h in history:
        print(f"  - {h[0]} by {h[1]} at {h[3]}: {h[2]}")
else:
    print("\nNo approval history yet")

conn.close()
EOF
```

## Troubleshooting

### Issue: Migration fails with "duplicate column name"

**Solution:** Columns already exist. Check if migration was run before.

```bash
cd /home/louisdup/Agents/antigravity
sqlite3 1map_data.db "PRAGMA table_info(dr_jobs);" | grep approval_status
```

If it shows the column, migration is already done.

### Issue: Dashboard shows "No reviews found"

**Checks:**
1. Worker is running and processing jobs?
2. Jobs have `approval_status = 'pending_review'`?
3. API endpoint `/api/foto-reviews/pending` returns data?

```bash
# Check API manually
curl http://localhost:3005/api/foto-reviews/pending
```

### Issue: Images not loading

**Checks:**
1. Image path is correct in database?
2. File exists?
3. Image API endpoint working?

```bash
# Check if image exists
cd /home/louisdup/Agents/antigravity
ls -lh 1map_images/

# Test image endpoint (replace {path} with actual path)
curl http://localhost:3005/api/foto-reviews/image?path=1map_images/test.jpg
```

### Issue: "Method not found: set_approval_pending"

**Solution:** Worker needs to be restarted to pick up new database method.

```bash
sudo systemctl restart dr-queue-worker
# OR
pkill -f dr_queue_worker.py
cd /home/louisdup/Agents/antigravity
python3 dr_queue_worker.py
```

## Rollback (If Needed)

If you need to rollback the changes:

```bash
cd /home/louisdup/Agents/antigravity

python3 << 'EOF'
import sqlite3

conn = sqlite3.connect('1map_data.db')
cursor = conn.cursor()

# Drop new columns (SQLite doesn't support DROP COLUMN directly)
# Need to recreate table without these columns

print("⚠️  Rollback requires manual intervention")
print("Backup database first:")
print("  cp 1map_data.db 1map_data.db.backup")
print("\nThen manually recreate dr_jobs table without approval columns")

conn.close()
EOF
```

**Note:** SQLite doesn't support `DROP COLUMN`. If rollback is needed, create a backup first.

## Next Steps

After successful setup:

1. **Monitor first real DR** - Watch a real DR go through the workflow
2. **Train Zander** - Show him how to use the dashboard
3. **Set up notifications** - Configure email/Slack alerts for pending reviews (future enhancement)
4. **Analytics** - Track approval rates and feedback quality

## Support

- **Documentation**: `/home/louisdup/VF/Apps/FF_React/docs/FOTO_REVIEWS_SYSTEM.md`
- **Logs**:
  - Worker: `/home/louisdup/Agents/antigravity/dr_queue_worker.log`
  - Next.js: Browser console
- **Database**: `/home/louisdup/Agents/antigravity/1map_data.db`
