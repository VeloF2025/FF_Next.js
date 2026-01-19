# QField OES Data Sync

> Automatic synchronization of OES activation data from FibreFlow to QFieldCloud for mobile field access.

**Last Updated:** January 2026
**Status:** ✅ Production

---

## Overview

When OES (Optical Equipment Status) reports are imported into FibreFlow, the data automatically syncs to QFieldCloud's PostgreSQL database. Field technicians can then view activated drops on their mobile devices via the QField app.

---

## Data Structure

### Fields Synced

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `drop_number` | VARCHAR(20) | DR number (primary key) | DR1856155 |
| `activation_date` | DATE | Activation date | 2026-01-18 |
| `serial_number` | VARCHAR(50) | ONT serial number | ALCLB48AB51C |
| `project_name` | VARCHAR(100) | Project name | Lawley |
| `zone` | VARCHAR(50) | Zone code | Z18 |
| `pon` | VARCHAR(50) | PON code | PON201 |
| `latitude` | DECIMAL(10,7) | GPS latitude | -26.7115646 |
| `longitude` | DECIMAL(10,7) | GPS longitude | 27.0229580 |
| `ont_rx_sig_dbm` | DECIMAL(6,3) | ONT signal strength (dBm) | -20.758 |
| `status` | VARCHAR(50) | Activation status | Active |
| `geom` | GEOMETRY(Point,4326) | PostGIS point geometry | POINT(27.02 -26.71) |
| `synced_at` | TIMESTAMPTZ | Last sync timestamp | 2026-01-19 21:17:31 |

### Current Data Volume

| Project | Records |
|---------|---------|
| Lawley | 3,879 |
| Mohadin | 2,303 |
| Mamelodi | 352 |
| **Total** | **6,535** |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        FIBREFLOW                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐    Import    ┌─────────────────────────────┐  │
│  │  OES Excel  │ ──────────►  │  /api/activate/import-oes   │  │
│  │  Upload     │              │                             │  │
│  └─────────────┘              └──────────────┬──────────────┘  │
│                                              │                  │
│                                              │ 1. Insert to Neon│
│                                              ▼                  │
│                               ┌─────────────────────────────┐  │
│                               │  Neon PostgreSQL            │  │
│                               │  ├─ oes_activations (table) │  │
│                               │  └─ v_qfield_oes_activations│  │
│                               │     (view with JOINs)       │  │
│                               └─────────────────────────────┘  │
│                                              │                  │
│                                              │ 2. Webhook POST  │
└──────────────────────────────────────────────┼──────────────────┘
                                               │
                                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    VELOCITY SERVER (100.96.203.105)             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────┐                                │
│  │  QField Sync Service        │◄─── POST /sync/oes             │
│  │  Port 8095                  │                                │
│  │  /opt/qfield-sync/          │                                │
│  └──────────────┬──────────────┘                                │
│                 │                                               │
│                 │ 3. Query Neon view                            │
│                 │ 4. Upsert to QFieldCloud                      │
│                 ▼                                               │
│  ┌─────────────────────────────┐                                │
│  │  QFieldCloud PostgreSQL     │                                │
│  │  Port 5433 (Docker)         │                                │
│  │  Table: ff_oes_activations  │                                │
│  └──────────────┬──────────────┘                                │
│                 │                                               │
│                 │ 5. QFieldCloud syncs to mobile                │
│                 ▼                                               │
│  ┌─────────────────────────────┐                                │
│  │  QField Mobile App          │                                │
│  │  (iOS / Android)            │                                │
│  └─────────────────────────────┘                                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Sync Service

### Location & Configuration

```
Server: 100.96.203.105 (Velocity Server)
Path: /opt/qfield-sync/
Service: qfield-sync.service
Port: 8095
User: velo
```

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/status` | GET | Last sync status, record count, errors |
| `/sync/oes` | POST | Delta sync (only changed records) |
| `/sync/full` | POST | Full sync (truncate + insert all) |

### Example Usage

```bash
# Health check
curl http://100.96.203.105:8095/health
# {"status":"healthy","service":"qfield-sync"}

# Check last sync status
curl http://100.96.203.105:8095/status
# {"last_sync":"2026-01-19T21:17:31","last_count":6535,"last_error":null,"is_running":false}

# Trigger manual sync
curl -X POST http://100.96.203.105:8095/sync/oes

# Trigger full resync
curl -X POST http://100.96.203.105:8095/sync/full
```

### Service Management

```bash
# SSH to server
ssh velo@100.96.203.105  # Password: velo2026

# Check status
sudo systemctl status qfield-sync.service

# Restart service
sudo systemctl restart qfield-sync.service

# View logs
sudo journalctl -u qfield-sync.service -f

# View sync logs
tail -f /var/log/qfield-sync.log
```

---

## Database Connections

### Source: Neon (FibreFlow)

```
Host: ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech
Database: neondb
User: neondb_owner
Password: npg_MIUZXrg1tEY0
SSL: required

