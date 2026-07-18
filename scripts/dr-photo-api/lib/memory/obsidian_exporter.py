"""
BOSS Obsidian Vault Exporter

Purpose: Export memory graph to Obsidian markdown vault
Features: Entity → markdown files, WikiLinks for relationships, YAML frontmatter
Sync: Bidirectional (Obsidian edits → BOSS database)

Generated: 2025-11-15
Authority: Phase 5 - Knowledge Layer Implementation
"""

import os
import re
from typing import List, Dict, Any, Optional
from pathlib import Path
from datetime import datetime
import logging

from .graph import MemoryGraph

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class ObsidianExporter:
    """
    Obsidian Vault Exporter - Export memory graph to Obsidian

    Creates markdown files with:
    - YAML frontmatter (metadata)
    - WikiLinks for relationships ([[Entity Name]])
    - Backlinks automatically handled by Obsidian
    - Daily notes for timeline
    """

    def __init__(self, vault_path: str):
        """
        Initialize Obsidian Exporter.

        Args:
            vault_path: Path to Obsidian vault directory
        """
        self.vault_path = Path(vault_path)
        self.vault_path.mkdir(parents=True, exist_ok=True)

        # Create folder structure
        self.folders = {
            "person": self.vault_path / "People",
            "company": self.vault_path / "Companies",
            "project": self.vault_path / "Projects",
            "document": self.vault_path / "Documents" / "Emails",  # Emails in subfolder
            "conversation": self.vault_path / "Conversations",
            "event": self.vault_path / "Events",
            "location": self.vault_path / "Locations",
            "financial": self.vault_path / "Financial",
        }

        for folder in self.folders.values():
            folder.mkdir(parents=True, exist_ok=True)

        # Create daily notes folder
        self.daily_notes = self.vault_path / "Daily Notes"
        self.daily_notes.mkdir(parents=True, exist_ok=True)

        logger.info(f"Obsidian vault initialized at: {vault_path}")

    # ========================================================================
    # EXPORT OPERATIONS
    # ========================================================================

    def export_entity(self, entity: Dict[str, Any], relationships: List[Dict[str, Any]]) -> Path:
        """
        Export single entity to markdown file.

        Args:
            entity: Entity dict from MemoryGraph
            relationships: List of relationships for this entity

        Returns:
            Path to created markdown file
        """
        entity_type = entity["type"]
        entity_name = entity["name"]
        metadata = entity.get("metadata", {})

        # Get folder for entity type
        folder = self.folders.get(entity_type, self.vault_path / "Other")

        # For documents (emails), route to Inbox or Sent subfolder based on sender
        if entity_type == "document" and metadata.get("document_type") == "email":
            sender = metadata.get("sender", "").lower()
            user_email = os.getenv("MS_GRAPH_USER_EMAIL", "hein@blitzfibre.com").lower()

            if sender == user_email:
                # Email sent by user → Sent folder
                folder = folder / "Sent"
            else:
                # Email received by user → Inbox folder
                folder = folder / "Inbox"

        folder.mkdir(parents=True, exist_ok=True)

        # Create filename (sanitize)
        filename = self._sanitize_filename(entity_name) + ".md"
        file_path = folder / filename

        # Build markdown content
        content = self._build_markdown(entity, relationships)

        # Write file
        file_path.write_text(content, encoding="utf-8")

        logger.info(f"Exported {entity_type}: {entity_name} → {file_path}")

        return file_path

    def export_all_entities(self) -> int:
        """
        Export all entities from memory graph to Obsidian vault.

        Returns:
            Number of entities exported
        """
        count = 0

        with MemoryGraph() as graph:
            # Get all active entities
            cursor = graph.conn.cursor()
            cursor.execute("""
                SELECT id, entity_type as type, name, attributes as metadata, created_at, updated_at
                FROM entities
                WHERE deleted_at IS NULL
                ORDER BY entity_type, name
            """)

            entities = cursor.fetchall()

            for row in entities:
                entity = {
                    "id": row[0],
                    "type": row[1],
                    "name": row[2],
                    "metadata": row[3],
                    "created_at": row[4],
                    "updated_at": row[5]
                }

                # Get relationships for this entity
                relationships = graph.get_relationships(entity["id"], direction="both")

                # Export to markdown
                self.export_entity(entity, relationships)
                count += 1

        logger.info(f"Exported {count} entities to Obsidian vault")
        return count

    def export_daily_note(self, date: datetime) -> Path:
        """
        Export daily note with events and activities for a specific date.

        Args:
            date: Date for daily note

        Returns:
            Path to daily note file
        """
        date_str = date.strftime("%Y-%m-%d")
        filename = f"{date_str}.md"
        file_path = self.daily_notes / filename

        with MemoryGraph() as graph:
            # Get events for this date
            cursor = graph.conn.cursor()
            cursor.execute("""
                SELECT
                    e.event_type,
                    e.event_data,
                    e.created_at,
                    ent.name AS entity_name,
                    ent.type AS entity_type
                FROM events e
                LEFT JOIN entities ent ON e.entity_id = ent.id
                WHERE DATE(e.created_at) = %s
                ORDER BY e.created_at
            """, (date_str,))

            events = cursor.fetchall()

        # Build daily note content
        content = f"# {date.strftime('%A, %B %d, %Y')}\n\n"
        content += "## Timeline\n\n"

        if events:
            for event in events:
                event_type = event[0]
                event_data = event[1]
                timestamp = event[2].strftime("%H:%M")
                entity_name = event[3] or "Unknown"
                entity_type = event[4] or "unknown"

                # Create WikiLink to entity
                entity_link = f"[[{entity_name}]]"

                content += f"- **{timestamp}** - {event_type}: {entity_link}\n"

                # Add event data details
                if event_data:
                    for key, value in event_data.items():
                        content += f"  - {key}: {value}\n"

            content += "\n"
        else:
            content += "_No events recorded for this date._\n\n"

        # Add metadata section
        content += "## Entities Created Today\n\n"
        content += "_Auto-generated from BOSS Memory Graph_\n"

        # Write file
        file_path.write_text(content, encoding="utf-8")

        logger.info(f"Exported daily note: {date_str}")

        return file_path

    # ========================================================================
    # MARKDOWN BUILDING
    # ========================================================================

    def _build_markdown(self, entity: Dict[str, Any], relationships: List[Dict[str, Any]]) -> str:
        """Build markdown content for entity."""

        entity_type = entity["type"]
        entity_name = entity["name"]
        metadata = entity.get("metadata", {})
        created_at = entity.get("created_at", "")
        updated_at = entity.get("updated_at", "")

        # YAML frontmatter
        content = "---\n"
        content += f"type: {entity_type}\n"
        content += f"created: {created_at}\n"
        content += f"updated: {updated_at}\n"

        # Add metadata fields
        for key, value in metadata.items():
            if isinstance(value, (str, int, float, bool)):
                content += f"{key}: {value}\n"

        content += "tags:\n"
        content += f"  - {entity_type}\n"

        # Add source tag if available
        if "source" in metadata:
            content += f"  - {metadata['source']}\n"

        content += "---\n\n"

        # Title
        content += f"# {entity_name}\n\n"

        # Type badge
        type_emoji = {
            "person": "👤",
            "company": "🏢",
            "project": "📊",
            "document": "📄",
            "conversation": "💬",
            "event": "📅",
            "location": "📍",
            "financial": "💰"
        }
        emoji = type_emoji.get(entity_type, "📌")
        content += f"**Type:** {emoji} {entity_type.title()}\n\n"

        # Metadata section (exclude body and is_html from metadata list)
        if metadata:
            content += "## Details\n\n"
            for key, value in metadata.items():
                if key not in ["source", "body", "is_html"]:  # source in frontmatter, body in separate section
                    content += f"- **{key.title()}:** {value}\n"
            content += "\n"

        # Email body content section (for emails)
        if metadata.get("document_type") == "email" and metadata.get("body"):
            content += "## Email Content\n\n"

            email_body = metadata.get("body", "")
            is_html = metadata.get("is_html", False)

            # If HTML, add note and strip HTML for basic readability
            if is_html:
                content += "_Note: This email contains HTML formatting. Displaying text content only._\n\n"
                # Basic HTML stripping for readability
                import re
                # Remove script and style elements
                email_body = re.sub(r'<script[^>]*>.*?</script>', '', email_body, flags=re.DOTALL | re.IGNORECASE)
                email_body = re.sub(r'<style[^>]*>.*?</style>', '', email_body, flags=re.DOTALL | re.IGNORECASE)
                # Remove HTML tags
                email_body = re.sub(r'<[^>]+>', '', email_body)
                # Convert HTML entities
                email_body = email_body.replace('&nbsp;', ' ')
                email_body = email_body.replace('&lt;', '<')
                email_body = email_body.replace('&gt;', '>')
                email_body = email_body.replace('&amp;', '&')
                email_body = email_body.replace('&quot;', '"')
                # Clean up extra whitespace
                email_body = re.sub(r'\n\s*\n\s*\n', '\n\n', email_body)

            # Wrap in blockquote for visual distinction
            content += "---\n\n"
            content += f"{email_body.strip()}\n\n"
            content += "---\n\n"

        # Relationships section
        if relationships:
            content += "## Relationships\n\n"

            # Group by relationship type
            rel_groups = {}
            for rel in relationships:
                rel_type = rel["relationship_type"]
                if rel_type not in rel_groups:
                    rel_groups[rel_type] = []
                rel_groups[rel_type].append(rel)

            for rel_type, rels in rel_groups.items():
                content += f"### {rel_type.replace('_', ' ').title()}\n\n"

                for rel in rels:
                    # Determine if this entity is source or target
                    if str(rel["from_entity_id"]) == str(entity["id"]):
                        # Outgoing relationship
                        other_name = rel["to_entity_name"]
                        direction = "→"
                    else:
                        # Incoming relationship
                        other_name = rel["from_entity_name"]
                        direction = "←"

                    # Create WikiLink
                    content += f"- {direction} [[{other_name}]]"

                    # Add relationship metadata
                    rel_metadata = rel.get("metadata", {})
                    if rel_metadata:
                        details = ", ".join(f"{k}: {v}" for k, v in rel_metadata.items())
                        content += f" _{details}_"

                    content += "\n"

                content += "\n"

        # Notes section (user can add here)
        content += "## Notes\n\n"
        content += "_Add your notes here..._\n\n"

        # Timestamp
        content += "---\n"
        content += f"_Last exported: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}_\n"
        content += f"_Source: BOSS Memory Graph_\n"

        return content

    # ========================================================================
    # IMPORT FROM OBSIDIAN (SYNC BACK)
    # ========================================================================

    def import_from_obsidian(self) -> int:
        """
        Import entities from Obsidian vault back to memory graph.

        Parses YAML frontmatter and WikiLinks to update database.

        Returns:
            Number of entities imported/updated
        """
        count = 0

        with MemoryGraph() as graph:
            # Scan all entity folders
            for entity_type, folder in self.folders.items():
                if not folder.exists():
                    continue

                # Process each markdown file
                for md_file in folder.glob("*.md"):
                    try:
                        entity_data = self._parse_markdown(md_file)

                        if entity_data:
                            # Check if entity exists
                            existing = graph.get_entity_by_name(
                                entity_data["name"],
                                entity_type=entity_type
                            )

                            if existing:
                                # Update existing entity
                                graph.update_entity(
                                    existing["id"],
                                    metadata=entity_data["metadata"]
                                )
                                logger.info(f"Updated {entity_type}: {entity_data['name']}")
                            else:
                                # Create new entity
                                graph.create_entity(
                                    entity_type=entity_type,
                                    name=entity_data["name"],
                                    metadata=entity_data["metadata"]
                                )
                                logger.info(f"Created {entity_type}: {entity_data['name']}")

                            count += 1

                    except Exception as e:
                        logger.error(f"Failed to import {md_file}: {e}")

        logger.info(f"Imported {count} entities from Obsidian vault")
        return count

    def _parse_markdown(self, file_path: Path) -> Optional[Dict[str, Any]]:
        """Parse markdown file and extract entity data."""

        content = file_path.read_text(encoding="utf-8")

        # Extract YAML frontmatter
        frontmatter_match = re.match(r'^---\n(.*?)\n---', content, re.DOTALL)
        if not frontmatter_match:
            return None

        frontmatter = frontmatter_match.group(1)

        # Parse YAML (simple parsing, not full YAML parser)
        metadata = {}
        for line in frontmatter.split('\n'):
            if ': ' in line and not line.strip().startswith('-'):
                key, value = line.split(': ', 1)
                key = key.strip()
                value = value.strip()

                # Skip system fields
                if key in ['type', 'created', 'updated', 'tags']:
                    continue

                metadata[key] = value

        # Extract name from title (first # heading)
        title_match = re.search(r'^# (.+)$', content, re.MULTILINE)
        if not title_match:
            return None

        name = title_match.group(1).strip()

        return {
            "name": name,
            "metadata": metadata
        }

    # ========================================================================
    # HELPER FUNCTIONS
    # ========================================================================

    def _sanitize_filename(self, name: str) -> str:
        """Sanitize entity name for filename."""
        # Remove invalid characters (including tabs and newlines)
        name = re.sub(r'[<>:"/\\|?*\t\n\r]', '', name)
        # Replace multiple spaces with single space
        name = re.sub(r'\s+', ' ', name)
        # Strip leading/trailing spaces
        name = name.strip()
        # Limit length
        if len(name) > 200:
            name = name[:200]
        return name


# ============================================================================
# CONVENIENCE FUNCTIONS
# ============================================================================

def get_exporter(vault_path: str) -> ObsidianExporter:
    """Get an ObsidianExporter instance."""
    return ObsidianExporter(vault_path=vault_path)


def export_to_obsidian(vault_path: str) -> int:
    """Export all entities to Obsidian vault."""
    exporter = get_exporter(vault_path)
    return exporter.export_all_entities()


def import_from_obsidian(vault_path: str) -> int:
    """Import entities from Obsidian vault to memory graph."""
    exporter = get_exporter(vault_path)
    return exporter.import_from_obsidian()
