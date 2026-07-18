"""
BOSS Entity Extraction Service

Purpose: Extract entities (people, companies, projects) from text
Architecture: Hybrid NER (spaCy + GPT-4o-mini fallback)
Cost Optimization: 80% free (spaCy), 20% paid (GPT-4o-mini for complex cases)

Generated: 2025-11-15
Authority: Phase 5 - Knowledge Layer Implementation
"""

import os
import re
import json
from typing import List, Dict, Any, Optional, Tuple, Set
from datetime import datetime
import logging
from html import unescape

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Import for LLM fallback
try:
    from anthropic import Anthropic
    ANTHROPIC_AVAILABLE = True
except ImportError:
    ANTHROPIC_AVAILABLE = False
    logger.warning("Anthropic SDK not available - Claude fallback disabled")

# Import for Gemini fallback (alternative to Anthropic)
try:
    import google.generativeai as genai
    GEMINI_AVAILABLE = True
except ImportError:
    GEMINI_AVAILABLE = False
    logger.warning("Google Generative AI SDK not available - Gemini fallback disabled")

# Import for spaCy NER
try:
    import spacy
    SPACY_AVAILABLE = True
except ImportError:
    SPACY_AVAILABLE = False
    logger.warning("spaCy not available - using rule-based extraction only")


