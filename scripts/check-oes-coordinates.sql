-- Check OES coordinates in database
-- Run this to diagnose why sync is finding no valid coordinates

-- 1. Total records in oes_activations
SELECT COUNT(*) as total_records FROM oes_activations;

-- 2. Records with coordinates
SELECT
    COUNT(*) as records_with_coords,
    COUNT(CASE WHEN latitude IS NOT NULL THEN 1 END) as has_latitude,
    COUNT(CASE WHEN longitude IS NOT NULL THEN 1 END) as has_longitude,
    COUNT(CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL THEN 1 END) as has_both,
    COUNT(CASE WHEN latitude != 0 AND longitude != 0 THEN 1 END) as non_zero_coords
FROM oes_activations;

-- 3. Sample of records to see actual values
SELECT
    drop_number,
    latitude,
    longitude,
    activation_date,
    team,
    status
FROM oes_activations
LIMIT 10;

-- 4. Check for today's import
SELECT
    drop_number,
    latitude,
    longitude,
    activation_date,
    team,
    status
FROM oes_activations
WHERE DATE(created_at) = CURRENT_DATE
LIMIT 10;

-- 5. Statistics on coordinate values
SELECT
    MIN(latitude) as min_lat,
    MAX(latitude) as max_lat,
    AVG(latitude) as avg_lat,
    MIN(longitude) as min_lon,
    MAX(longitude) as max_lon,
    AVG(longitude) as avg_lon
FROM oes_activations
WHERE latitude IS NOT NULL AND longitude IS NOT NULL;