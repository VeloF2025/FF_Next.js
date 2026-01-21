# ⚠️ CRITICAL: QField Mobile Requires GeoPackage Format

**Discovery Date**: January 20, 2026
**Issue Duration**: 2 hours 22 minutes (could be 11 minutes)
**Affected User**: Jaun (QField mobile app user)

## Executive Summary

**QField mobile app ONLY works reliably with GeoPackage (.gpkg) format!**

We wasted 31 minutes trying CSV and GeoJSON before discovering this critical requirement.

## Format Compatibility Matrix

| Format | Upload | Web View | QField Mobile | File Size | Verdict |
|--------|--------|----------|---------------|-----------|---------|
| **CSV** | ✅ Works | ❌ No layer | ❌ No layer | 640 KB | **DON'T USE** |
| **GeoJSON** | ✅ Works | ✅ Shows | ❌ Doesn't work | 3.2 MB | **DON'T USE** |
| **GeoPackage** | ✅ Works | ✅ Shows | ✅ WORKS! | 720 KB | **✅ USE THIS** |

## The Problem Timeline

1. **10:41** - Uploaded CSV (640 KB) → No layer visible
2. **11:10** - Created GeoJSON (3.2 MB) → Still not working in mobile
3. **11:26** - Created GeoPackage (720 KB) → **SUCCESS!**

## Why GeoPackage?

### Technical Reasons
- **SQLite-based**: Optimized for mobile devices
- **Self-contained**: Everything in one file
- **Indexed**: Fast performance on mobile
- **Compressed**: Smaller than GeoJSON (720KB vs 3.2MB)
- **Native support**: QField is built for GeoPackage

### What Doesn't Work
- **CSV**: Just data, no geometry definition
- **GeoJSON**: Too large, not optimized for mobile
- **Shapefile**: Multiple files, complex for mobile

## Quick Conversion Guide

### From CSV to GeoPackage

#### Method 1: Using Script (Recommended)
```bash
python3 scripts/create-oes-geopackage-real.py
```

#### Method 2: Using ogr2ogr
```bash
ogr2ogr -f GPKG output.gpkg input.csv \
  -oo X_POSSIBLE_NAMES=longitude \
  -oo Y_POSSIBLE_NAMES=latitude \
  -a_srs EPSG:4326
```

#### Method 3: Using QGIS Desktop
1. Open CSV in QGIS
2. Right-click layer → Export → Save Features As
3. Format: GeoPackage
4. CRS: EPSG:4326

## Upload Process for QFieldCloud

### Correct Order:
1. Create GeoPackage file (.gpkg)
2. Upload to QFieldCloud project
3. Optional: Upload QGIS project file (.qgs) for styling

### Command:
```bash
# Upload GeoPackage
curl -X POST "https://qfield.fibreflow.app/api/v1/files/{PROJECT_ID}/data.gpkg/" \
  -H "Authorization: Token {TOKEN}" \
  -F "file=@data.gpkg"
```

## Common Mistakes to Avoid

### ❌ DON'T
- Upload CSV expecting it to work
- Use GeoJSON for mobile
- Forget to DELETE and re-download after changing formats
- Mix formats in same project

### ✅ DO
- Always use GeoPackage for QField mobile
- Test on actual mobile device
- Delete cache when changing formats
- Keep file sizes reasonable (<1MB preferred)

## Troubleshooting Checklist

If layer not showing in QField:

1. **Is it a GeoPackage file?** (not CSV or GeoJSON)
2. **File size reasonable?** (<1MB is best)
3. **Correct CRS?** (usually EPSG:4326)
4. **Fresh download?** (delete and re-sync)
5. **Valid geometry?** (check in QGIS desktop first)

## Working Example

### OES Data Upload (Jan 20, 2026)
```yaml
Project: OES_Data_Jan2026
Records: 6,682 points
Failed Attempts:
  - CSV (640 KB): No layer
  - GeoJSON (3.2 MB): Doesn't work in mobile
Successful:
  - GeoPackage (720 KB): Perfect!
Time Wasted: 31 minutes
Could Have Been: 3 minutes
```

## Scripts & Tools

### Main Conversion Script
**Location**: `scripts/create-oes-geopackage-real.py`
- Fetches from database
- Creates proper GeoPackage
- Handles WKB geometry
- Uploads to QFieldCloud

### Utility Script
**Location**: `scripts/oes-qfield-sync.sh`
```bash
./scripts/oes-qfield-sync.sh --upload  # Uses GeoPackage
```

## Key Learning

> **"You need to save the file as a geopack file"** - Jaun, Jan 20, 2026

This simple statement saved the project after 2+ hours of troubleshooting.

## Prevention

To avoid this issue in future:
1. **DEFAULT TO GEOPACKAGE** for any QField mobile project
2. Train team: "QField = GeoPackage"
3. Update all scripts to use GeoPackage
4. Document in project README

## References

- QField Documentation: https://qfield.org
- GeoPackage Specification: https://www.geopackage.org
- Session Log: `docs/sessions/2026-01-20-OES-UPLOAD-SESSION.md`
- Skill: `.claude/skills/qfieldcloud/sub-skills/data-formats.md`

---

**Bottom Line**: For QField mobile, ALWAYS use GeoPackage (.gpkg) format. Period.