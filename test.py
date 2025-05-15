import asyncio
import base64
import json
import numpy as np
import os
import websockets
import wave
import contextlib
import pygame
from IPython.display import display, Markdown

# ANSI color codes
GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
BLUE = "\033[94m"
RESET = "\033[0m"

voices = {"Puck", "Charon", "Kore", "Fenrir", "Aoede"}

# --- Configuration ---
MODEL = 'models/gemini-2.0-flash-exp'
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
if not GOOGLE_API_KEY:
    raise EnvironmentError("GOOGLE_API_KEY environment variable is not set.")
HOST = 'generativelanguage.googleapis.com'
URI = f'wss://{HOST}/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key={GOOGLE_API_KEY}'

# Audio parameters
WAVE_CHANNELS = 1  # Mono audio
WAVE_RATE = 24000
WAVE_SAMPLE_WIDTH = 2


@contextlib.contextmanager
def wave_file(filename, channels=WAVE_CHANNELS, rate=WAVE_RATE, sample_width=WAVE_SAMPLE_WIDTH):
    """Context manager for creating and managing wave files."""
    try:
        with wave.open(filename, "wb") as wf:
            wf.setnchannels(channels)
            wf.setsampwidth(sample_width)
            wf.setframerate(rate)
            yield wf
    except wave.Error as e:
        print(f"{RED}Error opening wave file '{filename}': {e}{RESET}")
        raise


async def audio_playback_task(file_name, stop_event):
    """Plays audio using pygame until stopped."""
    print(f"{BLUE}Starting playback: {file_name}{RESET}")
    try:
        pygame.mixer.music.load(file_name)
        pygame.mixer.music.play()
        while pygame.mixer.music.get_busy() and not stop_event.is_set():
            await asyncio.sleep(0.1)
    except pygame.error as e:
        print(f"{RED}Pygame error during playback: {e}{RESET}")
    except Exception as e:
        print(f"{RED}Unexpected error during playback: {e}{RESET}")
    finally:
        print(f"{BLUE}Playback complete: {file_name}{RESET}")


async def generate_audio(ws, text_input: str, voice_name="Kore") -> None:
    """
    Sends text input to the Gemini API, receives an audio response, saves it to a file, and plays it back.
    Relies on the server to maintain the session history.
    """
    pygame.mixer.init()  # Initialize pygame mixer

    msg = {
        "client_content": {
            "turns": [{"role": "user", "parts": [{"text": text_input}]}],
            "turn_complete": True,
        }
    }
    await ws.send(json.dumps(msg))

    responses = []
    async for raw_response in ws:
        response = json.loads(raw_response.decode())
        server_content = response.get("serverContent")
        if server_content is None:
            break

        model_turn = server_content.get("modelTurn")
        if model_turn:
            parts = model_turn.get("parts")
            if parts:
                for part in parts:
                    if "inlineData" in part and "data" in part["inlineData"]:
                        pcm_data = base64.b64decode(part["inlineData"]["data"])
                        responses.append(np.frombuffer(pcm_data, dtype=np.int16))

        turn_complete = server_content.get("turnComplete")
        if turn_complete:
            break

    if responses:
        display(Markdown(f"{YELLOW}**Response >**{RESET}"))
        audio_array = np.concatenate(responses)
        file_name = 'output.wav'
        with wave_file(file_name) as wf:
            wf.writeframes(audio_array.tobytes())
        stop_event = asyncio.Event()
        try:
            await audio_playback_task(file_name, stop_event)
        except Exception as e:
            print(f"{RED}Error during audio playback: {e}{RESET}")
    else:
        print(f"{YELLOW}No audio returned{RESET}")
    pygame.mixer.quit()  # clean up pygame mixer


async def main():
    print(f"{GREEN}Available voices: {', '.join(voices)}{RESET}")
    default_voice = "Kore"
    print(f"{GREEN}Default voice is set to: {default_voice}, you can change it in the code{RESET}")

    config = {
        "response_modalities": ["AUDIO"],
        "speech_config": {
            "voice_config": {
                "prebuilt_voice_config": {
                    "voice_name": default_voice  # Set voice
                }
            }
        }
    }

    async with websockets.connect(URI) as ws:

        async def setup(ws) -> None:
            await ws.send(
                json.dumps(
                    {
                        "setup": {
                            "model": MODEL,
                            "generation_config": config,
                        }
                    }
                )
            )

            raw_response = await ws.recv(decode=False)
            setup_response = json.loads(raw_response.decode("ascii"))
            print(f"{GREEN}Connected: {setup_response}{RESET}")

        await setup(ws)
        while True:
            text_prompt = input(f"{YELLOW}Enter your text (or type 'exit' to quit): {RESET}")
            if text_prompt.lower() == "exit":
                break

            try:
                await generate_audio(ws, text_prompt, default_voice)
            except Exception as e:
                print(f"{RED}An error occurred: {e}{RESET}")


if __name__ == "__main__":
    asyncio.run(main())
