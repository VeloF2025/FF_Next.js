SELECT 
    COUNT(*) as total,
    COUNT(CASE WHEN latitude IS NOT NULL THEN 1 END) as has_lat,
    COUNT(CASE WHEN longitude IS NOT NULL THEN 1 END) as has_lon,
    COUNT(CASE WHEN latitude != 0 AND longitude != 0 THEN 1 END) as valid_coords
FROM oes_activations;

SELECT drop_number, latitude, longitude, team, status
FROM oes_activations
WHERE DATE(created_at) >= CURRENT_DATE - INTERVAL '1 day'
LIMIT 5;
