"""
Email Classification Engine

Multi-tier cost-optimized email classification system:
1. Rule-based classification (FREE, ~70% success)
2. Heuristic scoring (FREE, ~20% more)
3. Claude API (PAID, ~10% complex cases)

Categories: Urgent, Client Inquiry, Internal, Financial, Action Required, FYI, Spam/Marketing
"""

import re
import logging
from typing import Optional, List, Dict, Any
from dataclasses import dataclass
from datetime import datetime
from enum import Enum

from anthropic import Anthropic

logger = logging.getLogger(__name__)


class EmailCategory(str, Enum):
    """Standard business email categories."""
    URGENT = "Urgent"
    CLIENT_INQUIRY = "Client Inquiry"
    INTERNAL = "Internal"
    FINANCIAL = "Financial"
    ACTION_REQUIRED = "Action Required"
    FYI = "FYI"
    SPAM = "Spam/Marketing"


@dataclass
class Classification:
    """Email classification result."""
    category: EmailCategory
    confidence: float  # 0.0 to 1.0
    reasoning: str
    method: str  # "rule-based", "heuristic", "ai"
    tier_used: str = "rule-based"  # Tier used for classification
    subcategory: Optional[str] = None


class EmailClassifier:
    """
    Multi-tier email classification system.

    Uses cost-optimized cascade:
    1. Rule-based (FREE) - Keywords, patterns, sender analysis
    2. Heuristic (FREE) - Scoring system for urgency/importance
    3. AI (PAID) - Claude API for complex cases
    """

    def __init__(self, anthropic_api_key: Optional[str] = None):
        """
        Initialize email classifier.

        Args:
            anthropic_api_key: Optional API key for Claude (uses env var if not provided)
        """
        self.anthropic_client = None
        if anthropic_api_key:
            self.anthropic_client = Anthropic(api_key=anthropic_api_key)

        # Load classification rules
        self._load_rules()

        logger.info("Email classifier initialized")

    def _load_rules(self):
        """Load classification rules and patterns."""

        # Keyword patterns for rule-based classification
        self.keyword_patterns = {
            EmailCategory.URGENT: [
                r'\b(urgent|asap|immediately|critical|emergency|time[\s-]?sensitive)\b',
                r'\b(deadline|due\s+(today|tomorrow|this\s+week))\b',
                r'\b(priority|important|attention\s+required)\b'
            ],
            EmailCategory.FINANCIAL: [
                r'\b(invoice|payment|quote|proposal|budget|financial)\b',
                r'\b(cost|price|estimate|billing|receipt)\b',
                r'\b(po\s+\d+|purchase\s+order|contract)\b',
                r'\$([\d,]+\.?\d*)',  # Dollar amounts
                r'\b(refund|credit|debit|transaction)\b'
            ],
            EmailCategory.SPAM: [
                r'\b(unsubscribe|opt[\s-]?out|newsletter)\b',
                r'\b(marketing|promotion|sale|discount|offer)\b',
                r'\b(click\s+here|limited\s+time|act\s+now)\b',
                r'\b(free|winner|congratulations|claim)\b',
                # Job postings
                r'\b(cv|resume|curriculum\s+vitae|application:)\b',
                r'\b(job\s+(posting|application|opportunity)|position\s+available)\b',
                r'\b(career|talent|recruitment|hiring)\b',
                # Educational/webinar spam
                r'\b(webinar|register\s+now|enroll|course|training)\b',
                r'\b(scholarship|educational|learning\s+opportunity)\b',
                r'\b(certificate|diploma|degree\s+program)\b',
                # Sales events
                r'\b(black\s+friday|cyber\s+monday|deal|deals)\b',
                r'\b(\d+%\s+off|\d+%\s+discount|save\s+\d+%)\b',
                r'\b(limited[\s-]?time|exclusive\s+offer|special\s+price)\b',
                # Marketing spam
                r'\b(last\s+chance|don\'t\s+miss|act\s+now)\b',
                r'\b(play\s+now|watch\s+now|download\s+now)\b'
            ],
            EmailCategory.ACTION_REQUIRED: [
                r'\b(action\s+required|please\s+(review|approve|confirm|sign))\b',
                r'\b(need\s+your|waiting\s+for|pending|response\s+needed)\b',
                r'\b(follow[\s-]?up|reminder|outstanding)\b',
                r'\?[\s\n]',  # Questions indicate action needed
            ],
            EmailCategory.FYI: [
                r'\b(fyi|for\s+your\s+information|heads[\s-]?up)\b',
                r'\b(update|status|report|summary)\b',
                r'\b(notification|alert|announcement)\b',
                # Automated success messages
                r'✅|sync\s+success|successfully\s+(completed|synced)',
                r'\b(weekly|monthly|daily)\s+(summary|report)\b',
                r'\[notification\]|automated:|generated:',
                # Status updates
                r'^(status\s+update:|fwd:.*update)',
                r'\b(progress\s+report|completion\s+notice)\b'
            ]
        }

        # Sender domain patterns
        self.sender_patterns = {
            EmailCategory.INTERNAL: [
                r'@(blitz|velocity|mamelodi)\.co\.za$',
                r'@yourcompany\.(com|co\.za)$'
            ],
            EmailCategory.SPAM: [
                r'@(noreply|no-reply|donotreply)',
                r'@(marketing|newsletter|promo)',
                r'@.*\.(info|xyz|click)$',
                # High-volume automated senders
                r'@fireflies\.ai$',
                r'@notification\.(mcafee|intuit)\.com$',
                r'@notifications?\.(microsoft|google)\.com$',
                # Job boards
                r'@(jobs|careers|talent|recruitment)\.',
                # Educational spam
                r'@exeedcollege\.com$',
                r'@.*terrapinn\.com$',
                r'@xperien\.co\.za$'
            ]
        }

        # FYI-only senders (always FYI, never action required or spam)
        self.fyi_only_senders = [
            r'fred@fireflies\.ai',
            r'calendar-notification@google\.com',
            r'info@notification\.mcafee\.com',
            r'info@xneelo\.com'
        ]

        # Action-required senders (signing services, etc.)
        self.action_required_senders = [
            r'@adobesign\.com',
            r'@docusign\.',
            r'@echosign\.com',
            r'@signinghub\.'
        ]

        # Subject line indicators
        self.subject_patterns = {
            EmailCategory.URGENT: [
                r'^(urgent|critical|important):',
                r'\[urgent\]',
                r'!!+'
            ],
            EmailCategory.FYI: [
                r'^(fyi|info):',
                r'\[fyi\]',
                r'^(update|status|report):'
            ],
            EmailCategory.ACTION_REQUIRED: [
                r'^(action\s+required|please\s+review):',
                r'\[action\s+required\]'
            ]
        }

    async def classify(self, email_data: Dict[str, Any]) -> Classification:
        """
        Classify email using multi-tier cascade.

        Args:
            email_data: Email object with fields:
                - subject: str
                - body: str
                - sender: str
                - recipients: List[str]
                - has_attachments: bool
                - importance: str (optional)

        Returns:
            Classification object with category, confidence, and reasoning
        """
        # Tier 1: Rule-based classification (FREE)
        classification = await self._classify_rule_based(email_data)
        if classification and classification.confidence >= 0.70:
            logger.info(
                f"Classified as {classification.category} "
                f"(rule-based, confidence: {classification.confidence:.2f})"
            )
            return classification

        # Tier 2: Heuristic scoring (FREE)
        classification = await self._classify_heuristic(email_data)
        if classification and classification.confidence >= 0.70:
            logger.info(
                f"Classified as {classification.category} "
                f"(heuristic, confidence: {classification.confidence:.2f})"
            )
            return classification

        # Tier 3: AI classification (PAID - only for complex cases)
        if self.anthropic_client:
            classification = await self._classify_ai(email_data)
            logger.info(
                f"Classified as {classification.category} "
                f"(AI, confidence: {classification.confidence:.2f}, cost: ~$0.002)"
            )
            return classification

        # Fallback: Return best guess with low confidence
        logger.warning("All classification tiers failed, using fallback")
        return Classification(
            category=EmailCategory.FYI,
            confidence=0.5,
            reasoning="Classification uncertain, defaulting to FYI",
            method="fallback"
        )

    async def _classify_rule_based(self, email_data: Dict[str, Any]) -> Optional[Classification]:
        """
        Tier 1: Rule-based classification using keywords and patterns.

        Returns:
            Classification if confident match found, None otherwise
        """
        subject = email_data.get("subject", "").lower()
        body = email_data.get("body", "").lower()
        sender = email_data.get("sender", "").lower()

        combined_text = f"{subject} {body}"

        # Check FYI-only senders first (highest priority)
        if self._is_fyi_only_sender(sender):
            return Classification(
                category=EmailCategory.FYI,
                confidence=0.90,
                reasoning="High-volume automated sender (FYI-only whitelist)",
                method="rule-based"
            )

        # Check action-required senders (DocuSign, AdobeSign, etc.)
        if self._is_action_required_sender(sender):
            return Classification(
                category=EmailCategory.ACTION_REQUIRED,
                confidence=0.88,
                reasoning="Document signing service (action required)",
                method="rule-based"
            )

        # Check forward/reply context
        fwd_reply_classification = self._analyze_forward_context(email_data)
        if fwd_reply_classification:
            return fwd_reply_classification

        # Check sender domain patterns
        for category, patterns in self.sender_patterns.items():
            for pattern in patterns:
                if re.search(pattern, sender, re.IGNORECASE):
                    return Classification(
                        category=category,
                        confidence=0.90,
                        reasoning=f"Sender domain matches {category} pattern",
                        method="rule-based"
                    )

        # Check subject line patterns
        for category, patterns in self.subject_patterns.items():
            for pattern in patterns:
                if re.search(pattern, subject, re.IGNORECASE):
                    return Classification(
                        category=category,
                        confidence=0.88,
                        reasoning=f"Subject line matches {category} pattern",
                        method="rule-based"
                    )

        # Check recipient position (CC vs TO)
        recipient_fyi_score = self._analyze_recipient_position(email_data)
        if recipient_fyi_score >= 0.8:
            return Classification(
                category=EmailCategory.FYI,
                confidence=0.82,
                reasoning="Recipient in CC-only (not direct TO)",
                method="rule-based"
            )

        # Check keyword patterns (count matches)
        category_scores = {}
        for category, patterns in self.keyword_patterns.items():
            match_count = 0
            for pattern in patterns:
                matches = re.findall(pattern, combined_text, re.IGNORECASE)
                match_count += len(matches)

            if match_count > 0:
                category_scores[category] = match_count

        # Return highest scoring category if confidence threshold met
        if category_scores:
            best_category = max(category_scores, key=category_scores.get)
            match_count = category_scores[best_category]

            # Higher match count = higher confidence
            confidence = min(0.70 + (match_count * 0.05), 0.95)

            return Classification(
                category=best_category,
                confidence=confidence,
                reasoning=f"Matched {match_count} keyword patterns for {best_category}",
                method="rule-based"
            )

        return None

    async def _classify_heuristic(self, email_data: Dict[str, Any]) -> Optional[Classification]:
        """
        Tier 2: Heuristic scoring based on email characteristics.

        Analyzes:
        - Urgency indicators
        - Question detection
        - Recipient count
        - Attachment presence
        - Email importance flag
        """
        subject = email_data.get("subject", "").lower()
        body = email_data.get("body", "").lower()
        recipients = email_data.get("recipients", [])
        has_attachments = email_data.get("has_attachments", False)
        importance = email_data.get("importance", "normal").lower()

        combined_text = f"{subject} {body}"

        # Heuristic scoring
        urgency_score = 0
        action_score = 0
        info_score = 0

        # Urgency indicators
        urgency_terms = ["urgent", "asap", "immediately", "critical", "deadline", "today", "tomorrow"]
        urgency_score += sum(combined_text.count(term) for term in urgency_terms)

        # Marked as high importance
        if importance == "high":
            urgency_score += 2

        # Multiple exclamation marks
        urgency_score += min(combined_text.count("!") // 2, 3)

        # Question indicators (action likely needed)
        # BUT: Don't count questions from spam senders!
        sender = email_data.get("sender", "").lower()
        is_spam_sender = any(re.search(pattern, sender, re.IGNORECASE) for pattern in self.sender_patterns.get(EmailCategory.SPAM, []))

        if not is_spam_sender:
            question_count = combined_text.count("?")
            action_score += question_count
        else:
            question_count = 0

        # Enhanced action words with weighted scoring
        action_words = [
            "please review", "please approve", "please sign", "please confirm",
            "can you", "could you", "would you", "need your",
            "waiting for you", "pending your", "requires your",
            "urgently", "asap", "time-sensitive", "deadline"
        ]
        action_score += sum(combined_text.count(word) * 2 for word in action_words)  # Double weight

        # Info-only indicators
        info_words = ["fyi", "update", "status", "report", "summary", "notification"]
        info_score += sum(combined_text.count(word) for word in info_words)

        # No questions + update words = likely FYI
        if question_count == 0 and info_score > 0:
            info_score += 2

        # Check for specific action-required senders (DocuSign, AdobeSign, etc.)
        sender = email_data.get("sender", "").lower()
        if self._is_action_required_sender(sender):
            action_score += 5  # Strong signal

        # Attachments + financial terms = likely financial
        if has_attachments:
            financial_terms = ["invoice", "payment", "quote", "contract", "proposal"]
            if any(term in combined_text for term in financial_terms):
                return Classification(
                    category=EmailCategory.FINANCIAL,
                    confidence=0.75,
                    reasoning="Has attachments and financial terms",
                    method="heuristic"
                )

        # Determine category from scores
        if urgency_score >= 3:
            return Classification(
                category=EmailCategory.URGENT,
                confidence=min(0.65 + (urgency_score * 0.05), 0.85),
                reasoning=f"High urgency score: {urgency_score}",
                method="heuristic"
            )

        if action_score >= 3:
            return Classification(
                category=EmailCategory.ACTION_REQUIRED,
                confidence=min(0.65 + (action_score * 0.04), 0.80),
                reasoning=f"High action score: {action_score}",
                method="heuristic"
            )

        if info_score >= 2 and question_count == 0:
            return Classification(
                category=EmailCategory.FYI,
                confidence=0.70,
                reasoning=f"Info-only content (score: {info_score})",
                method="heuristic"
            )

        # Recipient count heuristic
        if len(recipients) > 5:
            return Classification(
                category=EmailCategory.FYI,
                confidence=0.68,
                reasoning="Large recipient list suggests broadcast/FYI",
                method="heuristic"
            )

        return None

    async def _classify_ai(self, email_data: Dict[str, Any]) -> Classification:
        """
        Tier 3: AI classification using Claude API (PAID).

        Only called for complex cases that failed rule-based and heuristic tiers.
        Cost: ~$0.002 per email (~50 emails per $0.10)
        """
        subject = email_data.get("subject", "")
        body = email_data.get("body", "")[:1000]  # Limit to first 1000 chars for cost
        sender = email_data.get("sender", "")

        prompt = f"""Classify this email into ONE of these categories:
- Urgent: Time-sensitive, requires immediate attention
- Client Inquiry: Questions or requests from clients/customers
- Internal: Communication within the organization
- Financial: Invoices, payments, contracts, financial matters
- Action Required: Needs a response or action from recipient
- FYI: Informational only, no action needed
- Spam/Marketing: Promotional, marketing, or spam content

Email:
From: {sender}
Subject: {subject}
Body: {body}

Respond in this exact format:
CATEGORY: [category name]
CONFIDENCE: [0.0-1.0]
REASONING: [brief explanation]"""

        try:
            response = self.anthropic_client.messages.create(
                model="claude-3-haiku-20240307",  # Cheapest model
                max_tokens=150,
                messages=[{"role": "user", "content": prompt}]
            )

            # Parse response
            content = response.content[0].text
            lines = content.strip().split("\n")

            category_line = next((l for l in lines if l.startswith("CATEGORY:")), "")
            confidence_line = next((l for l in lines if l.startswith("CONFIDENCE:")), "")
            reasoning_line = next((l for l in lines if l.startswith("REASONING:")), "")

            category_name = category_line.replace("CATEGORY:", "").strip()
            confidence = float(confidence_line.replace("CONFIDENCE:", "").strip())
            reasoning = reasoning_line.replace("REASONING:", "").strip()

            # Map category name to enum
            category_map = {
                "urgent": EmailCategory.URGENT,
                "client inquiry": EmailCategory.CLIENT_INQUIRY,
                "internal": EmailCategory.INTERNAL,
                "financial": EmailCategory.FINANCIAL,
                "action required": EmailCategory.ACTION_REQUIRED,
                "fyi": EmailCategory.FYI,
                "spam/marketing": EmailCategory.SPAM,
                "spam": EmailCategory.SPAM,
                "marketing": EmailCategory.SPAM,
            }

            category = category_map.get(category_name.lower(), EmailCategory.FYI)

            return Classification(
                category=category,
                confidence=confidence,
                reasoning=reasoning,
                method="ai"
            )

        except Exception as e:
            logger.error(f"AI classification failed: {e}")
            return Classification(
                category=EmailCategory.FYI,
                confidence=0.5,
                reasoning=f"AI classification error: {str(e)}",
                method="ai-fallback"
            )

    def should_generate_draft(self, category: EmailCategory) -> bool:
        """
        Determine if a draft should be generated for this category.

        Args:
            category: Email category

        Returns:
            True if draft should be generated
        """
        # Generate drafts for categories that typically need responses
        draft_categories = {
            EmailCategory.URGENT,
            EmailCategory.CLIENT_INQUIRY,
            EmailCategory.INTERNAL,
            EmailCategory.FINANCIAL,
            EmailCategory.ACTION_REQUIRED
        }

        return category in draft_categories

    def get_category_color(self, category: EmailCategory) -> str:
        """
        Get Outlook category color for MS Graph.

        Args:
            category: Email category

        Returns:
            Color name for Outlook
        """
        color_map = {
            EmailCategory.URGENT: "preset0",  # Red
            EmailCategory.CLIENT_INQUIRY: "preset1",  # Blue
            EmailCategory.INTERNAL: "preset2",  # Green
            EmailCategory.FINANCIAL: "preset3",  # Orange
            EmailCategory.ACTION_REQUIRED: "preset4",  # Yellow
            EmailCategory.FYI: "preset5",  # Gray
            EmailCategory.SPAM: "preset6"  # Purple
        }

        return color_map.get(category, "preset5")

    def _is_fyi_only_sender(self, sender: str) -> bool:
        """Check if sender is FYI-only (never action required)."""
        return any(re.search(pattern, sender, re.IGNORECASE) for pattern in self.fyi_only_senders)

    def _is_action_required_sender(self, sender: str) -> bool:
        """Check if sender is action-required service (DocuSign, etc.)."""
        return any(re.search(pattern, sender, re.IGNORECASE) for pattern in self.action_required_senders)

    def _analyze_recipient_position(self, email_data: Dict[str, Any]) -> float:
        """
        Analyze if user is in TO: vs CC: list.
        CC-only emails are more likely FYI.

        Returns:
            fyi_score: 0.0 (not CC-only) to 1.0 (CC-only)
        """
        recipients = email_data.get("recipients", [])  # TO: list
        cc_recipients = email_data.get("cc_recipients", [])  # CC: list
        user_email = email_data.get("user_email", "")  # Current user

        # If user_email not provided, can't determine position
        if not user_email:
            return 0.0

        user_email_lower = user_email.lower()

        # If user is in TO: list, not FYI-only
        if any(user_email_lower in r.lower() for r in recipients):
            return 0.0

        # If user is only in CC: list, likely FYI
        if any(user_email_lower in r.lower() for r in cc_recipients):
            return 0.8  # Strong FYI signal

        return 0.0

    def _analyze_forward_context(self, email_data: Dict[str, Any]) -> Optional[Classification]:
        """
        Analyze FW:/RE: emails with additional context.

        FW: + no action words = likely FYI
        RE: + from internal = likely FYI or Internal category
        """
        subject = email_data.get("subject", "").lower()
        sender = email_data.get("sender", "").lower()
        body = email_data.get("body", "").lower()

        combined_text = f"{subject} {body}"

        is_forward = subject.startswith(("fw:", "fwd:"))
        is_reply = subject.startswith("re:")

        # Forward analysis
        if is_forward:
            # Check for action indicators
            has_action = any(word in combined_text for word in [
                "please", "can you", "need your", "review", "approve",
                "urgent", "asap", "waiting"
            ])

            if not has_action:
                # Forward without action words = likely FYI
                return Classification(
                    category=EmailCategory.FYI,
                    confidence=0.75,
                    reasoning="Forward email without action indicators",
                    method="rule-based"
                )

        # Reply analysis
        if is_reply:
            # Check if from internal domain
            internal_domains = ['blitzfibre.com', 'velocityfibre.co.za', 'mamelodi.co.za']
            is_internal = any(domain in sender for domain in internal_domains)

            if is_internal:
                return Classification(
                    category=EmailCategory.INTERNAL,
                    confidence=0.80,
                    reasoning="Internal reply thread",
                    method="rule-based"
                )

        return None


# Convenience function
def get_classifier(anthropic_api_key: Optional[str] = None) -> EmailClassifier:
    """Get email classifier instance."""
    return EmailClassifier(anthropic_api_key=anthropic_api_key)
