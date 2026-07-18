"""
Draft Personality Learning Engine

Analyzes sent emails to learn user's writing style, vocabulary, tone, and structure.
Applies learned personality to Claude-generated drafts for authentic communication.

Features:
- Vocabulary pattern extraction
- Sentence structure analysis
- Tone and formality scoring
- Opening/closing phrase detection
- Category-specific personalization
- Continuous learning from feedback
"""

import os
import re
import logging
from typing import List, Dict, Any, Optional
from dataclasses import dataclass, asdict
from datetime import datetime
from collections import Counter
import statistics

import asyncpg
from anthropic import Anthropic

logger = logging.getLogger(__name__)


@dataclass
class PersonalityProfile:
    """User's writing personality profile."""
    user_id: str
    category: str  # "all", "urgent", "client", "internal", etc.

    # Vocabulary
    common_words: Dict[str, int]  # Word frequency
    avoid_words: List[str]  # Words user never uses
    signature_phrases: List[str]  # Unique phrases

    # Structure
    avg_sentence_length: float
    avg_paragraph_length: float
    avg_email_length: int

    # Tone markers
    formality_score: float  # 0.0 = casual, 1.0 = formal
    enthusiasm_level: float  # 0.0 = neutral, 1.0 = enthusiastic
    politeness_score: float  # 0.0 = direct, 1.0 = polite

    # Phrases
    opening_phrases: List[str]
    closing_phrases: List[str]
    transition_phrases: List[str]

    # Metadata
    sample_count: int
    last_updated: datetime
    confidence: float  # 0.0-1.0, based on sample size


