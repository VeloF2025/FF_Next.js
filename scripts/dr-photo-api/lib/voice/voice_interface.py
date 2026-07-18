"""Voice interface for BOSS - Talk to BOSS/Claude Code.

Provides real-time voice input/output capabilities:
- Microphone recording
- WhisperX transcription (speech-to-text)
- Text-to-speech output (optional, via system TTS or API)

Usage:
    voice = VoiceInterface()
    text = await voice.listen()  # Record and transcribe
    await voice.speak("Hello!")  # TTS output (optional)
"""

import os
import sys
import wave
import logging
import tempfile
import asyncio
from typing import Optional, Callable, Awaitable, Dict, Any, TYPE_CHECKING
from pathlib import Path

# Audio recording
try:
    import sounddevice as sd
    import numpy as np
    AUDIO_AVAILABLE = True
except ImportError:
    sd = None
    np = None
    AUDIO_AVAILABLE = False

# Type hints for numpy when not available
if TYPE_CHECKING:
    import numpy as np

# Text-to-speech
try:
    import pyttsx3
    TTS_AVAILABLE = True
except ImportError:
    pyttsx3 = None
    TTS_AVAILABLE = False

from lib.voice.whisper_client import WhisperClient

logger = logging.getLogger(__name__)


class VoiceInterface:
    """Real-time voice interface for BOSS.

    Provides voice input (microphone -> WhisperX) and optional voice output (TTS).
    Designed for hands-free interaction with BOSS commands.

    Features:
    - Push-to-talk or voice activity detection
    - Real-time transcription via WhisperX
    - Optional TTS responses
    - Callback-based architecture for async integration
    """

    def __init__(
        self,
        whisper_url: Optional[str] = None,
        sample_rate: int = 16000,
        channels: int = 1,
        enable_tts: bool = True
    ):
        """Initialize voice interface.

        Args:
            whisper_url: WhisperX service URL (default: localhost:9000)
            sample_rate: Audio sample rate (16000 recommended for Whisper)
            channels: Audio channels (1 = mono)
            enable_tts: Enable text-to-speech output
        """
        self.whisper = WhisperClient(base_url=whisper_url)
        self.sample_rate = sample_rate
        self.channels = channels
        self.enable_tts = enable_tts

        # Audio recording state
        self.recording = False
        self.audio_buffer = []

        # TTS engine (optional)
        self.tts_engine = None
        if enable_tts and TTS_AVAILABLE:
            try:
                self.tts_engine = pyttsx3.init()
                self.tts_engine.setProperty('rate', 175)  # Speed
                logger.info("TTS engine initialized")
            except Exception as e:
                logger.warning(f"TTS init failed: {e}")

        # Check audio availability
        if not AUDIO_AVAILABLE:
            logger.warning("sounddevice not installed. Run: pip install sounddevice numpy")

        logger.info(f"VoiceInterface initialized (sample_rate={sample_rate}, tts={enable_tts})")

    async def listen(
        self,
        duration: float = 5.0,
        silence_threshold: float = 0.01,
        silence_duration: float = 1.5,
        language: Optional[str] = None
    ) -> str:
        """Record audio and transcribe to text.

        Args:
            duration: Maximum recording duration in seconds
            silence_threshold: RMS threshold for silence detection
            silence_duration: Seconds of silence to stop recording
            language: Force language (auto-detect if None)

        Returns:
            Transcribed text from speech
        """
        if not AUDIO_AVAILABLE:
            raise RuntimeError("Audio recording not available. Install sounddevice: pip install sounddevice numpy")

        logger.info(f"Listening for up to {duration}s...")

        # Record audio
        audio_data = await self._record_audio(
            duration=duration,
            silence_threshold=silence_threshold,
            silence_duration=silence_duration
        )

        if len(audio_data) == 0:
            logger.warning("No audio recorded")
            return ""

        # Save to temp file for WhisperX
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            temp_path = f.name
            self._save_wav(f.name, audio_data)

        try:
            # Transcribe with WhisperX
            result = await self.whisper.transcribe(
                temp_path,
                language=language
            )
            text = result.get("text", "").strip()
            logger.info(f"Transcribed: {text[:100]}...")
            return text
        finally:
            # Clean up temp file
            try:
                os.unlink(temp_path)
            except Exception:
                pass

    async def _record_audio(
        self,
        duration: float,
        silence_threshold: float,
        silence_duration: float
    ) -> "np.ndarray":
        """Record audio from microphone with silence detection.

        Args:
            duration: Max recording time
            silence_threshold: RMS threshold for silence
            silence_duration: Seconds of silence to stop

        Returns:
            NumPy array of audio samples
        """
        print("\n[Recording... speak now]")
        sys.stdout.flush()

        frames = []
        silence_frames = 0
        frames_per_silence = int(self.sample_rate * silence_duration)

        def callback(indata, frames_count, time_info, status):
            nonlocal silence_frames
            if status:
                logger.warning(f"Audio status: {status}")

            frames.append(indata.copy())

            # Check for silence
            rms = np.sqrt(np.mean(indata**2))
            if rms < silence_threshold:
                silence_frames += frames_count
            else:
                silence_frames = 0

        # Record with callback
        block_size = int(self.sample_rate * 0.1)  # 100ms blocks
        with sd.InputStream(
            samplerate=self.sample_rate,
            channels=self.channels,
            dtype='float32',
            blocksize=block_size,
            callback=callback
        ):
            # Record until duration or silence
            start_time = asyncio.get_event_loop().time()
            while True:
                await asyncio.sleep(0.1)
                elapsed = asyncio.get_event_loop().time() - start_time

                if elapsed >= duration:
                    print("[Max duration reached]")
                    break

                if silence_frames >= frames_per_silence and len(frames) > 5:
                    print("[Silence detected]")
                    break

        print("[Recording complete]\n")

        if not frames:
            return np.array([])

        # Concatenate all frames
        audio_data = np.concatenate(frames, axis=0)
        return audio_data

    def _save_wav(self, path: str, audio_data: "np.ndarray") -> None:
        """Save audio data to WAV file.

        Args:
            path: Output file path
            audio_data: NumPy array of audio samples
        """
        # Convert float32 to int16
        audio_int16 = (audio_data * 32767).astype(np.int16)

        with wave.open(path, 'wb') as wf:
            wf.setnchannels(self.channels)
            wf.setsampwidth(2)  # 16-bit
            wf.setframerate(self.sample_rate)
            wf.writeframes(audio_int16.tobytes())

    async def speak(self, text: str) -> None:
        """Convert text to speech and play.

        Args:
            text: Text to speak
        """
        if not self.enable_tts:
            logger.debug("TTS disabled, skipping speech output")
            return

        if not self.tts_engine:
            logger.warning("TTS engine not available")
            return

        logger.info(f"Speaking: {text[:50]}...")

        # Run TTS in thread pool (pyttsx3 is blocking)
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self._speak_sync, text)

    def _speak_sync(self, text: str) -> None:
        """Synchronous TTS (runs in thread pool)."""
        try:
            self.tts_engine.say(text)
            self.tts_engine.runAndWait()
        except Exception as e:
            logger.error(f"TTS error: {e}")

    async def health_check(self) -> Dict[str, bool]:
        """Check all voice interface components.

        Returns:
            Dict with component status
        """
        status = {
            "audio_recording": AUDIO_AVAILABLE,
            "tts": TTS_AVAILABLE and self.tts_engine is not None,
            "whisper": await self.whisper.health_check()
        }
        return status


