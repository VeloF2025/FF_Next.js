#!/usr/bin/env python3
"""
Sync OES activation data from FibreFlow (Neon) to QFieldCloud PostgreSQL.

Usage:
    python3 sync_oes_to_qfield.py [--full] [--gpkg]

Options:
    --full    Full sync (truncate + insert), default is delta (upsert)
    --gpkg    Also generate GeoPackage file after sync
"""

import os
import sys
import logging
from datetime import datetime
from typing import Optional

import psycopg2
from psycopg2.extras import execute_values

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler('/var/log/qfield-sync.log', mode='a')
    ]
)
logger = logging.getLogger(__name__)

# Environment variables
NEON_DATABASE_URL = os.environ.get(
    'NEON_DATABASE_URL',
    'process.env.DATABASE_URL'
)

QFIELD_CONFIG = {
    'host': os.environ.get('QFIELD_DB_HOST', 'localhost'),
    'port': int(os.environ.get('QFIELD_DB_PORT', 5433)),
    'database': os.environ.get('QFIELD_DB_NAME', 'qfieldcloud_db'),
    'user': os.environ.get('QFIELD_DB_USER', 'qfieldcloud_db_admin'),
    'password': os.environ.get('QFIELD_DB_PASSWORD', 'c6ce1f02f798c5776fee9e6857f628ff775c75e5eb3b7753'),
}

GPKG_OUTPUT_PATH = os.environ.get('GPKG_OUTPUT_PATH', '/opt/qfieldcloud/projects/oes_activations.gpkg')


def get_neon_connection():
    """Connect to Neon database."""
    return psycopg2.connect(NEON_DATABASE_URL)


def get_qfield_connection():
    """Connect to QFieldCloud PostgreSQL."""
    return psycopg2.connect(**QFIELD_CONFIG)


def fetch_oes_data(neon_conn, since: Optional[datetime] = None):
    """Fetch OES data from Neon view."""
    cursor = neon_conn.cursor()

    if since:
        logger.info(f"Fetching OES data updated since {since}")
        cursor.execute("""
            SELECT
                drop_number, activation_date, serial_number,
                latitude, longitude, zone, pon, project_name,
                ont_rx_sig_dbm, status
            FROM v_qfield_oes_activations
            WHERE updated_at > %s
            ORDER BY drop_number
        """, (since,))
    else:
        logger.info("Fetching all OES data")
        cursor.execute("""
            SELECT
                drop_number, activation_date, serial_number,
                latitude, longitude, zone, pon, project_name,
                ont_rx_sig_dbm, status
            FROM v_qfield_oes_activations
            ORDER BY drop_number
        """)

    rows = cursor.fetchall()
    cursor.close()
    return rows


def sync_full(neon_conn, qfield_conn):
    """Full sync: truncate and insert all records."""
    logger.info("Starting FULL sync...")

    # Fetch all data from Neon
    data = fetch_oes_data(neon_conn)
    logger.info(f"Fetched {len(data)} records from Neon")

    if not data:
        logger.warning("No data to sync")
        return 0

    qfield_cursor = qfield_conn.cursor()

    # Truncate table
    logger.info("Truncating ff_oes_activations...")
    qfield_cursor.execute("TRUNCATE TABLE ff_oes_activations")

    # Batch insert
    logger.info("Inserting records...")
    insert_sql = """
        INSERT INTO ff_oes_activations (
            drop_number, activation_date, serial_number,
            latitude, longitude, zone, pon, project_name,
            ont_rx_sig_dbm, status, synced_at, geom
        ) VALUES %s
    """

    # Transform data to include geometry
    values = []
    for row in data:
        drop_number, activation_date, serial_number, lat, lon, zone, pon, project_name, ont_rx, status = row
        # Create PostGIS point geometry
        geom = f"SRID=4326;POINT({lon} {lat})" if lat and lon else None
        values.append((
            drop_number, activation_date, serial_number,
            lat, lon, zone, pon, project_name,
            ont_rx, status, datetime.now(), geom
        ))

    execute_values(
        qfield_cursor,
        insert_sql,
        values,
        template="(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, ST_GeomFromEWKT(%s))"
    )

    qfield_conn.commit()
    qfield_cursor.close()

    logger.info(f"FULL sync complete: {len(data)} records inserted")
    return len(data)


