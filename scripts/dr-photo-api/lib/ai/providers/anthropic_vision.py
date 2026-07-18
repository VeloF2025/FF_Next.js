"""
Anthropic Claude 3 Vision Provider - Anthropic's Claude 3 Vision Models

Implements VisionProvider interface for Anthropic's Claude 3 Vision API.
Highest quality option for critical analysis ($0.015/photo).

Phase 4.4 Implementation - Anthropic Claude 3 Vision Integration
"""

import base64
import logging
import time
from pathlib import Path
from typing import Dict, Any, List
from datetime import datetime

import httpx

from lib.ai.vision_provider import (
    VisionProvider,
    VisionResult,
    ProviderConfig,
    ProviderStatus,
    ProviderError
)

logger = logging.getLogger(__name__)


class AnthropicVisionProvider(VisionProvider):
    """
    Anthropic Claude 3 Vision provider implementation.

    Uses Claude 3 Opus or Sonnet models for high-quality photo evaluation.

    Cost: $0.015 per image (Opus), $0.003 per image (Sonnet)
    Latency: ~3-6 seconds
    Accuracy: Very High (best for critical/complex analysis)
    """

    def __init__(self, config: ProviderConfig):
        """
        Initialize Anthropic Vision provider.

        Args:
            config: Provider configuration with API key
        """
        super().__init__(config)

        self.api_key = config.api_key
        self.model = config.model or "claude-3-opus-20240229"
        self.base_url = "https://api.anthropic.com/v1"
        self.api_version = "2023-06-01"

        if not self.api_key:
            logger.warning("Anthropic API key not configured")
            self.status = ProviderStatus.DISABLED

        logger.info(f"Anthropic Vision provider ready: {self.model}")

    async def evaluate_photo(
        self,
        image_path: Path,
        prompt: str,
        step_config: Dict[str, Any]
    ) -> VisionResult:
        """
        Evaluate a photo using Anthropic Claude 3 Vision API.

        Args:
            image_path: Path to image file
            prompt: Evaluation prompt/instructions
            step_config: Configuration for verification step

        Returns:
            VisionResult with evaluation details

        Raises:
            ProviderError: If API call fails
        """
        if self.status == ProviderStatus.DISABLED:
            raise ProviderError(
                "Anthropic provider disabled - no API key configured",
                provider=self.config.name
            )

        start_time = time.time()

        try:
            # Read and encode image
            with open(image_path, "rb") as f:
                image_data = base64.b64encode(f.read()).decode("utf-8")

            # Detect image format
            image_ext = image_path.suffix.lower()
            media_type_map = {
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".png": "image/png",
                ".gif": "image/gif",
                ".webp": "image/webp"
            }
            media_type = media_type_map.get(image_ext, "image/jpeg")

            # Build enhanced prompt with step context
            enhanced_prompt = self._build_prompt(prompt, step_config)

            # Call Anthropic Messages API
            url = f"{self.base_url}/messages"

            headers = {
                "x-api-key": self.api_key,
                "anthropic-version": self.api_version,
                "Content-Type": "application/json"
            }

            payload = {
                "model": self.model,
                "max_tokens": 1024,
                "temperature": 0.2,  # Low temperature for consistent evaluation
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": media_type,
                                    "data": image_data
                                }
                            },
                            {
                                "type": "text",
                                "text": enhanced_prompt
                            }
                        ]
                    }
                ]
            }

            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(url, json=payload, headers=headers)
                response.raise_for_status()
                result = response.json()

            # Parse Claude response
            text_response = result["content"][0]["text"]
            evaluation = self._parse_response(text_response, step_config)

            # Calculate latency and cost
            latency_ms = int((time.time() - start_time) * 1000)
            cost = self.config.cost_per_call

            # Track metrics
            self._track_call(cost, latency_ms, success=True)

            # Build VisionResult
            vision_result = VisionResult(
                success=True,
                confidence=evaluation.get("confidence", 0.5),
                evaluation=evaluation.get("summary", ""),
                is_acceptable=evaluation.get("is_acceptable", False),
                quality_score=evaluation.get("quality_score", 0.0),
                issues=evaluation.get("issues", []),
                matches_step=evaluation.get("matches_step", False),
                step_confidence=evaluation.get("step_confidence", 0.0),
                extracted_data=evaluation.get("extracted_data", {}),
                provider=self.config.name,
                model=self.model,
                cost=cost,
                latency_ms=latency_ms,
                timestamp=datetime.now(),
                raw_response={"text": text_response, "full": result}
            )

            logger.info(
                f"Anthropic evaluation complete: {image_path.name} - "
                f"acceptable={vision_result.is_acceptable}, "
                f"confidence={vision_result.confidence:.2f}, "
                f"latency={latency_ms}ms"
            )

            return vision_result

        except httpx.HTTPStatusError as e:
            # HTTP error from Anthropic API
            latency_ms = int((time.time() - start_time) * 1000)
            self._track_call(0.0, latency_ms, success=False)

            error_msg = f"Anthropic API error: {e.response.status_code} - {e.response.text}"
            logger.error(error_msg)

            raise ProviderError(error_msg, provider=self.config.name, original_error=e)

        except Exception as e:
            # Other errors
            latency_ms = int((time.time() - start_time) * 1000)
            self._track_call(0.0, latency_ms, success=False)

            error_msg = f"Anthropic evaluation failed: {str(e)}"
            logger.error(error_msg, exc_info=True)

            raise ProviderError(error_msg, provider=self.config.name, original_error=e)

    async def health_check(self) -> ProviderStatus:
        """
        Check Anthropic API health and availability.

        Returns:
            ProviderStatus indicating current availability
        """
        if not self.api_key:
            self.status = ProviderStatus.DISABLED
            return self.status

        try:
            # Simple health check - make minimal API call
            url = f"{self.base_url}/messages"

            headers = {
                "x-api-key": self.api_key,
                "anthropic-version": self.api_version,
                "Content-Type": "application/json"
            }

            # Minimal test payload
            payload = {
                "model": self.model,
                "max_tokens": 10,
                "messages": [
                    {
                        "role": "user",
                        "content": "Hello"
                    }
                ]
            }

            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(url, json=payload, headers=headers)
                response.raise_for_status()

            self.status = ProviderStatus.AVAILABLE
            logger.debug("Anthropic health check: OK")

        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429:
                self.status = ProviderStatus.RATE_LIMITED
                logger.warning("Anthropic health check: RATE LIMITED")
            elif e.response.status_code == 401:
                self.status = ProviderStatus.ERROR
                logger.error("Anthropic health check: AUTHENTICATION ERROR (invalid API key)")
            else:
                self.status = ProviderStatus.ERROR
                logger.error(f"Anthropic health check: ERROR ({e.response.status_code})")

        except Exception as e:
            self.status = ProviderStatus.UNAVAILABLE
            logger.error(f"Anthropic health check: UNAVAILABLE - {e}")

        return self.status

    def _build_prompt(self, base_prompt: str, step_config: Dict[str, Any]) -> str:
        """
        Build enhanced prompt with step-specific context.

        Args:
            base_prompt: Base evaluation prompt
            step_config: Step configuration with keywords and expected content

        Returns:
            Enhanced prompt string
        """
        step_number = step_config.get("step_number")
        keywords = step_config.get("keywords", [])
        expected_content = step_config.get("expected_content", "")

        prompt = f"{base_prompt}\n\n"

        if step_number:
            prompt += f"**Verification Step:** {step_number}/12\n"

        if expected_content:
            prompt += f"**Expected Content:** {expected_content}\n"

        if keywords:
            prompt += f"**Required Elements:** {', '.join(keywords)}\n"

        prompt += """
**Evaluation Framework:**

1. **Technical Quality Assessment** (0-10):
   - Image clarity and focus
   - Lighting and exposure
   - Framing and composition
   - Visibility of critical details

2. **Content Verification** (0-10):
   - All expected equipment is visible
   - Required elements are present
   - Installation meets fiber optic standards
   - Safety protocols are followed

3. **Compliance Validation** (0-10):
   - Documentation requirements met
   - Technical specifications satisfied
   - Industry best practices followed
   - No safety violations detected

**Response Format:**
Please provide a structured evaluation with:

```
STATUS: PASS | FAIL | NEEDS_REVIEW
CONFIDENCE: 0.0-1.0 (how confident you are in this assessment)
QUALITY_SCORE: 0.0-1.0 (overall photo quality)

ISSUES:
- [List any problems, concerns, or missing elements]

SUMMARY:
[Brief 2-3 sentence assessment of the photo]

EXTRACTED_DATA:
- Serial numbers: [if visible]
- Barcodes: [if visible]
- Measurements: [if visible]
- Other identifiers: [if visible]
```

Be thorough, objective, and precise. Flag any concerns immediately. If something is unclear or ambiguous, mark as NEEDS_REVIEW rather than making assumptions.
"""

        return prompt

    def _parse_response(
        self,
        text_response: str,
        step_config: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Parse Anthropic text response into structured evaluation.

        Args:
            text_response: Raw text from Claude
            step_config: Step configuration

        Returns:
            Dictionary with parsed evaluation data
        """
        # Parse response - Claude tends to be very structured
        text_lower = text_response.lower()

        # Determine if photo is acceptable
        is_pass = any(indicator in text_lower for indicator in [
            "status: pass", "status:pass", "pass", "acceptable", "approved",
            "meets requirements", "satisfactory"
        ])
        is_fail = any(indicator in text_lower for indicator in [
            "status: fail", "status:fail", "fail", "unacceptable", "rejected",
            "does not meet", "unsatisfactory"
        ])
        needs_review = any(indicator in text_lower for indicator in [
            "needs_review", "needs review", "unclear", "ambiguous", "uncertain"
        ])

        if is_pass and not is_fail and not needs_review:
            is_acceptable = True
            confidence = 0.95  # Claude very confident when passing
            quality_score = 0.90
        elif is_fail:
            is_acceptable = False
            confidence = 0.95  # Claude very confident when failing
            quality_score = 0.20
        else:
            is_acceptable = False  # Needs review = not acceptable
            confidence = 0.60
            quality_score = 0.50

        # Extract issues
        issues = []
        in_issues_section = False

        for line in text_response.split("\n"):
            line_stripped = line.strip()
            line_lower = line_stripped.lower()

            # Detect issues section
            if line_lower.startswith("issues:"):
                in_issues_section = True
                continue

            # Stop at next section
            if in_issues_section and (
                line_lower.startswith("summary:") or
                line_lower.startswith("extracted_data:") or
                line_lower.startswith("```")
            ):
                in_issues_section = False

            # Extract issue lines
            if in_issues_section:
                cleaned_line = line_stripped.lstrip("-•*").strip()
                if cleaned_line and len(cleaned_line) > 5:
                    issues.append(cleaned_line)

            # Also catch issue keywords outside section
            if not in_issues_section and any(keyword in line_lower for keyword in [
                "issue", "problem", "concern", "missing", "unclear",
                "poor", "insufficient", "cannot", "not visible", "violation"
            ]):
                cleaned_line = line_stripped.lstrip("-•*").strip()
                if cleaned_line and len(cleaned_line) > 10:
                    issues.append(cleaned_line)

        # Extract step match
        matches_step = is_acceptable
        step_confidence = confidence if matches_step else 0.25

        # Extract structured data
        extracted_data = {}

        # Look for serial numbers with comprehensive patterns
        import re
        serial_patterns = [
            r'[Ss]erial\s*[Nn]umbers?[:=\s]+([A-Z0-9-]+)',
            r'SN[:=\s]+([A-Z0-9-]+)',
            r'S/N[:=\s]+([A-Z0-9-]+)',
            r'serial["\']?\s*:\s*["\']?([A-Z0-9-]+)',
        ]
        for pattern in serial_patterns:
            match = re.search(pattern, text_response, re.IGNORECASE)
            if match:
                extracted_data["serial_number"] = match.group(1)
                break

        # Look for barcodes
        barcode_patterns = [
            r'[Bb]arcodes?[:=\s]+([A-Z0-9-]+)',
            r'barcode["\']?\s*:\s*["\']?([A-Z0-9-]+)',
        ]
        for pattern in barcode_patterns:
            match = re.search(pattern, text_response, re.IGNORECASE)
            if match:
                extracted_data["barcode"] = match.group(1)
                break

        # Look for measurements
        measurement_patterns = [
            r'[Mm]easurements?[:=\s]+([0-9.,\s]+(?:mm|cm|m|meters?))',
            r'([0-9.]+\s*(?:mm|cm|m|meters?))',
        ]
        for pattern in measurement_patterns:
            match = re.search(pattern, text_response, re.IGNORECASE)
            if match:
                extracted_data["measurement"] = match.group(1)
                break

        return {
            "is_acceptable": is_acceptable,
            "confidence": confidence,
            "quality_score": quality_score,
            "matches_step": matches_step,
            "step_confidence": step_confidence,
            "issues": issues[:5],  # Top 5 issues
            "summary": text_response[:700],  # First 700 chars
            "extracted_data": extracted_data
        }

    async def batch_evaluate(
        self,
        images: List[Path],
        prompts: List[str],
        step_configs: List[Dict[str, Any]]
    ) -> List[VisionResult]:
        """
        Evaluate multiple photos in batch.

        Args:
            images: List of image paths
            prompts: List of prompts (one per image)
            step_configs: List of step configurations

        Returns:
            List of VisionResult objects

        Raises:
            ProviderError: If batch processing fails
        """
        if len(images) != len(prompts) or len(images) != len(step_configs):
            raise ProviderError(
                "Mismatched lengths: images, prompts, and step_configs must have same length",
                provider=self.config.name
            )

        # Process sequentially (Anthropic API doesn't support true batching)
        results = []
        for image_path, prompt, step_config in zip(images, prompts, step_configs):
            try:
                result = await self.evaluate_photo(image_path, prompt, step_config)
                results.append(result)
            except Exception as e:
                logger.error(f"Batch evaluation failed for {image_path.name}: {e}")
                # Create error result
                error_result = VisionResult(
                    success=False,
                    confidence=0.0,
                    evaluation=f"Error: {str(e)}",
                    is_acceptable=False,
                    quality_score=0.0,
                    issues=[f"Provider error: {str(e)}"],
                    matches_step=False,
                    step_confidence=0.0,
                    extracted_data={},
                    provider=self.config.name,
                    model=self.model,
                    cost=0.0,
                    latency_ms=0,
                    timestamp=datetime.now(),
                    raw_response={"error": str(e)}
                )
                results.append(error_result)

        return results
