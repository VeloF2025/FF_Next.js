"""WhisperX client for speech-to-text transcription.

Uses the local WhisperX ASR webservice (port 9000) for transcription.
This is FREE - no API costs, runs locally.
"""

import os
import logging
from typing import Optional, Dict, Any
from pathlib import Path
import httpx

logger = logging.getLogger(__name__)


class WhisperClient:
    """Client for WhisperX ASR webservice.

    Connects to the local WhisperX container (agriwize-whisper-asr)
    running on port 9000 for speech-to-text transcription.

    Features:
    - Automatic speech recognition (ASR)
    - Language detection
    - Word-level timestamps (optional)
    - Multiple output formats (text, json, srt, vtt)
    """

    def __init__(
        self,
        base_url: Optional[str] = None,
        timeout: float = 300.0,
        output_format: str = "json"
    ):
        """Initialize WhisperX client.

        Args:
            base_url: WhisperX service URL (default: http://localhost:9000)
            timeout: Request timeout in seconds (default: 300s for long audio)
            output_format: Output format (text, json, srt, vtt)
        """
        self.base_url = base_url or os.getenv("WHISPER_URL", "http://localhost:9000")
        self.timeout = timeout
        self.output_format = output_format

        logger.info(f"WhisperClient initialized ({self.base_url})")

    async def transcribe(
        self,
        audio_path: str,
        language: Optional[str] = None,
        task: str = "transcribe",
        output_format: Optional[str] = None,
        word_timestamps: bool = False
    ) -> Dict[str, Any]:
        """Transcribe audio file to text.

        Args:
            audio_path: Path to audio file (wav, mp3, etc.)
            language: Source language code (e.g., "en", "es"). Auto-detected if None.
            task: "transcribe" or "translate" (to English)
            output_format: Override default output format
            word_timestamps: Include word-level timestamps

        Returns:
            Dict with transcription result:
            {
                "text": "transcribed text",
                "language": "en",
                "segments": [...],  # if json format
                "duration": 10.5
            }
        """
        audio_path = Path(audio_path)
        if not audio_path.exists():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        logger.info(f"Transcribing: {audio_path.name}")

        # Build query parameters
        params = {
            "task": task,
            "output": output_format or self.output_format,
            "word_timestamps": str(word_timestamps).lower()
        }
        if language:
            params["language"] = language

        # Send file for transcription
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            with open(audio_path, "rb") as f:
                files = {"audio_file": (audio_path.name, f, "audio/wav")}
                response = await client.post(
                    f"{self.base_url}/asr",
                    files=files,
                    params=params
                )

        if response.status_code != 200:
            logger.error(f"Transcription failed: {response.status_code}")
            raise RuntimeError(f"WhisperX error: {response.status_code} - {response.text}")

        result = response.json() if self.output_format == "json" else {"text": response.text}

        logger.info(f"Transcription complete: {len(result.get('text', ''))} chars")
        return result

    async def transcribe_bytes(
        self,
        audio_bytes: bytes,
        filename: str = "audio.wav",
        language: Optional[str] = None,
        task: str = "transcribe"
    ) -> Dict[str, Any]:
        """Transcribe audio from bytes.

        Args:
            audio_bytes: Raw audio data
            filename: Filename for the upload
            language: Source language code
            task: "transcribe" or "translate"

        Returns:
            Transcription result dict
        """
        logger.info(f"Transcribing audio bytes ({len(audio_bytes)} bytes)")

        params = {"task": task, "output": "json"}
        if language:
            params["language"] = language

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            files = {"audio_file": (filename, audio_bytes, "audio/wav")}
            response = await client.post(
                f"{self.base_url}/asr",
                files=files,
                params=params
            )

        if response.status_code != 200:
            raise RuntimeError(f"WhisperX error: {response.status_code}")

        return response.json()

    async def detect_language(self, audio_path: str) -> str:
        """Detect language of audio file.

        Args:
            audio_path: Path to audio file

        Returns:
            Detected language code (e.g., "en", "es")
        """
        audio_path = Path(audio_path)
        if not audio_path.exists():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        logger.info(f"Detecting language: {audio_path.name}")

        async with httpx.AsyncClient(timeout=60.0) as client:
            with open(audio_path, "rb") as f:
                files = {"audio_file": (audio_path.name, f, "audio/wav")}
                response = await client.post(
                    f"{self.base_url}/detect-language",
                    files=files
                )

        if response.status_code != 200:
            raise RuntimeError(f"Language detection failed: {response.status_code}")

        result = response.json()
        detected_lang = result.get("detected_language", "unknown")
        logger.info(f"Detected language: {detected_lang}")
        return detected_lang

    async def health_check(self) -> bool:
        """Check if WhisperX service is available.

        Returns:
            True if service is healthy
        """
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{self.base_url}/docs")
                return response.status_code == 200
        except Exception as e:
            logger.warning(f"WhisperX health check failed: {e}")
            return False
