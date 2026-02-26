"""
test_mic.py — Quick diagnostic to verify microphone + Azure Speech are working.

Performs a single 10-second recognition attempt and prints everything
that happens so you can pinpoint the problem.

Usage:
    python test_mic.py
"""

import os
import sys
import time

from dotenv import load_dotenv

load_dotenv()

AZURE_SPEECH_KEY = os.getenv("AZURE_SPEECH_KEY")
AZURE_SPEECH_REGION = os.getenv("AZURE_SPEECH_REGION")
AZURE_SPEECH_LANGUAGE = os.getenv("AZURE_SPEECH_LANGUAGE", "ar-JO")


def main():
    # ── Pre-flight checks ─────────────────────────────────────────────
    print("=" * 60)
    print("  Court STT — Microphone & Azure Diagnostic")
    print("=" * 60)
    print()
    print(f"  AZURE_SPEECH_KEY    : {'…' + AZURE_SPEECH_KEY[-6:] if AZURE_SPEECH_KEY else '❌ MISSING'}")
    print(f"  AZURE_SPEECH_REGION : {AZURE_SPEECH_REGION or '❌ MISSING'}")
    print(f"  AZURE_SPEECH_LANGUAGE: {AZURE_SPEECH_LANGUAGE}")
    print()

    if not AZURE_SPEECH_KEY or not AZURE_SPEECH_REGION:
        print("  ❌  Missing Azure credentials in .env — cannot continue.")
        sys.exit(1)

    import azure.cognitiveservices.speech as speechsdk

    print(f"  Azure Speech SDK version: {speechsdk.__version__}")
    print()

    # ── Configure ─────────────────────────────────────────────────────
    speech_config = speechsdk.SpeechConfig(
        subscription=AZURE_SPEECH_KEY,
        region=AZURE_SPEECH_REGION,
    )
    speech_config.speech_recognition_language = AZURE_SPEECH_LANGUAGE
    speech_config.set_property(
        speechsdk.PropertyId.Speech_LogFilename, "speech_sdk_log.txt"
    )
    # Enable detailed logging so we can inspect speech_sdk_log.txt if needed

    audio_config = speechsdk.audio.AudioConfig(use_default_microphone=True)

    recognizer = speechsdk.SpeechRecognizer(
        speech_config=speech_config,
        audio_config=audio_config,
    )

    # ── Single-shot recognition (up to 15 seconds) ───────────────────
    print("  🎙️  Speak into your microphone now (up to 15 seconds) …")
    print()

    result = recognizer.recognize_once()

    print("  ── Result ──────────────────────────────────────────")
    print(f"  Reason       : {result.reason}")

    if result.reason == speechsdk.ResultReason.RecognizedSpeech:
        print(f"  ✅ Text       : {result.text}")
        print(f"  Offset (ticks): {result.offset}")
        print(f"  Duration      : {result.duration}")
        print()
        print("  🎉  Everything works!  Your mic and Azure are both OK.")

    elif result.reason == speechsdk.ResultReason.NoMatch:
        print(f"  ⚠️  No speech was recognised.")
        print()
        print("  Possible causes:")
        print("    1. No speech was detected — try speaking louder / closer to the mic")
        print("    2. The language model doesn't match what you're saying")
        print(f"       Current language: {AZURE_SPEECH_LANGUAGE}")
        print("    3. The wrong microphone is set as default in Windows Sound settings")
        print()
        print("  💡  Check Windows Settings → System → Sound → Input device")

    elif result.reason == speechsdk.ResultReason.Canceled:
        cancellation = speechsdk.CancellationDetails(result)
        print(f"  ❌ Cancel reason : {cancellation.reason}")
        if cancellation.reason == speechsdk.CancellationReason.Error:
            print(f"  ❌ Error code    : {cancellation.error_code}")
            print(f"  ❌ Error details : {cancellation.error_details}")
            print()
            if "401" in str(cancellation.error_details) or "Unauthorized" in str(cancellation.error_details):
                print("  💡  Your AZURE_SPEECH_KEY appears to be invalid or expired.")
            elif "connection" in str(cancellation.error_details).lower():
                print("  💡  Cannot reach Azure. Check internet / firewall / region.")
            else:
                print("  💡  Check the error details above. Also inspect speech_sdk_log.txt for more info.")
        elif cancellation.reason == speechsdk.CancellationReason.EndOfStream:
            print("  Audio stream ended unexpectedly — microphone may have disconnected.")
    else:
        print(f"  ❓ Unexpected reason: {result.reason}")

    print()
    print("  Log file: speech_sdk_log.txt (detailed SDK trace)")
    print("=" * 60)


if __name__ == "__main__":
    main()
