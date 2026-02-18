#!/usr/bin/env python3
"""
Ingest FibreFlow knowledge documents into Qdrant vector database.

Usage:
  python3 scripts/ingest-qdrant.py             # Incremental (skip existing sources)
  python3 scripts/ingest-qdrant.py --force      # Re-ingest all sources
  python3 scripts/ingest-qdrant.py --source docs/INFRASTRUCTURE.md  # Single file
  python3 scripts/ingest-qdrant.py --dry-run    # Count chunks without embedding

Reads .env.local for OPENAI_API_KEY and DATABASE_URL.
Connects to Qdrant at localhost:6333 (must run on Velocity).
"""

import argparse
import hashlib
import os
import re
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

COLLECTION = "fibreflow_kb"
QDRANT_HOST = "localhost"
QDRANT_PORT = 6333
EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIM = 1536
CHUNK_SIZE = 800        # max words per chunk
EMBED_BATCH_SIZE = 50   # OpenAI batch limit

PROJECT_ROOT = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------------------
# Env loading
# ---------------------------------------------------------------------------

def load_env():
    """Load .env.local and .env into os.environ (first wins)."""
    for name in (".env.local", ".env"):
        env_file = PROJECT_ROOT / name
        if not env_file.exists():
            continue
        with open(env_file) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                m = re.match(r"^([^#=]+)=(.*)$", line)
                if m:
                    key, val = m.group(1).strip(), m.group(2).strip()
                    if key not in os.environ:
                        os.environ[key] = val

# ---------------------------------------------------------------------------
# Source discovery
# ---------------------------------------------------------------------------

SOURCE_GLOBS = [
    ("docs/*.md",                          "docs"),
    ("docs/user-manuals/source/*.md",      "user-manual"),
    (".claude/modules/*.md",               "claude-modules"),
    (".claude/knowledge-base/**/*.md",     "knowledge-base"),
    ("src/modules/*/.claude.md",           "module-context"),
]


def discover_sources(single_source=None):
    """Return list of (source_id, file_path) tuples."""
    sources = []
    if single_source:
        p = PROJECT_ROOT / single_source
        if not p.exists():
            print(f"  File not found: {single_source}")
            sys.exit(1)
        sources.append((single_source, p))
        return sources

    for pattern, _tag in SOURCE_GLOBS:
        for p in sorted(PROJECT_ROOT.glob(pattern)):
            if p.name == "README.md":
                continue
            rel = str(p.relative_to(PROJECT_ROOT))
            sources.append((rel, p))

    return sources

# ---------------------------------------------------------------------------
# Chunking (mirrors old ingest-knowledge.js strategy)
# ---------------------------------------------------------------------------

def chunk_markdown(text, source_id):
    """Split markdown by ## headings, then sub-chunk large sections."""
    chunks = []
    sections = re.split(r"(?=^## )", text, flags=re.MULTILINE)

    for section in sections:
        heading_match = re.match(r"^##+ (.+)", section, re.MULTILINE)
        section_title = heading_match.group(1).strip() if heading_match else "Introduction"

        # Strip image markdown
        cleaned = re.sub(r"!\[.*?\]\(.*?\)\n?\*.*?\*\n?", "", section)
        cleaned = re.sub(r"!\[.*?\]\(.*?\)", "", cleaned).strip()

        if not cleaned or len(cleaned) < 20:
            continue

        words = cleaned.split()
        if len(words) <= CHUNK_SIZE:
            chunks.append({
                "content": cleaned,
                "section": section_title,
                "source": source_id,
            })
            continue

        # Sub-chunk by paragraphs with overlap
        paragraphs = re.split(r"\n\n+", cleaned)
        current, current_wc, part = [], 0, 0

        for para in paragraphs:
            pw = len(para.split())
            if current_wc + pw > CHUNK_SIZE and current:
                chunks.append({
                    "content": "\n\n".join(current),
                    "section": f"{section_title} (part {part + 1})",
                    "source": source_id,
                })
                part += 1
                # Overlap: keep last paragraph
                last = current[-1]
                current = [last]
                current_wc = len(last.split())

            current.append(para)
            current_wc += pw

        if current:
            label = f"{section_title} (part {part + 1})" if part > 0 else section_title
            chunks.append({
                "content": "\n\n".join(current),
                "section": label,
                "source": source_id,
            })

    return chunks

