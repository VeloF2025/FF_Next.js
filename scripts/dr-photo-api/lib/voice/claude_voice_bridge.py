"""Voice-to-Claude-Code Bridge.

Enables talking to Claude Code via voice:
1. Listen to microphone input
2. Transcribe with WhisperX (FREE, local)
3. Send to Claude via Anthropic API (more reliable than CLI subprocess)
4. Optionally speak the response

Usage:
    python -m lib.voice.claude_voice_bridge

Or via CLI:
    boss voice claude
"""

import os
import sys
import asyncio
import logging
from typing import Optional

from lib.voice.voice_interface import VoiceInterface

logger = logging.getLogger(__name__)

# Try to import anthropic for direct API calls
try:
    import anthropic
    ANTHROPIC_AVAILABLE = True
except ImportError:
    ANTHROPIC_AVAILABLE = False
    logger.warning("anthropic package not installed. Run: pip install anthropic")


class ClaudeVoiceBridge:
    """Bridge between voice input and Claude Code CLI.

    Listens for voice commands and sends them to Claude Code,
    enabling hands-free coding assistance.
    """

    def __init__(
        self,
        whisper_url: Optional[str] = None,
        wake_word: Optional[str] = None,
        speak_responses: bool = False,
        print_mode: bool = True
    ):
        """Initialize Claude Voice Bridge.

        Args:
            whisper_url: WhisperX service URL
            wake_word: Optional wake word (e.g., "hey claude")
            speak_responses: Enable TTS for responses
            print_mode: Use --print mode (non-interactive)
        """
        self.voice = VoiceInterface(
            whisper_url=whisper_url,
            enable_tts=speak_responses
        )
        self.wake_word = wake_word.lower() if wake_word else None
        self.speak_responses = speak_responses
        self.print_mode = print_mode
        self.running = False

    async def send_to_claude(self, message: str) -> str:
        """Send a message to Claude via Anthropic API directly.

        Uses the Anthropic Python SDK for reliable, fast responses.
        Claude CLI subprocess calls hang from within Claude sessions.

        Args:
            message: The voice command/question to send

        Returns:
            Claude's response text
        """
        if not ANTHROPIC_AVAILABLE:
            return "Error: anthropic package not installed. Run: pip install anthropic"

        try:
            # Get API key from environment
            api_key = os.environ.get("ANTHROPIC_API_KEY")
            if not api_key:
                return "Error: ANTHROPIC_API_KEY not set in environment"

            logger.info(f"Sending to Claude: {message[:50]}...")

            # Create client and send message
            client = anthropic.Anthropic(api_key=api_key)

            # System prompt for voice assistant context
            system_prompt = """You are a helpful voice assistant integrated with a coding workspace.
The user is speaking voice commands. Keep responses concise (1-3 sentences) unless they ask for details.
You can help with coding questions, file operations, and general tasks.
Current working directory: """ + os.getcwd()

            response = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=1024,
                system=system_prompt,
                messages=[
                    {"role": "user", "content": message}
                ]
            )

            # Extract text from response
            if response.content and len(response.content) > 0:
                result = response.content[0].text
                logger.info(f"Claude response: {len(result)} chars")
                return result
            else:
                return "No response from Claude."

        except anthropic.APIConnectionError:
            return "Error: Could not connect to Anthropic API. Check internet connection."
        except anthropic.RateLimitError:
            return "Error: Rate limited by Anthropic API. Please wait."
        except anthropic.APIStatusError as e:
            logger.error(f"Claude API error: {e}")
            return f"Error: API error - {e.message}"
        except Exception as e:
            logger.error(f"Failed to send to Claude: {e}")
            return f"Error communicating with Claude: {e}"

    async def listen_once(self, duration: float = 10.0) -> Optional[str]:
        """Listen for a single voice command.

        Args:
            duration: Max recording duration

        Returns:
            Transcribed text or None
        """
        print("\n[Listening... speak your command]")

        text = await self.voice.listen(
            duration=duration,
            silence_duration=2.0
        )

        if not text or text.strip() in ["", "...", ". . ."]:
            return None

        # Check wake word
        if self.wake_word:
            if self.wake_word not in text.lower():
                print(f"(Waiting for wake word: '{self.wake_word}')")
                return None
            # Remove wake word
            text = text.lower().replace(self.wake_word, "").strip()

        return text

    async def run_single(self, duration: float = 10.0) -> None:
        """Run a single voice-to-Claude interaction.

        Args:
            duration: Max recording duration
        """
        print("\n=== VOICE TO CLAUDE CODE ===")
        print("Speak your command after the prompt.\n")

        # Listen for command
        text = await self.listen_once(duration)

        if not text:
            print("[No command detected]")
            return

        print(f"\nYou said: {text}")
        print("\n[Sending to Claude Code...]")

        # Send to Claude
        response = await self.send_to_claude(text)

        print(f"\n--- Claude's Response ---\n")
        print(response)
        print("\n-------------------------")

        # Speak response if enabled
        if self.speak_responses and response:
            # Only speak first 500 chars to avoid long TTS
            speak_text = response[:500]
            if len(response) > 500:
                speak_text += "... (response truncated for speech)"
            await self.voice.speak(speak_text)

    async def run_loop(self) -> None:
        """Run continuous voice command loop."""
        self.running = True

        print("\n=== VOICE TO CLAUDE CODE (CONTINUOUS) ===")
        if self.wake_word:
            print(f"Say '{self.wake_word}' followed by your command.")
        else:
            print("Speak your commands. Press Ctrl+C to stop.")
        print("=" * 45 + "\n")

        while self.running:
            try:
                # Listen for command
                text = await self.listen_once(duration=15.0)

                if not text:
                    continue

                print(f"\nYou: {text}")
                print("[Processing...]")

                # Send to Claude
                response = await self.send_to_claude(text)

                print(f"\nClaude: {response}\n")

                # Speak if enabled
                if self.speak_responses:
                    speak_text = response[:500]
                    await self.voice.speak(speak_text)

            except KeyboardInterrupt:
                print("\n\nStopping voice loop...")
                self.running = False
            except Exception as e:
                logger.error(f"Loop error: {e}")
                print(f"[Error: {e}]")
                await asyncio.sleep(1)

        print("Voice loop stopped.")

    def stop(self) -> None:
        """Stop the voice loop."""
        self.running = False


async def main():
    """Main entry point for voice-to-Claude bridge."""
    import argparse

    parser = argparse.ArgumentParser(description="Talk to Claude Code with your voice")
    parser.add_argument("--loop", action="store_true", help="Run in continuous loop mode")
    parser.add_argument("--wake-word", help="Wake word to activate (e.g., 'hey claude')")
    parser.add_argument("--speak", action="store_true", help="Speak responses via TTS")
    parser.add_argument("--duration", type=float, default=10.0, help="Recording duration")

    args = parser.parse_args()

    bridge = ClaudeVoiceBridge(
        wake_word=args.wake_word,
        speak_responses=args.speak
    )

    # Check voice services
    status = await bridge.voice.health_check()
    if not status.get("whisper"):
        print("ERROR: WhisperX not available at localhost:9000")
        print("Start WhisperX: docker run -p 9000:9000 onerahmet/openai-whisper-asr-webservice")
        sys.exit(1)

    if not status.get("audio_recording"):
        print("ERROR: Audio recording not available")
        print("Install: pip install sounddevice numpy")
        sys.exit(1)

    print("Voice services OK")

    if args.loop:
        await bridge.run_loop()
    else:
        await bridge.run_single(duration=args.duration)


if __name__ == "__main__":
    asyncio.run(main())
