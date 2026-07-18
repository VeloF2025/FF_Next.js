"""
OpenAI GPT-4 Vision Provider - OpenAI's GPT-4 Vision Model

Implements VisionProvider interface for OpenAI's GPT-4 Vision API.
High-quality fallback option ($0.01/photo).

Phase 4.3 Implementation - OpenAI GPT-4V Integration
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


class OpenAIVisionProvider(VisionProvider):
    """
    OpenAI GPT-4 Vision provider implementation.

    Uses GPT-4 Vision for high-quality photo evaluation.

    Cost: $0.01 per image
    Latency: ~3-5 seconds
    Accuracy: Very High (excellent for complex analysis)
    """

    def __init__(self, config: ProviderConfig):
        """
        Initialize OpenAI Vision provider.

        Args:
            config: Provider configuration with API key
        """
        super().__init__(config)

        self.api_key = config.api_key
        self.model = config.model or "gpt-4-vision-preview"
        self.base_url = "https://api.openai.com/v1"

        if not self.api_key:
            logger.warning("OpenAI API key not configured")
            self.status = ProviderStatus.DISABLED

        logger.info(f"OpenAI Vision provider ready: {self.model}")

    async def evaluate_photo(
        self,
        image_path: Path,
        prompt: str,
        step_config: Dict[str, Any]
    ) -> VisionResult:
        """
        Evaluate a photo using OpenAI GPT-4 Vision API.

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
                "OpenAI provider disabled - no API key configured",
                provider=self.config.name
            )

        start_time = time.time()

        try:
            # Read and encode image
            with open(image_path, "rb") as f:
                image_data = base64.b64encode(f.read()).decode("utf-8")

            # Build enhanced prompt with step context
            enhanced_prompt = self._build_prompt(prompt, step_config)

            # Call OpenAI Vision API
            url = f"{self.base_url}/chat/completions"

            headers = {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json"
            }

            payload = {
                "model": self.model,
                "messages": [
                    {
                        "role": "system",
                        "content": "You are an expert quality assurance inspector for fiber optic installations. Provide precise, objective evaluations of installation photos."
                    },
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": enhanced_prompt
                            },
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/jpeg;base64,{image_data}",
                                    "detail": "high"  # High detail for better analysis
                                }
                            }
                        ]
                    }
                ],
                "max_tokens": 1000,
                "temperature": 0.2  # Low temperature for consistent evaluation
            }

            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(url, json=payload, headers=headers)
                response.raise_for_status()
                result = response.json()

            # Parse OpenAI response
            text_response = result["choices"][0]["message"]["content"]
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
                f"OpenAI evaluation complete: {image_path.name} - "
                f"acceptable={vision_result.is_acceptable}, "
                f"confidence={vision_result.confidence:.2f}, "
                f"latency={latency_ms}ms"
            )

            return vision_result

        except httpx.HTTPStatusError as e:
            # HTTP error from OpenAI API
            latency_ms = int((time.time() - start_time) * 1000)
            self._track_call(0.0, latency_ms, success=False)

            error_msg = f"OpenAI API error: {e.response.status_code} - {e.response.text}"
            logger.error(error_msg)

            raise ProviderError(error_msg, provider=self.config.name, original_error=e)

        except Exception as e:
            # Other errors
            latency_ms = int((time.time() - start_time) * 1000)
            self._track_call(0.0, latency_ms, success=False)

            error_msg = f"OpenAI evaluation failed: {str(e)}"
            logger.error(error_msg, exc_info=True)

            raise ProviderError(error_msg, provider=self.config.name, original_error=e)

    async def health_check(self) -> ProviderStatus:
        """
        Check OpenAI API health and availability.

        Returns:
            ProviderStatus indicating current availability
        """
        if not self.api_key:
            self.status = ProviderStatus.DISABLED
            return self.status

        try:
            # Simple health check - list models
            url = f"{self.base_url}/models"

            headers = {
                "Authorization": f"Bearer {self.api_key}"
            }

            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(url, headers=headers)
                response.raise_for_status()

            self.status = ProviderStatus.AVAILABLE
            logger.debug("OpenAI health check: OK")

        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429:
                self.status = ProviderStatus.RATE_LIMITED
                logger.warning("OpenAI health check: RATE LIMITED")
            elif e.response.status_code == 401:
                self.status = ProviderStatus.ERROR
                logger.error("OpenAI health check: AUTHENTICATION ERROR (invalid API key)")
            else:
                self.status = ProviderStatus.ERROR
                logger.error(f"OpenAI health check: ERROR ({e.response.status_code})")

        except Exception as e:
            self.status = ProviderStatus.UNAVAILABLE
            logger.error(f"OpenAI health check: UNAVAILABLE - {e}")

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
            prompt += f"**Required Keywords/Elements:** {', '.join(keywords)}\n"

        prompt += """
**Evaluation Framework:**
1. **Photo Quality** (0-10):
   - Focus and clarity
   - Lighting conditions
   - Framing and composition

2. **Content Verification** (0-10):
   - Expected equipment visible
   - All required elements present
   - Proper installation standards met

3. **Technical Compliance** (0-10):
   - Meets fiber optic installation standards
   - Safety protocols followed
   - Documentation requirements satisfied

**Output Format (JSON-like structure):**
```
STATUS: PASS|FAIL|NEEDS_REVIEW
CONFIDENCE: 0.0-1.0
QUALITY_SCORE: 0.0-1.0
ISSUES: [list any problems]
SUMMARY: Brief assessment
EXTRACTED_DATA: {serial_numbers, barcodes, measurements}
```

Be precise, objective, and flag any concerns immediately.
"""

        return prompt

    def _parse_response(
        self,
        text_response: str,
        step_config: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Parse OpenAI text response into structured evaluation.

        Args:
            text_response: Raw text from OpenAI
            step_config: Step configuration

        Returns:
            Dictionary with parsed evaluation data
        """
        # Parse response - OpenAI tends to be more structured
        text_lower = text_response.lower()

        # Determine if photo is acceptable
        is_pass = any(indicator in text_lower for indicator in [
            "status: pass", "pass", "acceptable", "approved", "meets requirements"
        ])
        is_fail = any(indicator in text_lower for indicator in [
            "status: fail", "fail", "unacceptable", "rejected", "does not meet"
        ])

        if is_pass and not is_fail:
            is_acceptable = True
            confidence = 0.9  # OpenAI typically more confident
            quality_score = 0.85
        elif is_fail:
            is_acceptable = False
            confidence = 0.95
            quality_score = 0.2
        else:
            is_acceptable = False  # Needs review
            confidence = 0.6
            quality_score = 0.5

        # Extract issues
        issues = []
        for line in text_response.split("\n"):
            line_lower = line.lower()
            if any(keyword in line_lower for keyword in [
                "issue", "problem", "concern", "missing", "unclear",
                "poor", "insufficient", "cannot", "not visible", "fail"
            ]):
                cleaned_line = line.strip().lstrip("-•*").strip()
                if cleaned_line and len(cleaned_line) > 5:
                    issues.append(cleaned_line)

        # Extract step match
        matches_step = is_acceptable
        step_confidence = confidence if matches_step else 0.2

        # Extract structured data
        extracted_data = {}

        # Look for serial numbers with better patterns
        import re
        serial_patterns = [
            r'SN[:=\s]+([A-Z0-9-]+)',
            r'Serial[:=\s]+([A-Z0-9-]+)',
            r'S/N[:=\s]+([A-Z0-9-]+)',
            r'serial_number["\']?:\s*["\']?([A-Z0-9-]+)',
        ]
        for pattern in serial_patterns:
            match = re.search(pattern, text_response, re.IGNORECASE)
            if match:
                extracted_data["serial_number"] = match.group(1)
                break

        # Look for barcodes
        barcode_patterns = [
            r'barcode[:=\s]+([A-Z0-9-]+)',
            r'barcode["\']?:\s*["\']?([A-Z0-9-]+)',
        ]
        for pattern in barcode_patterns:
            match = re.search(pattern, text_response, re.IGNORECASE)
            if match:
                extracted_data["barcode"] = match.group(1)
                break

        return {
            "is_acceptable": is_acceptable,
            "confidence": confidence,
            "quality_score": quality_score,
            "matches_step": matches_step,
            "step_confidence": step_confidence,
            "issues": issues[:5],  # Top 5 issues
            "summary": text_response[:600],  # First 600 chars
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

        # Process sequentially (OpenAI API doesn't support true batching)
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
