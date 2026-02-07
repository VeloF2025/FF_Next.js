#!/usr/bin/env python3
"""Trace where today's Lawley data came from"""

import os
os.environ['DATABASE_URL'] = "process.env.DATABASE_URL"

import psycopg2
from datetime import datetime

print("🔍 Tracing data source for today's Lawley submissions...")
print("=" * 80)

try:
    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    cursor = conn.cursor()

    # Check Lawley drops from today
    cursor.execute("""
        SELECT
            drop_number,
            project,
            created_at,
            comment,
            user_name,
            sender_phone
        FROM qa_photo_reviews
        WHERE DATE(created_at) = CURRENT_DATE
        AND project = 'Lawley'
        ORDER BY created_at ASC
        LIMIT 10
    """)

    print("📊 First 10 Lawley drops today:")
    print("=" * 80)

    rows = cursor.fetchall()
    for row in rows:
        drop, project, created, comment, user, phone = row
        print(f"\n{drop} ({project})")
        print(f"  Created: {created}")
        print(f"  User: {user}")
        print(f"  Phone: {phone}")
        print(f"  Comment: {comment[:100] if comment else 'None'}")

    # Check the comment field to see if it mentions WhatsApp or auto-import
    cursor.execute("""
        SELECT
            comment,
            COUNT(*) as count
        FROM qa_photo_reviews
        WHERE DATE(created_at) = CURRENT_DATE
        AND project = 'Lawley'
        GROUP BY comment
        ORDER BY count DESC
    """)

    print("\n" + "=" * 80)
    print("📝 Comment patterns (grouped):")
    print("=" * 80)

    comments = cursor.fetchall()
    for comment, count in comments:
        print(f"\nCount: {count}")
        print(f"Comment: {comment[:150] if comment else 'NULL'}")

    cursor.close()
    conn.close()

    print("\n✅ Trace complete")

except Exception as e:
    print(f"❌ Error: {e}")
