"""
Gemini Vision Provider - Google's Gemini 2.0 Flash Vision Model

Implements VisionProvider interface for Google's Gemini Vision API.
Cost-effective option for photo evaluation ($0.003/photo).

Phase 4.2 Implementation - Gemini Vision Integration
"""

import base64
import logging
import time
from pathlib import Path
from typing import Dict, Any, List, Optional
from datetime import datetime

import httpx

from lib.ai.vision_provider import (
    VisionProvider,
    VisionResult,
    ProviderConfig,
    ProviderStatus,
    ProviderError,
    ProviderType
)

logger = logging.getLogger(__name__)


class GeminiVisionProvider(VisionProvider):
    """
    Google Gemini Vision provider implementation.

    Uses Gemini 2.0 Flash model for photo evaluation.

    Cost: $0.003 per image
    Latency: ~2-3 seconds
    Accuracy: High (good for detailed analysis)
    """

    def __init__(self, config: ProviderConfig):
        """
        Initialize Gemini Vision provider.

        Args:
            config: Provider configuration with API key
        """
        super().__init__(config)

        self.api_key = config.api_key
        self.model = config.model or "gemini-2.0-flash-exp"
        self.base_url = "https://generativelanguage.googleapis.com/v1beta/models"

        if not self.api_key:
            logger.warning("Gemini API key not configured")
            self.status = ProviderStatus.DISABLED

        logger.info(f"Gemini Vision provider ready: {self.model}")

    async def evaluate_photo(
        self,
        image_path: Path,
        prompt: str,
        step_config: Dict[str, Any]
    ) -> VisionResult:
        """
        Evaluate a photo using Gemini Vision API.

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
                "Gemini provider disabled - no API key configured",
                provider=self.config.name
            )

        start_time = time.time()

        try:
            # Read and encode image
            with open(image_path, "rb") as f:
                image_data = base64.b64encode(f.read()).decode("utf-8")

            # Build enhanced prompt with step context
            enhanced_prompt = self._build_prompt(prompt, step_config)

            # Call Gemini Vision API
            url = f"{self.base_url}/{self.model}:generateContent?key={self.api_key}"

            payload = {
                "contents": [{
                    "parts": [
                        {"text": enhanced_prompt},
                        {
                            "inline_data": {
                                "mime_type": "image/jpeg",
                                "data": image_data
                            }
                        }
                    ]
                }],
                "generationConfig": {
                    "temperature": 0.2,  # Low temperature for consistent evaluation
                    "topK": 32,
                    "topP": 1,
                    "maxOutputTokens": 2048
                }
            }

            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(url, json=payload)
                response.raise_for_status()
                result = response.json()

            # Parse Gemini response
            text_response = result["candidates"][0]["content"]["parts"][0]["text"]
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
                f"Gemini evaluation complete: {image_path.name} - "
                f"acceptable={vision_result.is_acceptable}, "
                f"confidence={vision_result.confidence:.2f}, "
                f"latency={latency_ms}ms"
            )

            return vision_result

        except httpx.HTTPStatusError as e:
            # HTTP error from Gemini API
            latency_ms = int((time.time() - start_time) * 1000)
            self._track_call(0.0, latency_ms, success=False)

            error_msg = f"Gemini API error: {e.response.status_code} - {e.response.text}"
            logger.error(error_msg)

            raise ProviderError(error_msg, provider=self.config.name, original_error=e)

        except Exception as e:
            # Other errors
            latency_ms = int((time.time() - start_time) * 1000)
            self._track_call(0.0, latency_ms, success=False)

            error_msg = f"Gemini evaluation failed: {str(e)}"
            logger.error(error_msg, exc_info=True)

            raise ProviderError(error_msg, provider=self.config.name, original_error=e)

    async def health_check(self) -> ProviderStatus:
        """
        Check Gemini API health and availability.

        Returns:
            ProviderStatus indicating current availability
        """
        if not self.api_key:
            self.status = ProviderStatus.DISABLED
            return self.status

        try:
            # Simple health check - list models
            url = f"{self.base_url}?key={self.api_key}"

            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(url)
                response.raise_for_status()

            self.status = ProviderStatus.AVAILABLE
            logger.debug("Gemini health check: OK")

        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429:
                self.status = ProviderStatus.RATE_LIMITED
                logger.warning("Gemini health check: RATE LIMITED")
            else:
                self.status = ProviderStatus.ERROR
                logger.error(f"Gemini health check: ERROR ({e.response.status_code})")

        except Exception as e:
            self.status = ProviderStatus.UNAVAILABLE
            logger.error(f"Gemini health check: UNAVAILABLE - {e}")

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
            prompt += f"**Look For:** {', '.join(keywords)}\n"

        prompt += """
**Evaluation Criteria:**
1. Photo Quality: Clear, in-focus, proper lighting
2. Content Match: Shows expected equipment/installation
3. Visibility: All required details visible
4. Compliance: Meets installation standards

**Response Format:**
Provide evaluation in this structure:
- Overall Status: PASS/FAIL/NEEDS_REVIEW
- Confidence: 0.0-1.0
- Quality Score: 0.0-1.0
- Issues Detected: List any problems
- Summary: Brief assessment
- Extracted Data: Any serial numbers, barcodes, measurements found

Be precise and objective. Flag any concerns.
"""

        return prompt

    def _parse_response(
        self,
        text_response: str,
        step_config: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Parse Gemini text response into structured evaluation.

        Args:
            text_response: Raw text from Gemini
            step_config: Step configuration

        Returns:
            Dictionary with parsed evaluation data
        """
        # Simple parsing - look for key indicators
        text_lower = text_response.lower()

        # Determine if photo is acceptable
        is_pass = any(indicator in text_lower for indicator in [
            "pass", "acceptable", "approved", "good quality"
        ])
        is_fail = any(indicator in text_lower for indicator in [
            "fail", "unacceptable", "rejected", "poor quality", "reject"
        ])

        if is_pass and not is_fail:
            is_acceptable = True
            confidence = 0.85
            quality_score = 0.8
        elif is_fail:
            is_acceptable = False
            confidence = 0.9
            quality_score = 0.3
        else:
            is_acceptable = False  # Default to needs review
            confidence = 0.5
            quality_score = 0.5

        # Extract issues (lines containing negative keywords)
        issues = []
        for line in text_response.split("\n"):
            line_lower = line.lower()
            if any(keyword in line_lower for keyword in [
                "issue", "problem", "concern", "missing", "unclear",
                "poor", "insufficient", "cannot", "unable"
            ]):
                issues.append(line.strip())

        # Extract step match confidence
        matches_step = is_acceptable
        step_confidence = confidence if matches_step else 0.3

        # Try to extract structured data (serial numbers, barcodes)
        extracted_data = {}

        # Look for serial numbers
        import re
        serial_patterns = [
            r'SN[:=\s]+([A-Z0-9]+)',
            r'Serial[:=\s]+([A-Z0-9]+)',
            r'S/N[:=\s]+([A-Z0-9]+)'
        ]
        for pattern in serial_patterns:
            match = re.search(pattern, text_response, re.IGNORECASE)
            if match:
                extracted_data["serial_number"] = match.group(1)
                break

        return {
            "is_acceptable": is_acceptable,
            "confidence": confidence,
            "quality_score": quality_score,
            "matches_step": matches_step,
            "step_confidence": step_confidence,
            "issues": issues[:5],  # Limit to top 5 issues
            "summary": text_response[:500],  # First 500 chars
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

        # Process sequentially (Gemini API doesn't support true batching)
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
