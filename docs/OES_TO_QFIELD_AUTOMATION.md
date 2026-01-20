# OES Report to QFieldCloud Automation Guide

## Overview

This guide explains how OES (Optical Element Survey) report data is automatically displayed in QFieldCloud as a labeled point layer, showing drop numbers on the map as seen in the reference image.

## 📊 Data Flow Architecture

```
Excel OES Report → Database Import → GeoJSON Conversion → QFieldCloud Upload → Map Display
```

### Detailed Flow:

1. **Excel Import** (`VELOCITY OES REPORT 20 JAN 2026.xlsx`)
   - User uploads Excel file via `/activate` → OES Import tab
   - File parsed and stored in `oes_activations` table
   - Contains: Drop numbers, coordinates, signal strength, team assignments

2. **Database Storage**
   - `oes_activations` table stores all OES data
   - Linked to `drops` table via drop_number
   - Includes latitude/longitude for geographic positioning

3. **GeoJSON Creation**
   - Fetches OES records with valid coordinates
   - Creates point features with drop_number as label
   - Includes all attributes (signal, team, status)

4. **QFieldCloud Upload**
   - Uploads as "OES Report" layer
   - Points display with DR numbers visible
   - Automatic label configuration

## 🚀 Quick Start - Automated Process

### Step 1: Import OES Excel Report

1. Navigate to `/activate` → **OES Import** tab
2. Select report date
3. Drag & drop Excel file (or click to browse)
4. Click **Import X Records**
5. Wait for import completion

### Step 2: Sync to QFieldCloud

After successful import:
1. Click **📍 Sync to QFieldCloud Map** button
2. System automatically:
   - Converts data to GeoJSON points
   - Sets drop_number as visible labels
   - Uploads as "OES Report" layer
   - Replaces any existing OES layer

### Step 3: View in QField App

1. Open QField mobile app
2. Sync project to get latest data
3. Enable "OES Report" layer
4. Drop numbers appear as labels on map

## 📡 API Endpoints

### Import OES Excel
```
POST /api/activate/import-oes
Content-Type: multipart/form-data
- file: Excel file
- action: "import" or "preview"
- reportDate: YYYY-MM-DD
```

### Sync to QFieldCloud
```
POST /api/activate/sync-oes-to-qfield
Content-Type: application/json
{
  "projectId": "baf29cb3-2483-4924-b7c0-47953ac2851e", // optional
  "reportDate": "2026-01-20",  // optional filter
  "teamFilter": "law12",        // optional filter
  "statusFilter": "Active"      // default: Active only
}
```

## 🗺️ Map Display Features

### What Gets Displayed:
- **Points**: Each OES activation as a red point
- **Labels**: Drop numbers (e.g., "DR1750089") visible without clicking
- **Attributes**:
  - Serial number
  - Signal strength (dBm)
  - Team assignment
  - Activation date
  - Status (Active/Inactive)

### Label Configuration:
```json
{
  "label": {
    "enabled": true,
    "field": "label",  // Uses drop_number
    "size": 10,
    "color": "#000000",
    "halo": true,
    "halo_color": "#FFFFFF",
    "halo_size": 1
  }
}
```

## 🔧 Technical Implementation

### Database Schema
```sql
-- OES Activations Table
CREATE TABLE oes_activations (
  drop_number VARCHAR PRIMARY KEY,
  serial_number VARCHAR,
  activation_date DATE,
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  ont_rx_sig_dbm DECIMAL,
  current_ont_rx DECIMAL,
  team VARCHAR,
  status VARCHAR
);
```

### GeoJSON Format
```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": {
        "type": "Point",
        "coordinates": [28.123456, -26.234567]
      },
      "properties": {
        "drop_number": "DR1750089",
        "label": "DR1750089",  // This is displayed
        "serial_number": "ALCLB477906C",
        "ont_rx_sig_dbm": -18.7,
        "team": "law12",
        "status": "Active"
      }
    }
  ]
}
```

## 🎯 Filtering Options

### By Date
Only sync specific report date:
```javascript
{ "reportDate": "2026-01-20" }
```

### By Team
Filter by team assignment:
```javascript
{ "teamFilter": "law12" }
```

### By Status
Default shows Active only, options:
- `"Active"` - Only active drops (default)
- `"Inactive"` - Only inactive
- `"All"` - Both active and inactive

## 🚨 Troubleshooting

### Issue: Points not appearing on map
**Solution:**
1. Check latitude/longitude values are valid (not 0,0)
2. Ensure QField project is synced after upload
3. Verify "OES Report" layer is enabled

### Issue: Labels not visible
**Solution:**
1. Zoom in - labels may be scale-dependent
2. Check label settings in QField project
3. Ensure drop_number field exists

### Issue: Old data still showing
**Solution:**
- System automatically deletes old "OES Report" layer before upload
- Force sync in QField app
- Clear app cache if needed

### Issue: Sync fails with error
**Solution:**
1. Check QFieldCloud API token is valid
2. Verify project ID exists
3. Ensure user has write permissions
4. Check network connectivity

## 📝 Manual Process (Alternative)

If automation fails, manual process:

1. **Export from database:**
```sql
SELECT drop_number, latitude, longitude, serial_number, team
FROM oes_activations
WHERE latitude IS NOT NULL;
```

2. **Convert to CSV with headers:**
```
drop_number,latitude,longitude,serial_number,team
DR1750089,-26.234567,28.123456,ALCLB477906C,law12
```

3. **Import to QGIS:**
   - Add delimited text layer
   - Set X=longitude, Y=latitude
   - CRS: EPSG:4326

4. **Configure labels:**
   - Properties → Labels → Single Labels
   - Value: drop_number
   - Size: 10pt

5. **Export as GeoPackage and upload to QFieldCloud**

## 🔄 Update Frequency

- **Daily**: After receiving new OES report from Nokia
- **Real-time**: Sync immediately after import
- **Batch**: Can accumulate and sync weekly

## 📊 Statistics Dashboard

View sync status:
```sql
-- Count synced points
SELECT COUNT(*) FROM oes_activations
WHERE latitude IS NOT NULL;

-- By team
SELECT team, COUNT(*)
FROM oes_activations
WHERE latitude IS NOT NULL
GROUP BY team;

-- Signal quality distribution
SELECT
  CASE
    WHEN current_ont_rx > -20 THEN 'Excellent'
    WHEN current_ont_rx > -24 THEN 'Good'
    WHEN current_ont_rx > -28 THEN 'Fair'
    ELSE 'Poor'
  END as quality,
  COUNT(*)
FROM oes_activations
GROUP BY quality;
```

## 🎉 Success Criteria

The automation is successful when:
- ✅ OES Excel imports without errors
- ✅ "Sync to QFieldCloud" completes
- ✅ Drop numbers appear as labels on map
- ✅ Points are clickable for full details
- ✅ Data refreshes in mobile app

## 📧 Support

For issues or questions:
- Check logs: `/api/activate/sync-oes-to-qfield` response
- Database queries: `oes_activations` table
- QFieldCloud project: https://qfield.fibreflow.app
- Contact: Technical team

---
*Last updated: January 2026*
*Version: 1.0.0*