class DraftPersonalityEngine:
    """
    Learns user's email writing style from sent emails.
    Applies learned patterns to draft generation.
    """

    def __init__(
        self,
        db_url: Optional[str] = None,
        anthropic_api_key: Optional[str] = None
    ):
        """
        Initialize personality engine.

        Args:
            db_url: PostgreSQL connection URL (or from DATABASE_URL env)
            anthropic_api_key: Anthropic API key for pattern analysis
        """
        self.db_url = db_url or os.getenv("DATABASE_URL")
        if not self.db_url:
            raise ValueError("DATABASE_URL required for personality engine")

        self.anthropic_client = None
        if anthropic_api_key or os.getenv("ANTHROPIC_API_KEY"):
            self.anthropic_client = Anthropic(
                api_key=anthropic_api_key or os.getenv("ANTHROPIC_API_KEY")
            )

        self.db_pool: Optional[asyncpg.Pool] = None

        logger.info("Draft personality engine initialized")

    async def connect(self):
        """Connect to PostgreSQL database."""
        if self.db_pool:
            return

        self.db_pool = await asyncpg.create_pool(
            self.db_url,
            min_size=2,
            max_size=10
        )

        # Ensure table exists
        await self._create_tables()

        logger.info("✅ Connected to personality database")

    async def disconnect(self):
        """Disconnect from database."""
        if self.db_pool:
            await self.db_pool.close()
            self.db_pool = None

    async def _create_tables(self):
        """Create personality profile tables if not exist."""
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS draft_personality (
                    id SERIAL PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    category TEXT NOT NULL,

                    -- Vocabulary
                    common_words JSONB,
                    avoid_words JSONB,
                    signature_phrases JSONB,

                    -- Structure
                    avg_sentence_length FLOAT,
                    avg_paragraph_length FLOAT,
                    avg_email_length INT,

                    -- Tone
                    formality_score FLOAT,
                    enthusiasm_level FLOAT,
                    politeness_score FLOAT,

                    -- Phrases
                    opening_phrases JSONB,
                    closing_phrases JSONB,
                    transition_phrases JSONB,

                    -- Metadata
                    sample_count INT,
                    last_updated TIMESTAMP,
                    confidence FLOAT,

                    UNIQUE(user_id, category)
                );

                CREATE INDEX IF NOT EXISTS idx_personality_user
                ON draft_personality(user_id);
            """)

            logger.info("✅ Personality tables ready")

    async def learn_from_sent_emails(
        self,
        emails: List[Dict[str, Any]],
        user_id: str = "default",
        category: str = "all"
    ) -> PersonalityProfile:
        """
        Analyze sent emails to extract personality patterns.

        Args:
            emails: List of email dicts with 'subject' and 'body' fields
            user_id: User identifier
            category: Category to learn for ("all" or specific category)

        Returns:
            PersonalityProfile with extracted patterns
        """
        if not emails:
            raise ValueError("No emails provided for learning")

        logger.info(f"Learning personality from {len(emails)} emails...")

        # Extract text from emails
        email_texts = []
        for email in emails:
            subject = email.get("subject", "")
            body = email.get("body", "")

            # Clean HTML if present
            if "<html" in body.lower() or "<div" in body.lower():
                body = self._strip_html(body)

            email_texts.append(f"{subject}\n\n{body}")

        # Analyze patterns
        vocabulary = self._analyze_vocabulary(email_texts)
        structure = self._analyze_structure(email_texts)
        tone = self._analyze_tone(email_texts)
        phrases = self._extract_phrases(email_texts)

        # Calculate confidence based on sample size
        confidence = min(len(emails) / 100.0, 1.0)  # 100+ emails = 100% confidence

        # Create profile
        profile = PersonalityProfile(
            user_id=user_id,
            category=category,
            common_words=vocabulary["common_words"],
            avoid_words=vocabulary["avoid_words"],
            signature_phrases=vocabulary["signature_phrases"],
            avg_sentence_length=structure["avg_sentence_length"],
            avg_paragraph_length=structure["avg_paragraph_length"],
            avg_email_length=structure["avg_email_length"],
            formality_score=tone["formality_score"],
            enthusiasm_level=tone["enthusiasm_level"],
            politeness_score=tone["politeness_score"],
            opening_phrases=phrases["opening_phrases"],
            closing_phrases=phrases["closing_phrases"],
            transition_phrases=phrases["transition_phrases"],
            sample_count=len(emails),
            last_updated=datetime.now(),
            confidence=confidence
        )

        # Save to database
        await self._save_profile(profile)

        logger.info(
            f"✅ Personality profile learned (confidence: {confidence:.2f}, "
            f"{len(vocabulary['common_words'])} vocab words, "
            f"{len(phrases['opening_phrases'])} opening phrases)"
        )

        return profile

    def _strip_html(self, html: str) -> str:
        """Remove HTML tags from text."""
        # Simple HTML stripping (for full HTML parsing, use BeautifulSoup)
        text = re.sub(r'<style[^>]*>.*?</style>', '', html, flags=re.DOTALL)
        text = re.sub(r'<script[^>]*>.*?</script>', '', text, flags=re.DOTALL)
        text = re.sub(r'<[^>]+>', ' ', text)
        text = re.sub(r'\s+', ' ', text)
        return text.strip()

    def _analyze_vocabulary(self, texts: List[str]) -> Dict[str, Any]:
        """Analyze vocabulary patterns."""
        all_words = []

        for text in texts:
            # Extract words (lowercase, alphanumeric)
            words = re.findall(r'\b[a-z]{3,}\b', text.lower())
            all_words.extend(words)

        # Word frequency
        word_freq = Counter(all_words)

        # Common stopwords to exclude
        stopwords = {
            "the", "and", "for", "that", "this", "with", "from", "have",
            "will", "are", "was", "were", "been", "has", "had", "can",
            "would", "could", "should", "may", "might", "must", "shall"
        }

        # Filter out stopwords
        common_words = {
            word: count for word, count in word_freq.most_common(100)
            if word not in stopwords and count >= 3
        }

        # Extract signature phrases (2-3 word combinations)
        signature_phrases = self._extract_signature_phrases(texts)

        return {
            "common_words": common_words,
            "avoid_words": [],  # TODO: Detect words user never uses
            "signature_phrases": signature_phrases[:20]  # Top 20
        }

    def _extract_signature_phrases(self, texts: List[str]) -> List[str]:
        """Extract frequently used phrases."""
        all_phrases = []

        for text in texts:
            # Extract 2-3 word phrases
            words = text.lower().split()
            for i in range(len(words) - 2):
                phrase = " ".join(words[i:i+3])
                # Filter out common phrases
                if len(phrase) > 10 and phrase.count(" ") >= 1:
                    all_phrases.append(phrase)

        # Frequency count
        phrase_freq = Counter(all_phrases)

        # Return phrases used at least twice
        return [phrase for phrase, count in phrase_freq.most_common(50) if count >= 2]

    def _analyze_structure(self, texts: List[str]) -> Dict[str, float]:
        """Analyze structural patterns."""
        sentence_lengths = []
        paragraph_lengths = []
        email_lengths = []

        for text in texts:
            # Sentence count
            sentences = re.split(r'[.!?]+', text)
            sentences = [s.strip() for s in sentences if s.strip()]

            if sentences:
                avg_sentence_len = statistics.mean([len(s.split()) for s in sentences])
                sentence_lengths.append(avg_sentence_len)

            # Paragraph count
            paragraphs = text.split('\n\n')
            paragraphs = [p.strip() for p in paragraphs if p.strip()]

            if paragraphs:
                avg_para_len = statistics.mean([len(p.split()) for p in paragraphs])
                paragraph_lengths.append(avg_para_len)

            # Email length
            email_lengths.append(len(text.split()))

        return {
            "avg_sentence_length": statistics.mean(sentence_lengths) if sentence_lengths else 15.0,
            "avg_paragraph_length": statistics.mean(paragraph_lengths) if paragraph_lengths else 50.0,
            "avg_email_length": int(statistics.mean(email_lengths)) if email_lengths else 150
        }

    def _analyze_tone(self, texts: List[str]) -> Dict[str, float]:
        """Analyze tone markers."""
        # Formality indicators
        formal_words = ["regarding", "hereby", "therefore", "furthermore", "sincerely"]
        casual_words = ["hey", "thanks", "yeah", "great", "awesome", "cool"]

        # Enthusiasm indicators
        exclamation_count = sum(text.count("!") for text in texts)
        positive_words = ["excited", "great", "excellent", "wonderful", "fantastic"]

        # Politeness indicators
        polite_words = ["please", "thank you", "appreciate", "kindly", "grateful"]

        combined_text = " ".join(texts).lower()

        # Calculate scores
        formal_score = sum(combined_text.count(word) for word in formal_words)
        casual_score = sum(combined_text.count(word) for word in casual_words)

        formality = formal_score / max(formal_score + casual_score, 1)

        enthusiasm = min(exclamation_count / len(texts) / 5, 1.0)  # Normalize

        politeness_count = sum(combined_text.count(word) for word in polite_words)
        politeness = min(politeness_count / len(texts) / 3, 1.0)

        return {
            "formality_score": formality,
            "enthusiasm_level": enthusiasm,
            "politeness_score": politeness
        }

    def _extract_phrases(self, texts: List[str]) -> Dict[str, List[str]]:
        """Extract opening, closing, and transition phrases."""
        opening_phrases = []
        closing_phrases = []
        transition_phrases = []

        for text in texts:
            lines = [line.strip() for line in text.split('\n') if line.strip()]

            if not lines:
                continue

            # Opening phrase (first line)
            if lines:
                opening = lines[0][:100]  # First 100 chars
                if len(opening.split()) <= 15:  # Short opening
                    opening_phrases.append(opening)

            # Closing phrase (last 2 lines)
            if len(lines) >= 2:
                closing = " ".join(lines[-2:])[:150]
                closing_phrases.append(closing)

            # Transition phrases (sentences starting with transition words)
            transitions = ["however", "therefore", "additionally", "moreover", "furthermore"]
            for line in lines:
                for trans in transitions:
                    if line.lower().startswith(trans):
                        transition_phrases.append(line[:100])

        # Get most common
        opening_freq = Counter(opening_phrases)
        closing_freq = Counter(closing_phrases)
        transition_freq = Counter(transition_phrases)

        return {
            "opening_phrases": [p for p, _ in opening_freq.most_common(10)],
            "closing_phrases": [p for p, _ in closing_freq.most_common(10)],
            "transition_phrases": [p for p, _ in transition_freq.most_common(10)]
        }

    async def _save_profile(self, profile: PersonalityProfile):
        """Save personality profile to database."""
        if not self.db_pool:
            await self.connect()

        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO draft_personality (
                    user_id, category, common_words, avoid_words, signature_phrases,
                    avg_sentence_length, avg_paragraph_length, avg_email_length,
                    formality_score, enthusiasm_level, politeness_score,
                    opening_phrases, closing_phrases, transition_phrases,
                    sample_count, last_updated, confidence
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
                )
                ON CONFLICT (user_id, category) DO UPDATE SET
                    common_words = EXCLUDED.common_words,
                    avoid_words = EXCLUDED.avoid_words,
                    signature_phrases = EXCLUDED.signature_phrases,
                    avg_sentence_length = EXCLUDED.avg_sentence_length,
                    avg_paragraph_length = EXCLUDED.avg_paragraph_length,
                    avg_email_length = EXCLUDED.avg_email_length,
                    formality_score = EXCLUDED.formality_score,
                    enthusiasm_level = EXCLUDED.enthusiasm_level,
                    politeness_score = EXCLUDED.politeness_score,
                    opening_phrases = EXCLUDED.opening_phrases,
                    closing_phrases = EXCLUDED.closing_phrases,
                    transition_phrases = EXCLUDED.transition_phrases,
                    sample_count = EXCLUDED.sample_count,
                    last_updated = EXCLUDED.last_updated,
                    confidence = EXCLUDED.confidence
            """,
                profile.user_id,
                profile.category,
                profile.common_words,
                profile.avoid_words,
                profile.signature_phrases,
                profile.avg_sentence_length,
                profile.avg_paragraph_length,
                profile.avg_email_length,
                profile.formality_score,
                profile.enthusiasm_level,
                profile.politeness_score,
                profile.opening_phrases,
                profile.closing_phrases,
                profile.transition_phrases,
                profile.sample_count,
                profile.last_updated,
                profile.confidence
            )

        logger.info(f"✅ Saved personality profile for {profile.user_id}/{profile.category}")

    async def get_profile(
        self,
        user_id: str = "default",
        category: str = "all"
    ) -> Optional[PersonalityProfile]:
        """
        Retrieve personality profile from database.

        Args:
            user_id: User identifier
            category: Category ("all" or specific)

        Returns:
            PersonalityProfile or None if not found
        """
        if not self.db_pool:
            await self.connect()

        async with self.db_pool.acquire() as conn:
            row = await conn.fetchrow("""
                SELECT * FROM draft_personality
                WHERE user_id = $1 AND category = $2
            """, user_id, category)

            if not row:
                # Try fallback to "all" category
                if category != "all":
                    row = await conn.fetchrow("""
                        SELECT * FROM draft_personality
                        WHERE user_id = $1 AND category = 'all'
                    """, user_id)

            if not row:
                return None

            return PersonalityProfile(
                user_id=row["user_id"],
                category=row["category"],
                common_words=row["common_words"],
                avoid_words=row["avoid_words"],
                signature_phrases=row["signature_phrases"],
                avg_sentence_length=row["avg_sentence_length"],
                avg_paragraph_length=row["avg_paragraph_length"],
                avg_email_length=row["avg_email_length"],
                formality_score=row["formality_score"],
                enthusiasm_level=row["enthusiasm_level"],
                politeness_score=row["politeness_score"],
                opening_phrases=row["opening_phrases"],
                closing_phrases=row["closing_phrases"],
                transition_phrases=row["transition_phrases"],
                sample_count=row["sample_count"],
                last_updated=row["last_updated"],
                confidence=row["confidence"]
            )

    def apply_personality_to_prompt(
        self,
        base_prompt: str,
        profile: PersonalityProfile
    ) -> str:
        """
        Enhance draft generation prompt with personality profile.

        Args:
            base_prompt: Base prompt for Claude
            profile: User's personality profile

        Returns:
            Enhanced prompt with personality instructions
        """
        personality_instructions = f"""
**WRITING STYLE REQUIREMENTS** (Apply user's authentic style):

**Tone & Formality:**
- Formality level: {profile.formality_score:.1f}/1.0 ({'formal' if profile.formality_score > 0.6 else 'casual' if profile.formality_score < 0.4 else 'balanced'})
- Enthusiasm: {profile.enthusiasm_level:.1f}/1.0 ({'high energy' if profile.enthusiasm_level > 0.6 else 'neutral' if profile.enthusiasm_level < 0.4 else 'moderate'})
- Politeness: {profile.politeness_score:.1f}/1.0 ({'very polite' if profile.politeness_score > 0.6 else 'direct' if profile.politeness_score < 0.4 else 'balanced'})

**Structure:**
- Average sentence length: ~{profile.avg_sentence_length:.0f} words
- Target email length: ~{profile.avg_email_length} words
- Paragraph style: ~{profile.avg_paragraph_length:.0f} words per paragraph

**Vocabulary Preferences:**
- Frequently used words: {', '.join(list(profile.common_words.keys())[:10])}
- Signature phrases: {', '.join(profile.signature_phrases[:5])}

**Opening Options (choose similar style):**
{chr(10).join(f'- {phrase}' for phrase in profile.opening_phrases[:3])}

**Closing Options (choose similar style):**
{chr(10).join(f'- {phrase}' for phrase in profile.closing_phrases[:3])}

**Confidence Level:** {profile.confidence:.0%} (based on {profile.sample_count} samples)

---

"""

        return personality_instructions + base_prompt


# Convenience function
async def get_personality_engine(
    db_url: Optional[str] = None,
    anthropic_api_key: Optional[str] = None
) -> DraftPersonalityEngine:
    """Get personality engine instance."""
    engine = DraftPersonalityEngine(db_url=db_url, anthropic_api_key=anthropic_api_key)
    await engine.connect()
    return engine
