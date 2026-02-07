# WA Monitor Refactoring Design
**Version:** 2.0
**Date:** November 9, 2025
**Status:** Design Phase

## Goal
Transform WA Monitor from a 4-hour project addition process to a 5-minute process through:
- Prod/Dev environment separation
- Config-driven architecture
- Modular code structure
- Centralized configuration

## Design Decisions

### User Choice: Option 2 + Config-Driven
**Approach:**
- Separate prod/dev VPS services
- YAML configuration files
- Environment variable driven
- No code changes to add projects

## New Architecture

### 1. Directory Structure
```
/opt/wa-monitor/
├── prod/                           # Production environment
│   ├── config/
│   │   └── projects.yaml          # Project definitions
│   ├── modules/
│   │   ├── config.py              # Config loader
│   │   ├── database.py            # Database operations
│   │   ├── monitor.py             # Drop monitoring logic
│   │   └── resubmission.py        # Resubmission handler
│   ├── main.py                    # Entry point
│   ├── .env                       # Environment variables
│   └── logs/
│       └── wa-monitor-prod.log
│
├── dev/                            # Development environment
│   ├── config/
│   │   └── projects.yaml          # Dev project definitions
│   ├── modules/                   # Same modules as prod
│   │   ├── config.py
│   │   ├── database.py
│   │   ├── monitor.py
│   │   └── resubmission.py
│   ├── main.py
│   ├── .env                       # Dev environment variables
│   └── logs/
│       └── wa-monitor-dev.log
│
└── shared/
    ├── whatsapp-bridge/           # Shared WhatsApp bridge
    │   └── store/
    │       └── messages.db        # SQLite message store
    └── utils/
        └── validation.py          # Shared validation
```

### 2. Systemd Services
**Two separate services for prod/dev:**

**`/etc/systemd/system/wa-monitor-prod.service`**
```ini
[Unit]
Description=WhatsApp Drop Monitor - Production
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/wa-monitor/prod
Environment="ENV=production"
EnvironmentFile=/opt/wa-monitor/prod/.env
ExecStart=/usr/bin/python3 main.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

**`/etc/systemd/system/wa-monitor-dev.service`**
```ini
[Unit]
Description=WhatsApp Drop Monitor - Development
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/wa-monitor/dev
Environment="ENV=development"
EnvironmentFile=/opt/wa-monitor/dev/.env
ExecStart=/usr/bin/python3 main.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

### 3. Configuration Files

#### Production: `/opt/wa-monitor/prod/config/projects.yaml`
```yaml
# WhatsApp Monitor - Production Projects
# Last updated: 2025-11-09

projects:
  - name: Lawley
    enabled: true
    group_jid: "120363418298130331@g.us"
    description: "Lawley Activation 3 group"

  - name: Velo Test
    enabled: true
    group_jid: "120363421664266245@g.us"
    description: "Velo Test group"

  - name: Mohadin
    enabled: true
    group_jid: "120363421532174586@g.us"
    description: "Mohadin Activations group"

  - name: Mamelodi
    enabled: true
    group_jid: "120363408849234743@g.us"
    description: "Mamelodi POP1 Activations group"
```

#### Development: `/opt/wa-monitor/dev/config/projects.yaml`
```yaml
# WhatsApp Monitor - Development Projects
# Test projects only

projects:
  - name: Velo Test
    enabled: true
    group_jid: "120363421664266245@g.us"
    description: "Velo Test group (dev testing)"
```

#### Environment Variables: `/opt/wa-monitor/prod/.env`
```bash
# Production Environment

# Database
NEON_DATABASE_URL=postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require&channel_binding=require

# WhatsApp
WHATSAPP_DB_PATH=/opt/wa-monitor/shared/whatsapp-bridge/store/messages.db

# Monitoring
SCAN_INTERVAL=15
LOG_LEVEL=INFO
LOG_FILE=/opt/wa-monitor/prod/logs/wa-monitor-prod.log
```

#### Development Environment: `/opt/wa-monitor/dev/.env`
```bash
# Development Environment

# Database (same as prod for now, can be separate later)
NEON_DATABASE_URL=postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require&channel_binding=require

# WhatsApp (shared)
WHATSAPP_DB_PATH=/opt/wa-monitor/shared/whatsapp-bridge/store/messages.db

# Monitoring
SCAN_INTERVAL=15
LOG_LEVEL=DEBUG
LOG_FILE=/opt/wa-monitor/dev/logs/wa-monitor-dev.log
```

