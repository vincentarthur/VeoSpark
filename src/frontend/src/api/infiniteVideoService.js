import axios from 'axios';

/**
 * Captures a frame from a video (either uploaded file or remote URL)
 * and returns the GCS URI of the captured image.
 */
export const captureFrame = async ({ sourceVideoFile, videoUrl, timestamp }) => {
  const formData = new FormData();
  formData.append('timestamp', timestamp);

  if (sourceVideoFile) {
    formData.append('video_file', sourceVideoFile);
  } else if (videoUrl) {
    formData.append('video_url', videoUrl);
  } else {
    throw new Error("No source video provided for frame capture.");
  }

  const response = await axios.post('/api/tools/capture_frame', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });

  if (!response.data.gcs_uri) {
    throw new Error("Failed to capture frame: No GCS URI returned.");
  }

  return response.data.gcs_uri;
};

/**
 * Signs a GCS URI to get a playable URL.
 */
export const signUrl = async (gcsUri) => {
  if (!gcsUri) return null;
  try {
    const response = await axios.post('/api/tools/sign_url', { gcs_uri: gcsUri });
    return response.data.signed_url;
  } catch (error) {
    console.error("Error signing URL:", error);
    return null;
  }
};

/**
 * Polls a task until completion or failure.
 * Returns the final result object.
 */
export const pollTask = async (taskId) => {
  return new Promise((resolve, reject) => {
    const checkStatus = async () => {
      try {
        const response = await axios.get(`/api/tasks/${taskId}`);
        const { status, result, error } = response.data;

        if (status === 'SUCCESS') {
          resolve(result);
        } else if (status === 'FAILURE') {
          reject(new Error(error || "Task failed"));
        } else {
          // PENDING or RUNNING
          setTimeout(checkStatus, 2000);
        }
      } catch (err) {
        reject(err);
      }
    };
    checkStatus();
  });
};

/**
 * Orchestrates the video generation process:
 * 1. Starts generation task
 * 2. Polls for completion
 * 3. Ensures the result has a valid signed URL (re-signing if necessary)
 */
export const generateVideo = async ({ prompt, imageGcsUri, model, creative_project_id, duration, resolution, aspectRatio, generateAudio }) => {
  // 1. Start Generation
  const payload = {
    model: model || 'veo-3.1-fast-generate-preview',
    prompt: prompt || "A cinematic shot",
    image_gcs_uri: imageGcsUri,
    aspectRatio: aspectRatio || '16:9',
    duration: duration || 8,
    sampleCount: 1,
    resolution: resolution || '1080p',
    generateAudio: generateAudio !== undefined ? generateAudio : true,
    creative_project_id: creative_project_id
  };

  const startResponse = await axios.post('/api/videos/generate', payload);
  const taskId = startResponse.data.task_id;

  // 2. Poll for Result
  const result = await pollTask(taskId);

  // 3. Extract and Verify URL
  const videoData = result.videos && result.videos[0];
  if (!videoData) {
    throw new Error("Generation succeeded but no video data returned.");
  }

  let signedUrl = videoData.signed_url;
  const gcsUri = videoData.gcs_uri;

  // If signed_url is missing or empty, try to sign it now
  if (!signedUrl && gcsUri) {
    signedUrl = await signUrl(gcsUri);
  }

  if (!signedUrl) {
    throw new Error("Could not obtain a valid playback URL for the generated video.");
  }

  return {
    videoUrl: signedUrl,
    gcsUri: gcsUri
  };
};