# ---------------------------------------------------------------------------
# DB schema ingestion
# ---------------------------------------------------------------------------

def fetch_db_schema():
    """Fetch table/column info from Neon and return chunks."""
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("  No DATABASE_URL — skipping DB schema ingestion")
        return []

    try:
        import psycopg2
    except ImportError:
        print("  psycopg2 not installed — skipping DB schema ingestion")
        return []

    conn = psycopg2.connect(db_url)
    cur = conn.cursor()
    cur.execute("""
        SELECT t.table_name,
               string_agg(c.column_name || ' ' || c.data_type,
                          ', ' ORDER BY c.ordinal_position) AS columns
        FROM information_schema.tables t
        JOIN information_schema.columns c
          ON t.table_name = c.table_name AND t.table_schema = c.table_schema
        WHERE t.table_schema = 'public'
          AND t.table_type IN ('BASE TABLE', 'VIEW')
        GROUP BY t.table_name
        ORDER BY t.table_name
    """)
    rows = cur.fetchall()
    cur.close()
    conn.close()

    chunks, current, current_wc = [], [], 0
    for table_name, columns in rows:
        entry = f"{table_name}: {columns}"
        ew = len(entry.split())
        if current_wc + ew > CHUNK_SIZE and current:
            chunks.append({
                "content": "DATABASE SCHEMA:\n" + "\n\n".join(current),
                "section": f"DB Schema ({len(current)} tables)",
                "source": "db-schema",
            })
            current, current_wc = [], 0
        current.append(entry)
        current_wc += ew

    if current:
        chunks.append({
            "content": "DATABASE SCHEMA:\n" + "\n\n".join(current),
            "section": f"DB Schema ({len(current)} tables)",
            "source": "db-schema",
        })

    print(f"  {len(rows)} tables -> {len(chunks)} schema chunks")
    return chunks

# ---------------------------------------------------------------------------
# Embedding
# ---------------------------------------------------------------------------

def embed_texts(texts, api_key):
    """Embed a list of texts via OpenAI API. Returns list of vectors."""
    import urllib.request
    import json

    all_embeddings = []
    for i in range(0, len(texts), EMBED_BATCH_SIZE):
        batch = texts[i : i + EMBED_BATCH_SIZE]
        body = json.dumps({"model": EMBEDDING_MODEL, "input": batch}).encode()
        req = urllib.request.Request(
            "https://api.openai.com/v1/embeddings",
            data=body,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
        )
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read())

        for item in data["data"]:
            all_embeddings.append(item["embedding"])

        done = min(i + EMBED_BATCH_SIZE, len(texts))
        if done < len(texts):
            print(f"    Embedded {done}/{len(texts)} chunks...")

    return all_embeddings

# ---------------------------------------------------------------------------
# Deterministic point IDs
# ---------------------------------------------------------------------------

