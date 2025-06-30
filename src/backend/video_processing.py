import os
import tempfile
import uuid
import logging
from pathlib import Path
from typing import Tuple, Optional

from google.cloud import storage, texttospeech
from moviepy.editor import VideoFileClip, AudioFileClip, CompositeAudioClip

# ==============================================================================
# 1. INITIALIZATION AND CONFIGURATION
# ==============================================================================

logger = logging.getLogger("VideoProcessingService")
logging.basicConfig(level=logging.INFO)

storage_client = None
tts_client = None

def _initialize_clients(project_id: str):
    """Initializes GCS and TTS clients if they haven't been already."""
    global storage_client, tts_client
    if storage_client is None:
        storage_client = storage.Client(project=project_id)
        logger.info("Google Cloud Storage client initialized.")
    if tts_client is None:
        tts_client = texttospeech.TextToSpeechClient()
        logger.info("Google Cloud Text-to-Speech client initialized.")

def _parse_gcs_uri(gcs_uri: str) -> Tuple[str, str]:
    """Parses a GCS URI into bucket name and blob name."""
    if not gcs_uri.startswith("gs://"):
        raise ValueError("Invalid GCS URI. Must start with 'gs://'.")
    parts = gcs_uri[5:].split("/", 1)
    if len(parts) != 2:
        raise ValueError("Invalid GCS URI format. Expected 'gs://<bucket>/<blob>'.")
    return parts[0], parts[1]

# ==============================================================================
# 2. CORE VIDEO PROCESSING FUNCTIONS
# ==============================================================================

def apply_clipping(
    input_video_path: str,
    output_video_path: str,
    start_time: Optional[float] = None,
    end_time: Optional[float] = None
) -> float:
    """
    Clips a video to the specified start and end times.
    Returns the duration of the new clip.
    """
    logger.info(f"Clipping video from {start_time}s to {end_time}s.")
    duration = 0
    with VideoFileClip(input_video_path) as video:
        subclip = video.subclip(start_time, end_time)
        duration = subclip.duration
        subclip.write_videofile(output_video_path, codec="libx264", audio_codec="aac")
    logger.info(f"Successfully clipped video and saved to {output_video_path}.")
    return duration


def apply_voiceover(
    project_id: str,
    input_video_path: str,
    output_video_path: str,
    text_to_speak: str,
    voice_name: str = "en-US-Wavenet-D",
    language_code: str = "en-US"
) -> float:
    """
    Adds a voiceover to a video from text.
    Returns the duration of the new video.
    """
    _initialize_clients(project_id)
    logger.info(f"Generating voiceover for text: '{text_to_speak[:50]}...'")

    synthesis_input = texttospeech.SynthesisInput(text=text_to_speak)
    voice = texttospeech.VoiceSelectionParams(language_code=language_code, name=voice_name)
    audio_config = texttospeech.AudioConfig(audio_encoding=texttospeech.AudioEncoding.MP3)

    response = tts_client.synthesize_speech(
        input=synthesis_input, voice=voice, audio_config=audio_config
    )

    # Save the generated audio to a temporary file
    with tempfile.NamedTemporaryFile(delete=False, suffix=".mp3") as temp_audio_file:
        temp_audio_path = temp_audio_file.name
        temp_audio_file.write(response.audio_content)
    logger.info(f"TTS audio content written to temporary file {temp_audio_path}")

    # Combine with video
    with VideoFileClip(input_video_path) as video:
        original_audio = video.audio
        generated_audio = AudioFileClip(temp_audio_path)

        # If the generated audio is longer than the video, it will be cut off.
        if generated_audio.duration > video.duration:
            generated_audio = generated_audio.subclip(0, video.duration)

        # Check if the original video has an audio track.
        if original_audio:
            # If it does, composite the original audio with the new voiceover.
            final_audio = CompositeAudioClip([original_audio, generated_audio.set_start(0)])
            video.audio = final_audio
        else:
            # If it doesn't, just set the new voiceover as the audio.
            video.audio = generated_audio

        video.write_videofile(output_video_path, codec="libx264", audio_codec="aac")

    duration = VideoFileClip(output_video_path).duration
    os.remove(temp_audio_path) # Clean up the temporary audio file
    logger.info(f"Successfully added voiceover and saved video to {output_video_path}.")
    return duration


def process_video_from_gcs(
    project_id: str,
    gcs_uri: str,
    operation: str,
    user_folder: str,
    **kwargs
) -> Tuple[str, float]:
    """
    Main handler to download, process, and re-upload a video.

    Returns:
        A tuple of (GCS URI of the new video, duration of the new video).
    """
    _initialize_clients(project_id)
    bucket_name, blob_name = _parse_gcs_uri(gcs_uri)
    bucket = storage_client.bucket(bucket_name)
    source_blob = bucket.blob(blob_name)

    with tempfile.TemporaryDirectory() as temp_dir:
        input_path = os.path.join(temp_dir, source_blob.name.split("/")[-1])
        output_path = os.path.join(temp_dir, f"processed_{uuid.uuid4().hex}_{Path(input_path).name}")
        duration = 0

        # Download
        logger.info(f"Downloading {gcs_uri} to {input_path}...")
        source_blob.download_to_filename(input_path)

        # Process
        if operation == 'clip':
            duration = apply_clipping(
                input_path,
                output_path,
                start_time=kwargs.get('start_time'),
                end_time=kwargs.get('end_time')
            )
        elif operation == 'dub':
            duration = apply_voiceover(
                project_id,
                input_path,
                output_path,
                text_to_speak=kwargs.get('text')
            )
        else:
            raise ValueError(f"Unknown operation: {operation}")

        # Upload
        output_blob_name = f"veo_outputs/{user_folder}/processed/{Path(output_path).name}"
        logger.info(f"Uploading processed video {output_path} to gs://{bucket_name}/{output_blob_name}...")
        target_blob = bucket.blob(output_blob_name)
        target_blob.upload_from_filename(output_path)

    return f"gs://{bucket_name}/{output_blob_name}", duration
