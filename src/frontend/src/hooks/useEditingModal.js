import { useState } from 'react';
import axios from 'axios';

export const useEditingModal = (onActionComplete) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [modalMode, setModalMode] = useState(null); // 'clip' or 'dub'

  const openModal = (video, mode) => {
    // In HistoryPage, the GCS path is in a JSON string.
    // In Dashboard, it's directly on the object. We need to handle both.
    let gcsUri;
    if (typeof video.output_video_gcs_paths === 'string') {
      const gcsPaths = JSON.parse(video.output_video_gcs_paths);
      gcsUri = gcsPaths?.[0];
    } else {
      // Assumes it's the format from the generate endpoint: { gcs_uri: '...', signed_url: '...' }
      gcsUri = video.gcs_uri;
    }

    // Also handle signed_urls being a string array (from history) or part of the object
    const signedUrl = Array.isArray(video.signed_urls) ? video.signed_urls[0] : video.signed_url;

    if (!gcsUri || !signedUrl) {
        console.error("Could not determine GCS URI or Signed URL for editing.", video);
        // Optionally, show an error to the user.
        return;
    }
    
    setSelectedVideo({ ...video, gcs_uri: gcsUri, signed_url: signedUrl });
    setModalMode(mode);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setSelectedVideo(null);
    setModalMode(null);
  };

  const handleSubmit = async (formData) => {
    if (!selectedVideo || !modalMode) return;

    const payload = {
      gcs_uri: selectedVideo.gcs_uri,
      ...formData,
    };

    const endpoint = modalMode === 'clip' ? '/api/videos/edit' : '/api/videos/dub';
    
    // Let the modal's internal state handle loading/errors.
    // This function will re-throw the error on failure.
    const response = await axios.post(endpoint, payload);

    // If an onActionComplete callback is provided, call it with the result.
    if (onActionComplete) {
      // The response for edit/dub contains the new URI and signed URL
      const newVideoData = {
          gcs_uri: response.data.processed_video_uri,
          signed_url: response.data.signed_url,
      };
      onActionComplete(selectedVideo, newVideoData);
    }
  };

  return {
    modalOpen,
    selectedVideo,
    modalMode,
    openModal,
    closeModal,
    handleSubmit,
  };
};