def point_id(source, chunk_index):
    """Deterministic int64 ID from source + chunk_index (so re-runs upsert, not duplicate)."""
    h = hashlib.sha256(f"{source}::{chunk_index}".encode()).hexdigest()
    return int(h[:15], 16)  # 60-bit int, fits Qdrant u64

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Ingest FibreFlow KB into Qdrant")
    parser.add_argument("--force", action="store_true", help="Re-ingest all sources")
    parser.add_argument("--source", type=str, help="Ingest single file (relative path)")
    parser.add_argument("--dry-run", action="store_true", help="Count chunks only")
    args = parser.parse_args()

    load_env()
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key and not args.dry_run:
        print("ERROR: Missing OPENAI_API_KEY")
        sys.exit(1)

    from qdrant_client import QdrantClient
    from qdrant_client.models import (
        PointStruct, Distance, VectorParams,
        FilterSelector, Filter, FieldCondition, MatchValue,
    )

    client = QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT)

    # Ensure collection exists
    collections = [c.name for c in client.get_collections().collections]
    if COLLECTION not in collections:
        print(f"Creating collection '{COLLECTION}'...")
        client.create_collection(
            collection_name=COLLECTION,
            vectors_config=VectorParams(size=EMBEDDING_DIM, distance=Distance.COSINE),
        )

    # Get existing sources in collection
    existing_sources = set()
    if not args.force and not args.source:
        scroll = client.scroll(COLLECTION, limit=1, with_payload=True, with_vectors=False)
        # Fetch unique sources by scrolling
        offset = None
        batch_size = 100
        while True:
            points, next_offset = client.scroll(
                COLLECTION, limit=batch_size, offset=offset,
                with_payload=["source"], with_vectors=False,
            )
            for p in points:
                existing_sources.add(p.payload.get("source", ""))
            if next_offset is None:
                break
            offset = next_offset

    # Discover sources
    sources = discover_sources(args.source)
    print(f"FibreFlow Qdrant Ingestion")
    print(f"  Sources found: {len(sources)}")
    print(f"  Mode: {'dry-run' if args.dry_run else 'force' if args.force else 'incremental'}")
    print()

    total_chunks = 0
    total_embedded = 0

    for source_id, filepath in sources:
        print(f"  {source_id}")

        if not args.force and source_id in existing_sources:
            print(f"    Skipped (already in Qdrant, use --force to re-ingest)")
            continue

        text = filepath.read_text(encoding="utf-8", errors="replace")
        chunks = chunk_markdown(text, source_id)
        print(f"    {len(text):,} chars -> {len(chunks)} chunks")
        total_chunks += len(chunks)

        if args.dry_run:
            continue

        if not chunks:
            continue

        # Delete old points for this source before upserting
        if args.force:
            client.delete(
                collection_name=COLLECTION,
                points_selector=FilterSelector(
                    filter=Filter(
                        must=[FieldCondition(key="source", match=MatchValue(value=source_id))]
                    )
                ),
            )

        # Embed
        texts = [c["content"] for c in chunks]
        embeddings = embed_texts(texts, api_key)

        # Upsert points
        points = []
        for i, (chunk, emb) in enumerate(zip(chunks, embeddings)):
            points.append(PointStruct(
                id=point_id(source_id, i),
                vector=emb,
                payload={
                    "source": chunk["source"],
                    "section": chunk["section"],
                    "chunk_index": i,
                    "content": chunk["content"],
                    "metadata": {"ingested_by": "ingest-qdrant.py"},
                },
            ))

        # Upsert in batches of 100
        for j in range(0, len(points), 100):
            client.upsert(COLLECTION, points=points[j : j + 100])

        total_embedded += len(chunks)
        print(f"    Upserted {len(chunks)} points")

    # DB schema
    if not args.source:
        print("\n  db-schema")
        if not args.force and "db-schema" in existing_sources:
            print("    Skipped (already in Qdrant)")
        else:
            schema_chunks = fetch_db_schema()
            total_chunks += len(schema_chunks)

            if not args.dry_run and schema_chunks:
                if args.force:
                    client.delete(
                        collection_name=COLLECTION,
                        points_selector=FilterSelector(
                            filter=Filter(
                                must=[FieldCondition(key="source", match=MatchValue(value="db-schema"))]
                            )
                        ),
                    )

                texts = [c["content"] for c in schema_chunks]
                embeddings = embed_texts(texts, api_key)

                points = []
                for i, (chunk, emb) in enumerate(zip(schema_chunks, embeddings)):
                    points.append(PointStruct(
                        id=point_id("db-schema", i),
                        vector=emb,
                        payload={
                            "source": chunk["source"],
                            "section": chunk["section"],
                            "chunk_index": i,
                            "content": chunk["content"],
                            "metadata": {"ingested_by": "ingest-qdrant.py"},
                        },
                    ))

                for j in range(0, len(points), 100):
                    client.upsert(COLLECTION, points=points[j : j + 100])

                total_embedded += len(schema_chunks)
                print(f"    Upserted {len(schema_chunks)} points")

    # Report
    info = client.get_collection(COLLECTION)
    print(f"\n{'=' * 50}")
    print(f"  Chunks processed: {total_chunks}")
    if not args.dry_run:
        print(f"  Chunks embedded:  {total_embedded}")
    print(f"  Collection total:  {info.points_count} points")
    print(f"  Collection status: {info.status}")
    print(f"{'=' * 50}")


if __name__ == "__main__":
    main()