class EntityExtractor:
    """
    Entity Extraction Service - Extract entities from text

    Uses hybrid approach:
    1. Rule-based extraction (FREE) - emails, phones, URLs
    2. spaCy NER (FREE) - people, organizations, locations
    3. LLM fallback (PAID) - complex cases, relationship extraction

    Cost optimization: ~80% free, ~20% paid for complex cases
    """

    def __init__(self, use_llm_fallback: bool = True, llm_provider: str = "auto"):
        """
        Initialize Entity Extractor.

        Args:
            use_llm_fallback: Enable LLM for complex entity extraction (costs money)
            llm_provider: LLM provider to use - "anthropic", "gemini", or "auto" (try both)
        """
        self.llm_provider = llm_provider
        self.use_llm_fallback = use_llm_fallback

        # Initialize spaCy model
        self.nlp = None
        if SPACY_AVAILABLE:
            try:
                self.nlp = spacy.load("en_core_web_sm")
                logger.info("spaCy model loaded (en_core_web_sm)")
            except OSError:
                logger.warning("spaCy model not found - install with: python -m spacy download en_core_web_sm")

        # Initialize Anthropic client
        self.anthropic = None
        if self.use_llm_fallback and ANTHROPIC_AVAILABLE and llm_provider in ["anthropic", "auto"]:
            api_key = os.getenv("ANTHROPIC_API_KEY")
            if api_key:
                self.anthropic = Anthropic(api_key=api_key)
                logger.info("Anthropic client initialized for LLM fallback")

        # Initialize Gemini client (alternative to Anthropic)
        self.gemini_model = None
        if self.use_llm_fallback and GEMINI_AVAILABLE and llm_provider in ["gemini", "auto"]:
            api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
            if api_key:
                genai.configure(api_key=api_key)
                # Use gemini-2.0-flash-exp for latest and fastest model
                self.gemini_model = genai.GenerativeModel("gemini-2.0-flash-exp")
                logger.info("Gemini client initialized for LLM fallback (gemini-2.0-flash-exp)")

        # Check if any LLM is available
        if self.use_llm_fallback and not self.anthropic and not self.gemini_model:
            logger.warning("No LLM API key found - LLM fallback disabled (set ANTHROPIC_API_KEY or GEMINI_API_KEY)")
            self.use_llm_fallback = False

        # Known project names (from BOSS context)
        self.known_projects = {
            "blitz", "blitz fibre", "velocity", "velocity fibre",
            "lmc", "h10", "vortex", "life arrow", "boss"
        }

        # Common company suffixes
        self.company_suffixes = {
            "inc", "inc.", "llc", "llc.", "ltd", "ltd.", "corp", "corp.",
            "corporation", "company", "co.", "pty", "pty.", "holdings",
            "(pty) ltd", "proprietary", "limited"
        }

        # Junk entity filters (HTML/CSS artifacts, font names, etc.)
        self._junk_patterns = self._build_junk_patterns()

    # ========================================================================
    # HTML/CSS CONTENT CLEANING (NEW - Prevents junk entities)
    # ========================================================================

    def _build_junk_patterns(self) -> Dict[str, Set[str]]:
        """Build patterns to filter junk entities from HTML/CSS content."""
        return {
            # CSS keywords that spaCy incorrectly tags as entities
            "css_keywords": {
                "font-family", "font-size", "font-weight", "font-style",
                "line-height", "text-align", "text-decoration", "text-transform",
                "margin", "margin-top", "margin-bottom", "margin-left", "margin-right",
                "padding", "padding-top", "padding-bottom", "padding-left", "padding-right",
                "border", "border-top", "border-bottom", "border-left", "border-right",
                "border-radius", "border-color", "border-style", "border-width",
                "background", "background-color", "background-image", "background-size",
                "color", "display", "position", "width", "height", "max-width", "max-height",
                "min-width", "min-height", "overflow", "visibility", "opacity",
                "flex", "flex-direction", "justify-content", "align-items",
                "grid", "grid-template", "grid-gap", "float", "clear",
                "z-index", "top", "bottom", "left", "right",
                "rgb", "rgba", "hsl", "hsla", "inherit", "initial", "auto", "none",
                "solid", "dashed", "dotted", "normal", "bold", "italic",
                "block", "inline", "inline-block", "flex", "grid",
                "absolute", "relative", "fixed", "sticky",
                "center", "left", "right", "justify", "baseline",
                "cellspacing", "cellpadding", "colspan", "rowspan",
                "valign", "halign", "nowrap", "bgcolor",
            },
            # Common font names (often extracted as PERSON entities)
            "font_names": {
                "helvetica", "helvetica neue", "arial", "verdana", "tahoma",
                "georgia", "times", "times new roman", "courier", "courier new",
                "palatino", "lucida", "lucida grande", "lucida sans", "lucida console",
                "comic sans", "comic sans ms", "impact", "trebuchet", "trebuchet ms",
                "segoe", "segoe ui", "roboto", "open sans", "lato", "montserrat",
                "source sans", "source sans pro", "noto", "noto sans",
                "ubuntu", "droid", "droid sans", "calibri", "cambria", "consolas",
                "franklin", "franklin gothic", "futura", "garamond", "gill", "gill sans",
                "sans-serif", "serif", "monospace", "system-ui", "ui-sans-serif",
                "sf pro", "sf pro display", "sf pro text", "apple system",
                "-apple-system", "blinkmacsystemfont", "system", "system font",
            },
            # HTML attribute names/values
            "html_attributes": {
                "charset", "utf-8", "http-equiv", "content-type", "viewport",
                "text/html", "text/css", "text/javascript", "application/json",
                "microsoft", "office", "word", "outlook", "mso", "msonormal",
                "windowtext", "shapetype", "shapeid", "textbox",
                "xmlns", "xlink", "href", "onclick", "onload", "onsubmit",
                "class", "style", "type", "name", "value", "action",
            },
            # Microsoft Office specific artifacts
            "mso_artifacts": {
                "mso-border-alt", "mso-padding-alt", "mso-border-top-alt",
                "mso-border-left-alt", "mso-border-right-alt", "mso-border-bottom-alt",
                "mso-font-charset", "mso-generic-font-family", "mso-font-pitch",
                "mso-font-signature", "mso-style-name", "mso-style-parent",
                "mso-style-link", "mso-style-type", "mso-outline-level",
                "mso-ansi-language", "mso-fareast-language", "mso-bidi-language",
                "mso-table-lspace", "mso-table-rspace", "mso-table-anchor-horizontal",
                "mso-element", "mso-para-margin", "mso-char-wrap", "mso-kinsoku-overflow",
            },
            # MIME/email artifacts
            "mime_artifacts": {
                "content-type", "content-transfer-encoding", "content-disposition",
                "multipart/mixed", "multipart/alternative", "text/plain",
                "quoted-printable", "base64", "7bit", "8bit", "boundary",
                "message-id", "mime-version", "x-mailer", "x-originating-ip",
            },
            # Generic junk patterns
            "generic_junk": {
                "px", "pt", "em", "rem", "%", "vh", "vw",
                "true", "false", "null", "undefined",
                "https", "http", "www", "href", "src",
                "class", "id", "name", "type",
            }
        }

    def _clean_html_content(self, text: str) -> str:
        """
        Strip HTML/CSS content before entity extraction.

        This prevents spaCy from extracting junk entities like:
        - Font names (Helvetica Neue, Arial, etc.)
        - CSS properties (font-family, margin, etc.)
        - Base64-encoded strings
        - MIME boundaries
        - HTML attribute values

        Args:
            text: Raw text that may contain HTML/CSS

        Returns:
            Cleaned text suitable for NER
        """
        if not text:
            return ""

        # 1. Remove <style> blocks entirely
        text = re.sub(r'<style[^>]*>[\s\S]*?</style>', ' ', text, flags=re.IGNORECASE)

        # 2. Remove <script> blocks entirely
        text = re.sub(r'<script[^>]*>[\s\S]*?</script>', ' ', text, flags=re.IGNORECASE)

        # 3. Remove HTML comments
        text = re.sub(r'<!--[\s\S]*?-->', ' ', text)

        # 4. Remove CSS @rules (@media, @font-face, @import, etc.)
        text = re.sub(r'@[a-z-]+\s*\{[^}]*\}', ' ', text, flags=re.IGNORECASE)
        text = re.sub(r'@[a-z-]+\s+[^;{]+[;{]', ' ', text, flags=re.IGNORECASE)

        # 5. Remove inline styles (style="...")
        text = re.sub(r'style\s*=\s*["\'][^"\']*["\']', ' ', text, flags=re.IGNORECASE)

        # 6. Remove CSS property declarations (property: value;)
        text = re.sub(r'[a-z-]+\s*:\s*[^;{}]+;', ' ', text, flags=re.IGNORECASE)

        # 7. Remove color values (rgb, rgba, hex, hsl)
        text = re.sub(r'#[0-9a-fA-F]{3,8}\b', ' ', text)
        text = re.sub(r'rgba?\s*\([^)]+\)', ' ', text, flags=re.IGNORECASE)
        text = re.sub(r'hsla?\s*\([^)]+\)', ' ', text, flags=re.IGNORECASE)

        # 8. Remove base64-encoded strings (20+ characters)
        text = re.sub(r'[A-Za-z0-9+/=]{20,}', ' ', text)

        # 9. Remove MIME boundaries
        text = re.sub(r'--[=-]+[a-zA-Z0-9_-]+[=-]*', ' ', text)
        text = re.sub(r'boundary\s*=\s*["\']?[^"\';\s]+', ' ', text, flags=re.IGNORECASE)

        # 10. Remove HTML tags but keep content
        text = re.sub(r'<[^>]+>', ' ', text)

        # 11. Remove HTML entities and decode
        text = unescape(text)

        # 12. Remove Microsoft Office artifacts
        text = re.sub(r'mso-[a-z-]+\s*:[^;]+;?', ' ', text, flags=re.IGNORECASE)
        text = re.sub(r'<!--\[if\s+[^\]]+\]>[\s\S]*?<!\[endif\]-->', ' ', text, flags=re.IGNORECASE)

        # 13. Remove XML/XMLNS declarations
        text = re.sub(r'xmlns\s*=\s*["\'][^"\']+["\']', ' ', text, flags=re.IGNORECASE)

        # 14. Remove numeric-heavy strings (likely data, not names)
        text = re.sub(r'\b[0-9a-fA-F]{8,}\b', ' ', text)  # Long hex strings

        # 15. Normalize whitespace
        text = re.sub(r'\s+', ' ', text).strip()

        return text

    def _is_valid_entity_name(self, name: str, entity_type: str) -> bool:
        """
        Validate entity name to filter out junk.

        Args:
            name: Entity name to validate
            entity_type: Type of entity (person, company, etc.)

        Returns:
            True if valid, False if junk
        """
        if not name:
            return False

        name_lower = name.lower().strip()
        name_stripped = name.strip()

        # 1. Too short (less than 2 characters)
        if len(name_stripped) < 2:
            return False

        # 2. Too long (probably not a real entity name)
        if len(name_stripped) > 100:
            return False

        # 3. Check against junk patterns
        for category, patterns in self._junk_patterns.items():
            if name_lower in patterns:
                logger.debug(f"Filtered junk entity '{name}' (matched {category})")
                return False

        # 4. More than 70% digits (likely data, not a name)
        digit_count = sum(1 for c in name_stripped if c.isdigit())
        if len(name_stripped) > 0 and digit_count / len(name_stripped) > 0.7:
            return False

        # 5. Contains CSS-like patterns or Microsoft Office artifacts
        css_patterns = [
            r'^\d+px$', r'^\d+pt$', r'^\d+em$', r'^\d+rem$', r'^\d+%$',
            r'^#[0-9a-fA-F]+$',  # Hex colors
            r'^rgba?\(', r'^hsla?\(',  # Color functions
            r'^\.[a-zA-Z]',  # CSS class selector
            r'^[a-z-]+:',  # CSS property
            r'^mso-',  # Microsoft Office CSS properties
            r'^-webkit-', r'^-moz-', r'^-ms-', r'^-o-',  # Browser-specific prefixes
        ]
        for pattern in css_patterns:
            if re.match(pattern, name_stripped, re.IGNORECASE):
                return False

        # 6. Check for font name patterns
        font_indicators = ['sans', 'serif', 'mono', 'medium', 'regular', 'bold', 'light', 'thin', 'black', 'condensed', 'extended', 'narrow', 'wide']
        name_parts = name_lower.split()
        if len(name_parts) >= 2:
            # If ends with font weight/style indicators
            if name_parts[-1] in font_indicators:
                # Check if it looks like a font name
                for font in self._junk_patterns["font_names"]:
                    if font in name_lower:
                        return False

        # 7. Reject pure HTML/CSS noise
        noise_patterns = [
            r'^[\W\d]+$',  # Only non-word characters and digits
            r'^[_\-\.\s]+$',  # Only underscores, dashes, dots, spaces
            r'^\d+x\d+$',  # Dimensions like "100x200"
            r'^v\d+(\.\d+)*$',  # Version numbers like "v1.2.3"
        ]
        for pattern in noise_patterns:
            if re.match(pattern, name_stripped, re.IGNORECASE):
                return False

        # 8. Check for base64-like strings
        if len(name_stripped) > 15:
            # High entropy, likely encoded
            char_set = set(name_stripped)
            if len(char_set) < len(name_stripped) * 0.3:
                # Too few unique characters for length = likely encoding
                pass  # Allow, could be repeated chars in real names
            elif re.match(r'^[A-Za-z0-9+/=]+$', name_stripped):
                # Pure base64 alphabet
                return False

        # 9. Person-specific validation
        if entity_type == "person":
            # Names should contain at least one letter
            if not any(c.isalpha() for c in name_stripped):
                return False
            # Names shouldn't start with numbers
            if name_stripped[0].isdigit():
                return False

        return True

    # ========================================================================
    # EMAIL ENTITY EXTRACTION
    # ========================================================================

    def extract_from_email(
        self,
        email_dict: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Extract entities from email message.

        Args:
            email_dict: Email data with keys: from, to, cc, subject, body

        Returns:
            Dict with extracted entities and relationships:
            {
                "entities": [
                    {"type": "person", "name": "...", "metadata": {...}},
                    {"type": "company", "name": "...", "metadata": {...}},
                    ...
                ],
                "relationships": [
                    {"from": "person:John", "to": "project:Blitz", "type": "works_on"},
                    ...
                ],
                "confidence": 0.85
            }
        """
        entities = []
        relationships = []

        # Extract sender
        sender_email = email_dict.get("from", "")
        sender_name = self._extract_name_from_email_address(sender_email)
        if sender_name:
            entities.append({
                "type": "person",
                "name": sender_name,
                "metadata": {
                    "email": self._extract_email(sender_email),
                    "source": "email_sender"
                }
            })

        # Extract recipients
        recipients = []
        for recipient_field in ["to", "cc"]:
            recipient_list = email_dict.get(recipient_field, "")
            if isinstance(recipient_list, str):
                recipient_list = [recipient_list]
            for recipient_email in recipient_list:
                recipient_name = self._extract_name_from_email_address(recipient_email)
                if recipient_name:
                    entities.append({
                        "type": "person",
                        "name": recipient_name,
                        "metadata": {
                            "email": self._extract_email(recipient_email),
                            "source": "email_recipient"
                        }
                    })
                    recipients.append(recipient_name)

                    # Create relationship: sender -> recipient (sent_to)
                    if sender_name:
                        relationships.append({
                            "from": f"person:{sender_name}",
                            "to": f"person:{recipient_name}",
                            "type": "sent_to",
                            "metadata": {
                                "medium": "email",
                                "timestamp": email_dict.get("timestamp")
                            }
                        })

        # Extract entities from subject and body
        text = f"{email_dict.get('subject', '')} {email_dict.get('body', '')}"
        text_entities = self._extract_from_text(text)

        # Merge text entities
        for entity in text_entities["entities"]:
            # Mark source
            entity["metadata"]["source"] = "email_content"
            entities.append(entity)

        # Merge text relationships
        relationships.extend(text_entities["relationships"])

        # Create conversation entity
        conversation_id = email_dict.get("id") or email_dict.get("message_id")
        if conversation_id:
            entities.append({
                "type": "conversation",
                "name": f"Email: {email_dict.get('subject', 'No Subject')}",
                "metadata": {
                    "conversation_id": conversation_id,
                    "medium": "email",
                    "subject": email_dict.get("subject"),
                    "timestamp": email_dict.get("timestamp"),
                    "participants": [sender_name] + recipients
                }
            })

        # Calculate confidence
        confidence = self._calculate_confidence(entities, use_llm=False)

        return {
            "entities": self._deduplicate_entities(entities),
            "relationships": relationships,
            "confidence": confidence
        }

    # ========================================================================
    # WHATSAPP ENTITY EXTRACTION
    # ========================================================================

    def extract_from_whatsapp(
        self,
        message_dict: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Extract entities from WhatsApp message.

        Args:
            message_dict: WhatsApp data with keys: from, body, timestamp, chat_id

        Returns:
            Dict with extracted entities and relationships
        """
        entities = []
        relationships = []

        # Extract sender
        sender_phone = message_dict.get("from", "")
        sender_name = message_dict.get("sender_name") or self._extract_name_from_phone(sender_phone)

        if sender_name:
            entities.append({
                "type": "person",
                "name": sender_name,
                "metadata": {
                    "phone": sender_phone,
                    "source": "whatsapp_sender"
                }
            })

        # Extract entities from message body
        text = message_dict.get("body", "")
        text_entities = self._extract_from_text(text)

        # Merge text entities
        for entity in text_entities["entities"]:
            entity["metadata"]["source"] = "whatsapp_content"
            entities.append(entity)

        relationships.extend(text_entities["relationships"])

        # Create conversation entity
        chat_id = message_dict.get("chat_id")
        if chat_id:
            entities.append({
                "type": "conversation",
                "name": f"WhatsApp Chat: {chat_id}",
                "metadata": {
                    "conversation_id": chat_id,
                    "medium": "whatsapp",
                    "timestamp": message_dict.get("timestamp"),
                    "participants": [sender_name] if sender_name else []
                }
            })

        confidence = self._calculate_confidence(entities, use_llm=False)

        return {
            "entities": self._deduplicate_entities(entities),
            "relationships": relationships,
            "confidence": confidence
        }

    # ========================================================================
    # DOCUMENT ENTITY EXTRACTION
    # ========================================================================

    def extract_from_document(
        self,
        document_dict: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Extract entities from document.

        Args:
            document_dict: Document data with keys: title, text, metadata

        Returns:
            Dict with extracted entities and relationships
        """
        entities = []
        relationships = []

        # Extract from title and text
        title = document_dict.get("title", "")
        text = document_dict.get("text", "")
        full_text = f"{title} {text}"

        # Use spaCy or LLM for entity extraction
        text_entities = self._extract_from_text(full_text)

        # Merge entities
        for entity in text_entities["entities"]:
            entity["metadata"]["source"] = "document_content"
            entities.append(entity)

        relationships.extend(text_entities["relationships"])

        # Extract author from metadata if present
        metadata = document_dict.get("metadata", {})
        if isinstance(metadata, dict):
            author = metadata.get("author")
            if author and isinstance(author, str) and author.strip():
                entities.append({
                    "type": "person",
                    "name": author.strip(),
                    "metadata": {
                        "source": "document_metadata",
                        "role": "author",
                        "confidence": 0.95
                    }
                })
                # Create relationship between author and document
                doc_id = document_dict.get("id") or document_dict.get("file_path")
                if doc_id:
                    relationships.append({
                        "from_entity": author.strip(),
                        "to_entity": document_dict.get("title", doc_id),
                        "relationship_type": "authored",
                        "metadata": {
                            "source": "document_metadata"
                        }
                    })

        # Create document entity
        doc_id = document_dict.get("id") or document_dict.get("file_path")
        if doc_id:
            entities.append({
                "type": "document",
                "name": title or doc_id,
                "metadata": {
                    "document_id": doc_id,
                    "file_path": document_dict.get("file_path"),
                    "file_type": document_dict.get("file_type"),
                    "page_count": document_dict.get("page_count"),
                    "created_at": document_dict.get("created_at")
                }
            })

        confidence = self._calculate_confidence(entities, use_llm=False)

        return {
            "entities": self._deduplicate_entities(entities),
            "relationships": relationships,
            "confidence": confidence
        }

    # ========================================================================
    # TEXT ENTITY EXTRACTION (CORE)
    # ========================================================================

    def _extract_from_text(self, text: str) -> Dict[str, Any]:
        """
        Extract entities from raw text using hybrid approach.

        Strategy:
        0. Clean HTML/CSS content FIRST (prevents junk entities)
        1. Rule-based extraction (emails, phones, URLs) - FREE
        2. spaCy NER (people, organizations, locations) - FREE
        3. Project name matching (known projects) - FREE
        4. LLM fallback for complex cases - PAID (optional)
        5. Validate and filter all entities

        Args:
            text: Raw text to extract from

        Returns:
            Dict with entities and relationships
        """
        entities = []
        relationships = []

        # 0. CLEAN HTML/CSS content before processing (NEW - prevents junk entities)
        cleaned_text = self._clean_html_content(text)

        # Track junk entities for monitoring
        junk_count = 0

        # 1. Rule-based extraction (always run - FREE)
        # Note: Use original text for email/URL extraction (they may be in HTML attributes)
        rule_entities = self._extract_rule_based(text)
        for entity in rule_entities:
            if self._is_valid_entity_name(entity["name"], entity["type"]):
                entities.append(entity)
            else:
                junk_count += 1

        # 2. spaCy NER (if available - FREE) - use CLEANED text
        if self.nlp:
            spacy_entities = self._extract_spacy_ner(cleaned_text)
            for entity in spacy_entities:
                if self._is_valid_entity_name(entity["name"], entity["type"]):
                    entities.append(entity)
                else:
                    junk_count += 1

        # 3. Project name matching (FREE) - use cleaned text
        project_entities = self._extract_known_projects(cleaned_text)
        for entity in project_entities:
            if self._is_valid_entity_name(entity["name"], entity["type"]):
                entities.append(entity)
            else:
                junk_count += 1

        # 4. LLM extraction (ALWAYS use for comprehensive analysis - PAID)
        if self.use_llm_fallback:
            logger.info("Using LLM for comprehensive entity and relationship extraction")
            llm_result = self._extract_llm_fallback(cleaned_text)
            for entity in llm_result["entities"]:
                if self._is_valid_entity_name(entity.get("name", ""), entity.get("type", "")):
                    entities.append(entity)
                else:
                    junk_count += 1
            relationships.extend(llm_result["relationships"])

        # Log junk filtering stats
        if junk_count > 0:
            logger.info(f"Filtered {junk_count} junk entities from text extraction")

        return {
            "entities": entities,
            "relationships": relationships
        }

    # ========================================================================
    # RULE-BASED EXTRACTION
    # ========================================================================

    def _extract_rule_based(self, text: str) -> List[Dict[str, Any]]:
        """Extract entities using regex patterns."""
        entities = []

        # Extract email addresses
        email_pattern = r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b'
        emails = re.findall(email_pattern, text)
        for email in emails:
            name = self._extract_name_from_email_address(email)
            if name:
                entities.append({
                    "type": "person",
                    "name": name,
                    "metadata": {"email": email}
                })

        # Extract phone numbers (international and local)
        phone_pattern = r'\+?\d{1,3}[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,9}'
        phones = re.findall(phone_pattern, text)
        for phone in phones:
            if len(phone.replace('-', '').replace('.', '').replace(' ', '')) >= 10:
                entities.append({
                    "type": "person",
                    "name": f"Contact {phone}",
                    "metadata": {"phone": phone}
                })

        # Extract URLs
        url_pattern = r'https?://[^\s<>"{}|\\^`\[\]]+'
        urls = re.findall(url_pattern, text)
        for url in urls:
            entities.append({
                "type": "location",
                "name": url,
                "metadata": {"url": url}
            })

        return entities

    def _extract_spacy_ner(self, text: str) -> List[Dict[str, Any]]:
        """Extract entities using spaCy NER."""
        entities = []

        doc = self.nlp(text)

        for ent in doc.ents:
            # Map spaCy entity types to BOSS types
            if ent.label_ == "PERSON":
                entity_type = "person"
            elif ent.label_ in ["ORG", "PRODUCT"]:
                # Check if it's a known project
                if ent.text.lower() in self.known_projects:
                    entity_type = "project"
                else:
                    entity_type = "company"
            elif ent.label_ in ["GPE", "LOC", "FAC"]:
                entity_type = "location"
            elif ent.label_ == "MONEY":
                entity_type = "financial"
            elif ent.label_ == "EVENT":
                entity_type = "event"
            else:
                continue  # Skip other types

            entities.append({
                "type": entity_type,
                "name": ent.text,
                "metadata": {
                    "spacy_label": ent.label_,
                    "confidence": 0.8  # spaCy doesn't provide confidence scores
                }
            })

        return entities

    def _extract_known_projects(self, text: str) -> List[Dict[str, Any]]:
        """Extract known project names from text."""
        entities = []
        text_lower = text.lower()

        for project in self.known_projects:
            if project in text_lower:
                # Find exact case-sensitive match
                pattern = re.compile(re.escape(project), re.IGNORECASE)
                matches = pattern.finditer(text)
                for match in matches:
                    entities.append({
                        "type": "project",
                        "name": match.group(),  # Preserve original case
                        "metadata": {
                            "confidence": 0.95,  # High confidence for known projects
                            "source": "known_project_list"
                        }
                    })
                    break  # Only add once per project

        return entities

    # ========================================================================
    # LLM FALLBACK (ANTHROPIC CLAUDE)
    # ========================================================================

    def _extract_llm_fallback(self, text: str) -> Dict[str, Any]:
        """
        Extract entities using LLM when rule-based/spaCy fail.

        Supports multiple providers with automatic fallback:
        1. Anthropic Claude Haiku (~$0.15 per 1M tokens)
        2. Google Gemini Flash (FREE tier available)
        """
        # Truncate text to avoid excessive costs
        max_chars = 4000  # ~1000 tokens
        if len(text) > max_chars:
            text = text[:max_chars] + "..."

        prompt = f"""Extract entities and relationships from this text.

Text: {text}

IMPORTANT: Respond with ONLY valid JSON. No markdown, no explanation, no code blocks.

JSON structure:
{{"entities": [{{"type": "person", "name": "...", "metadata": {{"role": "..."}}}}], "relationships": []}}

Entity types: person, company, project, location, financial, event

Keep it simple - max 10 entities. Return valid JSON only, starting with {{ and ending with }}."""

        # Try Gemini first (free tier), then fall back to Anthropic
        if self.gemini_model:
            result = self._try_gemini_extraction(prompt)
            if result:
                return result

        # Fall back to Anthropic if Gemini failed or unavailable
        if self.anthropic:
            result = self._try_anthropic_extraction(prompt)
            if result:
                return result

        logger.warning("All LLM providers failed for entity extraction")
        return {"entities": [], "relationships": []}

    def _try_gemini_extraction(self, prompt: str) -> Optional[Dict[str, Any]]:
        """Try entity extraction using Google Gemini."""
        try:
            response = self.gemini_model.generate_content(
                prompt,
                generation_config=genai.types.GenerationConfig(
                    temperature=0,
                    max_output_tokens=2000,
                )
            )

            result_text = response.text
            # Clean up response (Gemini sometimes wraps in markdown code blocks)
            if result_text.startswith("```json"):
                result_text = result_text[7:]
            if result_text.startswith("```"):
                result_text = result_text[3:]
            if result_text.endswith("```"):
                result_text = result_text[:-3]
            result_text = result_text.strip()

            # Try to parse JSON, with fallback for malformed responses
            try:
                result = json.loads(result_text)
            except json.JSONDecodeError as json_err:
                # Try to extract just the JSON object using regex
                import re
                json_match = re.search(r'\{[\s\S]*\}', result_text)
                if json_match:
                    try:
                        result = json.loads(json_match.group())
                    except json.JSONDecodeError:
                        logger.warning(f"Gemini returned malformed JSON, falling back to empty result")
                        return None
                else:
                    logger.warning(f"Gemini returned non-JSON response: {result_text[:200]}")
                    return None

            logger.info(f"Gemini extracted {len(result.get('entities', []))} entities")

            return {
                "entities": result.get("entities", []),
                "relationships": result.get("relationships", [])
            }

        except Exception as e:
            logger.error(f"Gemini extraction failed: {e}")
            return None

    def _try_anthropic_extraction(self, prompt: str) -> Optional[Dict[str, Any]]:
        """Try entity extraction using Anthropic Claude."""
        try:
            response = self.anthropic.messages.create(
                model="claude-3-haiku-20240307",
                max_tokens=1000,
                temperature=0,
                messages=[{"role": "user", "content": prompt}]
            )

            result_text = response.content[0].text
            result = json.loads(result_text)

            logger.info(f"Claude extracted {len(result.get('entities', []))} entities")

            return {
                "entities": result.get("entities", []),
                "relationships": result.get("relationships", [])
            }

        except Exception as e:
            logger.error(f"Anthropic extraction failed: {e}")
            return None

    # ========================================================================
    # HELPER FUNCTIONS
    # ========================================================================

    def _extract_name_from_email_address(self, email_str: str) -> Optional[str]:
        """Extract person name from email address."""
        email = self._extract_email(email_str)
        if not email:
            return None

        # Check if name is in format "Name <email@domain.com>"
        match = re.match(r'"?([^"<]+)"?\s*<([^>]+)>', email_str)
        if match:
            return match.group(1).strip()

        # Extract from email local part (before @)
        local_part = email.split('@')[0]

        # Replace common separators with spaces
        name = local_part.replace('.', ' ').replace('_', ' ').replace('-', ' ')

        # Title case
        name = ' '.join(word.capitalize() for word in name.split())

        return name if len(name) > 2 else None

    def _extract_email(self, email_str: str) -> Optional[str]:
        """Extract email address from string."""
        match = re.search(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b', email_str)
        return match.group(0) if match else None

    def _extract_name_from_phone(self, phone: str) -> Optional[str]:
        """Extract name from phone number (placeholder for future contact lookup)."""
        # TODO: Integrate with contact database when available
        return f"Contact {phone[-4:]}"  # Last 4 digits as identifier

    def _deduplicate_entities(self, entities: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Remove duplicate entities based on type and name."""
        seen = set()
        unique_entities = []

        for entity in entities:
            key = (entity["type"], entity["name"].lower())
            if key not in seen:
                seen.add(key)
                unique_entities.append(entity)

        return unique_entities

    def _calculate_confidence(self, entities: List[Dict[str, Any]], use_llm: bool) -> float:
        """
        Calculate confidence score for extraction.

        Factors:
        - Number of entities found
        - Source diversity (rule-based, spaCy, LLM)
        - Entity metadata completeness
        """
        if not entities:
            return 0.0

        # Base confidence on number of entities
        base_confidence = min(len(entities) / 10.0, 0.7)  # Cap at 0.7

        # Boost for metadata completeness
        metadata_scores = []
        for entity in entities:
            metadata = entity.get("metadata", {})
            score = len(metadata) / 5.0  # Assume 5 useful metadata fields
            metadata_scores.append(min(score, 1.0))

        metadata_boost = sum(metadata_scores) / len(entities) * 0.2  # Up to 0.2

        # Boost if LLM was used (higher accuracy)
        llm_boost = 0.1 if use_llm else 0.0

        total_confidence = base_confidence + metadata_boost + llm_boost

        return min(total_confidence, 1.0)


# ============================================================================
# CONVENIENCE FUNCTIONS
# ============================================================================

def get_extractor(use_llm_fallback: bool = True) -> EntityExtractor:
    """Get an EntityExtractor instance."""
    return EntityExtractor(use_llm_fallback=use_llm_fallback)