View: v_qfield_oes_activations
  - JOINs oes_activations + drops + projects
  - Provides zone, PON, project_name via lookups
```

### Destination: QFieldCloud PostgreSQL

```
Host: localhost (from VF server) / 100.96.203.105 (external)
Port: 5433
Database: qfieldcloud_db
User: qfieldcloud_db_admin
Password: c6ce1f02f798c5776fee9e6857f628ff775c75e5eb3b7753
Container: qfieldcloud-db-1

Table: ff_oes_activations
```

---

## Setting Up QField Access

### Option 1: QGIS + QFieldCloud (Recommended)

1. **In QGIS Desktop**, create a new PostGIS connection:
   - Host: `100.96.203.105`
   - Port: `5433`
   - Database: `qfieldcloud_db`
   - User: `qfieldcloud_db_admin`
   - Password: `c6ce1f02f798c5776fee9e6857f628ff775c75e5eb3b7753`

2. **Add the layer** `ff_oes_activations` to your project

3. **Style the layer** (e.g., color by project, add labels)

4. **Upload to QFieldCloud**:
   - Plugins → QFieldSync → Push to QFieldCloud
   - Or use QFieldCloud web interface

5. **On mobile devices**:
   - Install QField app (iOS/Android)
   - Login to QFieldCloud
   - Download the project
   - View activated drops on map

### Option 2: Direct Database Query

```sql
-- Connect to QFieldCloud PostgreSQL
psql -h 100.96.203.105 -p 5433 -U qfieldcloud_db_admin -d qfieldcloud_db

-- Query activations
SELECT drop_number, project_name, zone, pon, activation_date
FROM ff_oes_activations
WHERE project_name = 'Lawley'
ORDER BY activation_date DESC;

-- Export to CSV
\copy (SELECT * FROM ff_oes_activations) TO '/tmp/oes_activations.csv' CSV HEADER;
```

### Option 3: GeoPackage Export

```bash
# On VF server, install geopandas
ssh velo@100.96.203.105
source /opt/qfield-sync/venv/bin/activate
pip install geopandas sqlalchemy

# Generate GeoPackage
python3 /opt/qfield-sync/sync_oes_to_qfield.py --full --gpkg

# File created at: /opt/qfieldcloud/projects/oes_activations.gpkg
```

---

## Automatic Sync Flow

1. **User imports OES Excel** via FibreFlow UI (`/activate` → OES Import tab)

2. **`import-oes.ts`** processes the file:
   - Inserts/updates records in `oes_activations` table
   - Fires webhook to sync service

3. **Sync service** receives POST to `/sync/oes`:
   - Queries `v_qfield_oes_activations` view from Neon
   - Upserts changed records to `ff_oes_activations` in QFieldCloud
   - Updates `synced_at` timestamp

4. **QFieldCloud** syncs to mobile devices on next refresh

---

## Troubleshooting

### Sync Not Triggering

```bash
# Check if service is running
curl http://100.96.203.105:8095/health

# Check service status
ssh velo@100.96.203.105 "sudo systemctl status qfield-sync.service"

# Check logs for errors
ssh velo@100.96.203.105 "sudo journalctl -u qfield-sync.service -n 50"
```

### Data Not Appearing

```bash
# Check QFieldCloud table directly
ssh velo@100.96.203.105 "docker exec qfieldcloud-db-1 psql -U qfieldcloud_db_admin -d qfieldcloud_db -c 'SELECT COUNT(*) FROM ff_oes_activations;'"

# Manual full resync
curl -X POST http://100.96.203.105:8095/sync/full
```

### Connection Issues

```bash
# Test Neon connection (from VF server)
ssh velo@100.96.203.105
source /opt/qfield-sync/venv/bin/activate
python3 -c "import psycopg2; c=psycopg2.connect('postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require'); print('Neon OK')"

# Test QFieldCloud connection
python3 -c "import psycopg2; c=psycopg2.connect(host='localhost',port=5433,database='qfieldcloud_db',user='qfieldcloud_db_admin',password='c6ce1f02f798c5776fee9e6857f628ff775c75e5eb3b7753'); print('QField OK')"
```

---

## File Locations

| File | Location | Purpose |
|------|----------|---------|
| Sync script | `/opt/qfield-sync/sync_oes_to_qfield.py` | Main sync logic |
| API server | `/opt/qfield-sync/sync_server.py` | FastAPI webhook server |
| Systemd service | `/etc/systemd/system/qfield-sync.service` | Service definition |
| Sync logs | `/var/log/qfield-sync.log` | Sync operation logs |
| Server logs | `/var/log/qfield-sync-server.log` | API server logs |
| Migration | `scripts/migrations/092_qfield_sync_view.sql` | Neon view definition |

---

## Related Documentation

- [Activate Module README](../src/modules/activate/README.md)
- [Database Tables Reference](./DATABASE_TABLES.md)
- [VLM Infrastructure](./VLM_INFRASTRUCTURE.md)