# Type alias for voice command handlers
VoiceCommandHandler = Callable[[str], Awaitable[str]]


class VoiceCommandLoop:
    """Continuous voice command loop for BOSS.

    Listens for voice commands and executes them through a handler.
    Supports wake word detection (optional) and continuous listening.

    Usage:
        async def handle_command(text: str) -> str:
            return f"You said: {text}"

        loop = VoiceCommandLoop(handler=handle_command)
        await loop.run()
    """

    def __init__(
        self,
        handler: VoiceCommandHandler,
        voice_interface: Optional[VoiceInterface] = None,
        wake_word: Optional[str] = None,
        speak_responses: bool = True
    ):
        """Initialize voice command loop.

        Args:
            handler: Async function to handle voice commands
            voice_interface: VoiceInterface instance (created if None)
            wake_word: Optional wake word (e.g., "hey boss")
            speak_responses: Speak responses via TTS
        """
        self.handler = handler
        self.voice = voice_interface or VoiceInterface()
        self.wake_word = wake_word.lower() if wake_word else None
        self.speak_responses = speak_responses
        self.running = False

    async def run(self) -> None:
        """Run continuous voice command loop."""
        self.running = True
        logger.info("Voice command loop started")

        if self.wake_word:
            print(f"Say '{self.wake_word}' to activate...")
        else:
            print("Listening for commands...")

        while self.running:
            try:
                # Listen for input
                text = await self.voice.listen(duration=10.0)

                if not text:
                    continue

                # Check wake word if configured
                if self.wake_word:
                    if self.wake_word not in text.lower():
                        continue
                    # Remove wake word from command
                    text = text.lower().replace(self.wake_word, "").strip()

                if not text:
                    continue

                print(f"\nYou: {text}")

                # Handle command
                response = await self.handler(text)
                print(f"BOSS: {response}")

                # Speak response
                if self.speak_responses:
                    await self.voice.speak(response)

            except KeyboardInterrupt:
                print("\nStopping voice loop...")
                self.running = False
            except Exception as e:
                logger.error(f"Voice loop error: {e}")
                await asyncio.sleep(1)

        logger.info("Voice command loop stopped")

    def stop(self) -> None:
        """Stop the voice command loop."""
        self.running = False