### 4. Modular Code Structure

#### `/opt/wa-monitor/prod/modules/config.py`
```python
#!/usr/bin/env python3
"""Configuration management for WA Monitor."""

import yaml
import os
from typing import Dict, List
from pathlib import Path

class Config:
    """Configuration loader and validator."""

    def __init__(self, config_dir: str = None):
        if config_dir is None:
            # Auto-detect based on script location
            self.config_dir = Path(__file__).parent.parent / 'config'
        else:
            self.config_dir = Path(config_dir)

    def load_projects(self) -> List[Dict]:
        """Load projects from YAML config."""
        config_file = self.config_dir / 'projects.yaml'

        if not config_file.exists():
            raise FileNotFoundError(f"Config file not found: {config_file}")

        with open(config_file, 'r') as f:
            data = yaml.safe_load(f)

        # Filter enabled projects only
        projects = [p for p in data.get('projects', []) if p.get('enabled', False)]

        # Validate required fields
        for project in projects:
            self._validate_project(project)

        return projects

    def _validate_project(self, project: Dict):
        """Validate project configuration."""
        required_fields = ['name', 'group_jid', 'description']

        for field in required_fields:
            if field not in project:
                raise ValueError(f"Project missing required field: {field}")

        # Validate group_jid format
        if not project['group_jid'].endswith('@g.us'):
            raise ValueError(f"Invalid group_jid format: {project['group_jid']}")

    @staticmethod
    def get_env(key: str, default: str = None) -> str:
        """Get environment variable with validation."""
        value = os.getenv(key, default)

        if value is None:
            raise ValueError(f"Required environment variable not set: {key}")

        return value
```

#### `/opt/wa-monitor/prod/modules/database.py`
```python
#!/usr/bin/env python3
"""Database operations for WA Monitor."""

import psycopg2
import logging
from datetime import datetime
from typing import Dict, Optional

logger = logging.getLogger(__name__)

class DatabaseManager:
    """Handles all database operations."""

    def __init__(self, connection_url: str):
        self.connection_url = connection_url

    def get_connection(self):
        """Get database connection."""
        return psycopg2.connect(self.connection_url)

    def check_drop_exists(self, drop_number: str) -> bool:
        """Check if drop already exists in database."""
        try:
            conn = self.get_connection()
            cursor = conn.cursor()

            cursor.execute(
                "SELECT id FROM qa_photo_reviews WHERE drop_number = %s",
                (drop_number,)
            )

            exists = cursor.fetchone() is not None

            cursor.close()
            conn.close()

            return exists

        except Exception as e:
            logger.error(f"Error checking if drop exists: {e}")
            return False

    def insert_drop(self, drop_data: Dict) -> bool:
        """Insert new drop into database."""
        try:
            conn = self.get_connection()
            cursor = conn.cursor()

            query = """
            INSERT INTO qa_photo_reviews (
                drop_number,
                review_date,
                user_name,
                project,
                whatsapp_message_date,
                step_01_property_frontage, step_02_location_before_install,
                step_03_outside_cable_span, step_04_home_entry_outside,
                step_05_home_entry_inside, step_06_fibre_entry_to_ont,
                step_07_patched_labelled_drop, step_08_work_area_completion,
                step_09_ont_barcode_scan, step_10_ups_serial_number,
                step_11_powermeter_reading, step_12_powermeter_at_ont,
                step_13_active_broadband_light, step_14_customer_signature,
                outstanding_photos_loaded_to_1map,
                comment,
                incomplete,
                completed
            ) VALUES (
                %s, CURRENT_DATE, %s, %s, %s,
                FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE,
                FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE,
                FALSE, %s, FALSE, FALSE
            )
            """

            cursor.execute(query, (
                drop_data['drop_number'],
                drop_data['user_name'],
                drop_data['project'],
                drop_data['message_timestamp'],
                drop_data.get('comment', '')
            ))

            conn.commit()
            cursor.close()
            conn.close()

            logger.info(f"✅ Created QA review for {drop_data['drop_number']}")
            return True

        except Exception as e:
            logger.error(f"❌ Error inserting drop: {e}")
            return False

    def handle_resubmission(self, drop_number: str, project: str) -> bool:
        """Handle drop resubmission."""
        try:
            conn = self.get_connection()
            cursor = conn.cursor()

            cursor.execute("""
                UPDATE qa_photo_reviews
                SET
                    incomplete = FALSE,
                    feedback_sent = NULL,
                    resubmitted = TRUE,
                    comment = COALESCE(comment, '') || %s,
                    updated_at = CURRENT_TIMESTAMP
                WHERE drop_number = %s
            """, (
                f"\n--- PHOTOS UPDATED {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} ---\n"
                f"Agent updated photos in 1MAP. QA can continue review.\n",
                drop_number
            ))

            rows_updated = cursor.rowcount
            conn.commit()
            cursor.close()
            conn.close()

            if rows_updated > 0:
                logger.info(f"🔄 Logged resubmission for {drop_number}")
                return True
            else:
                logger.warning(f"⚠️  No existing record found for {drop_number}")
                return False

        except Exception as e:
            logger.error(f"❌ Error handling resubmission: {e}")
            return False
```

