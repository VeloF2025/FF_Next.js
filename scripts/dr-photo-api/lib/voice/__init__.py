"""Voice interface library for BOSS.

Provides speech-to-text (WhisperX) and text-to-speech capabilities
for voice interaction with BOSS and Claude Code.
"""

from lib.voice.whisper_client import WhisperClient
from lib.voice.voice_interface import VoiceInterface
from lib.voice.claude_voice_bridge import ClaudeVoiceBridge

__all__ = ["WhisperClient", "VoiceInterface", "ClaudeVoiceBridge"]