def sync_delta(neon_conn, qfield_conn):
    """Delta sync: upsert changed records."""
    logger.info("Starting DELTA sync...")

    qfield_cursor = qfield_conn.cursor()

    # Get last sync time
    qfield_cursor.execute("SELECT MAX(synced_at) FROM ff_oes_activations")
    last_sync = qfield_cursor.fetchone()[0]

    if not last_sync:
        logger.info("No previous sync found, doing full sync")
        qfield_cursor.close()
        return sync_full(neon_conn, qfield_conn)

    # Fetch changed data
    data = fetch_oes_data(neon_conn, since=last_sync)
    logger.info(f"Fetched {len(data)} changed records since {last_sync}")

    if not data:
        logger.info("No changes to sync")
        return 0

    # Upsert
    upsert_sql = """
        INSERT INTO ff_oes_activations (
            drop_number, activation_date, serial_number,
            latitude, longitude, zone, pon, project_name,
            ont_rx_sig_dbm, status, synced_at, geom
        ) VALUES %s
        ON CONFLICT (drop_number) DO UPDATE SET
            activation_date = EXCLUDED.activation_date,
            serial_number = EXCLUDED.serial_number,
            latitude = EXCLUDED.latitude,
            longitude = EXCLUDED.longitude,
            zone = EXCLUDED.zone,
            pon = EXCLUDED.pon,
            project_name = EXCLUDED.project_name,
            ont_rx_sig_dbm = EXCLUDED.ont_rx_sig_dbm,
            status = EXCLUDED.status,
            synced_at = EXCLUDED.synced_at,
            geom = EXCLUDED.geom
    """

    values = []
    for row in data:
        drop_number, activation_date, serial_number, lat, lon, zone, pon, project_name, ont_rx, status = row
        geom = f"SRID=4326;POINT({lon} {lat})" if lat and lon else None
        values.append((
            drop_number, activation_date, serial_number,
            lat, lon, zone, pon, project_name,
            ont_rx, status, datetime.now(), geom
        ))

    execute_values(
        qfield_cursor,
        upsert_sql,
        values,
        template="(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, ST_GeomFromEWKT(%s))"
    )

    qfield_conn.commit()
    qfield_cursor.close()

    logger.info(f"DELTA sync complete: {len(data)} records upserted")
    return len(data)


def generate_geopackage(qfield_conn):
    """Generate GeoPackage file from synced data."""
    try:
        import geopandas as gpd
        from sqlalchemy import create_engine

        logger.info("Generating GeoPackage...")

        # Create SQLAlchemy engine for geopandas
        engine_url = f"postgresql://{QFIELD_CONFIG['user']}:{QFIELD_CONFIG['password']}@{QFIELD_CONFIG['host']}:{QFIELD_CONFIG['port']}/{QFIELD_CONFIG['database']}"
        engine = create_engine(engine_url)

        # Read data with geometry
        gdf = gpd.read_postgis(
            "SELECT * FROM ff_oes_activations WHERE geom IS NOT NULL",
            engine,
            geom_col='geom'
        )

        # Save to GeoPackage
        gdf.to_file(GPKG_OUTPUT_PATH, driver='GPKG', layer='oes_activations')

        logger.info(f"GeoPackage saved to {GPKG_OUTPUT_PATH} ({len(gdf)} features)")
        return True

    except ImportError:
        logger.warning("geopandas not installed, skipping GeoPackage generation")
        return False
    except Exception as e:
        logger.error(f"GeoPackage generation failed: {e}")
        return False


def main():
    """Main entry point."""
    full_sync = '--full' in sys.argv
    gen_gpkg = '--gpkg' in sys.argv

    logger.info("=" * 60)
    logger.info("QField OES Sync Starting")
    logger.info(f"Mode: {'FULL' if full_sync else 'DELTA'}")
    logger.info("=" * 60)

    try:
        neon_conn = get_neon_connection()
        logger.info("Connected to Neon")

        qfield_conn = get_qfield_connection()
        logger.info("Connected to QFieldCloud")

        if full_sync:
            count = sync_full(neon_conn, qfield_conn)
        else:
            count = sync_delta(neon_conn, qfield_conn)

        if gen_gpkg and count > 0:
            generate_geopackage(qfield_conn)

        neon_conn.close()
        qfield_conn.close()

        logger.info("=" * 60)
        logger.info(f"Sync Complete: {count} records processed")
        logger.info("=" * 60)

        return 0

    except Exception as e:
        logger.error(f"Sync failed: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