#### `/opt/wa-monitor/prod/modules/monitor.py`
```python
#!/usr/bin/env python3
"""Drop monitoring logic for WA Monitor."""

import sqlite3
import re
import logging
from typing import List, Dict, Optional
from datetime import datetime

logger = logging.getLogger(__name__)

class DropMonitor:
    """Monitors WhatsApp messages for drop numbers."""

    DROP_PATTERN = re.compile(r'\bDR\d{8}\b')

    def __init__(self, sqlite_db_path: str, database_manager):
        self.sqlite_db_path = sqlite_db_path
        self.db = database_manager
        self.last_processed_id = 0

    def get_new_messages(self, group_jid: str) -> List[Dict]:
        """Get new messages from WhatsApp SQLite database."""
        try:
            conn = sqlite3.connect(self.sqlite_db_path)
            cursor = conn.cursor()

            query = """
            SELECT id, sender, text, timestamp
            FROM messages
            WHERE chat = ? AND id > ?
            ORDER BY id ASC
            """

            cursor.execute(query, (group_jid, self.last_processed_id))
            messages = cursor.fetchall()

            cursor.close()
            conn.close()

            return [
                {
                    'id': msg[0],
                    'sender': msg[1],
                    'text': msg[2],
                    'timestamp': msg[3]
                }
                for msg in messages
            ]

        except Exception as e:
            logger.error(f"Error reading WhatsApp DB: {e}")
            return []

    def extract_drop_number(self, text: str) -> Optional[str]:
        """Extract drop number from message text."""
        if not text:
            return None

        match = self.DROP_PATTERN.search(text)
        return match.group(0) if match else None

    def process_message(self, message: Dict, project_name: str) -> bool:
        """Process a single message for drop numbers."""
        drop_number = self.extract_drop_number(message['text'])

        if not drop_number:
            return False

        logger.info(f"📱 Found drop: {drop_number} in {project_name}")

        # Check if drop already exists
        if self.db.check_drop_exists(drop_number):
            logger.info(f"🔄 Resubmission detected: {drop_number}")
            return self.db.handle_resubmission(drop_number, project_name)
        else:
            # New drop - insert
            drop_data = {
                'drop_number': drop_number,
                'user_name': message['sender'][:20],
                'project': project_name,
                'message_timestamp': message['timestamp'],
                'comment': f"Created from WhatsApp message"
            }
            return self.db.insert_drop(drop_data)

    def scan_project(self, project: Dict) -> int:
        """Scan a single project for new drops."""
        messages = self.get_new_messages(project['group_jid'])

        if not messages:
            return 0

        processed_count = 0

        for message in messages:
            if self.process_message(message, project['name']):
                processed_count += 1

            # Update last processed ID
            self.last_processed_id = max(self.last_processed_id, message['id'])

        return processed_count
```

#### `/opt/wa-monitor/prod/main.py`
```python
#!/usr/bin/env python3
"""
WhatsApp Drop Monitor - Main Entry Point
Modular, config-driven architecture
"""

import logging
import time
import sys
from pathlib import Path

# Add modules to path
sys.path.insert(0, str(Path(__file__).parent / 'modules'))

from config import Config
from database import DatabaseManager
from monitor import DropMonitor

def setup_logging(log_file: str, log_level: str):
    """Setup logging configuration."""
    logging.basicConfig(
        level=getattr(logging, log_level),
        format='%(asctime)s - %(levelname)s - %(message)s',
        handlers=[
            logging.FileHandler(log_file),
            logging.StreamHandler()
        ]
    )
    return logging.getLogger(__name__)

def main():
    """Main monitoring loop."""
    # Load configuration
    config = Config()

    # Get environment variables
    db_url = config.get_env('NEON_DATABASE_URL')
    sqlite_path = config.get_env('WHATSAPP_DB_PATH')
    scan_interval = int(config.get_env('SCAN_INTERVAL', '15'))
    log_file = config.get_env('LOG_FILE')
    log_level = config.get_env('LOG_LEVEL', 'INFO')

    # Setup logging
    logger = setup_logging(log_file, log_level)

    # Load projects
    projects = config.load_projects()
    logger.info(f"🎯 MONITORING {len(projects)} PROJECTS:")
    for project in projects:
        logger.info(f"   • {project['name']}: {project['group_jid']}")

    # Initialize components
    db_manager = DatabaseManager(db_url)
    monitor = DropMonitor(sqlite_path, db_manager)

    logger.info(f"✅ Drop monitor started (scan interval: {scan_interval}s)")

    # Main monitoring loop
    while True:
        try:
            for project in projects:
                count = monitor.scan_project(project)
                if count > 0:
                    logger.info(f"📊 Processed {count} drops from {project['name']}")

            time.sleep(scan_interval)

        except KeyboardInterrupt:
            logger.info("🛑 Monitoring stopped by user")
            break
        except Exception as e:
            logger.error(f"❌ Error in monitoring loop: {e}")
            time.sleep(scan_interval)

if __name__ == "__main__":
    main()
```

## Migration Strategy

### Phase 1: Setup New Structure (No Downtime)
1. Create new `/opt/wa-monitor/` directory structure
2. Copy modules to prod/ and dev/
3. Create config files
4. Create environment files
5. Test new code manually (don't start services yet)

### Phase 2: Switch to New Services (Minimal Downtime)
1. Stop old `drop-monitor` service
2. Start new `wa-monitor-prod` service
3. Verify production working
4. Start new `wa-monitor-dev` service
5. Remove old service files

### Phase 3: Verify and Monitor
1. Monitor logs for 24 hours
2. Verify drops are being captured
3. Test adding a new project (should be 5 minutes)
4. Update documentation

## Benefits Delivered

### Before Refactoring
- ⏱️ **4 hours** to add a project
- 📂 **8 files** to update
- 🚨 **No dev environment** (test in production)
- 💥 **Breaking changes** affect all users
- 📝 **No clear process**

### After Refactoring
- ⏱️ **5 minutes** to add a project (edit YAML + restart)
- 📂 **1 file** to update (projects.yaml)
- 🧪 **Dev environment** (test safely first)
- ✅ **Prod unaffected** during development
- 📋 **Clear documented process**

## "5-Minute Add Project" Process

### New Process (After Refactoring):
```bash
# 1. Edit config file (2 min)
nano /opt/wa-monitor/prod/config/projects.yaml

# Add:
# - name: NewProject
#   enabled: true
#   group_jid: "XXXXXXXXXX@g.us"
#   description: "Description"

# 2. Restart service (1 min)
systemctl restart wa-monitor-prod

# 3. Verify (2 min)
tail -f /opt/wa-monitor/prod/logs/wa-monitor-prod.log
# Look for: "• NewProject: XXXXXXXXXX@g.us"

# Done! ✅
```

**Total Time: 5 minutes**

## Rollback Plan

If new architecture has issues:
```bash
# Stop new services
systemctl stop wa-monitor-prod
systemctl stop wa-monitor-dev

# Start old service
systemctl start drop-monitor

# Old system still exists at /opt/velo-test-monitor/
```

## Next Steps

1. **Get User Approval** on this design
2. **Create directory structure** on VPS
3. **Implement modular code**
4. **Test in dev environment**
5. **Deploy to production**
6. **Document new process**

---

**Status:** Awaiting user approval to proceed with implementation
