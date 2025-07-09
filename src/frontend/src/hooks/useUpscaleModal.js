import { useState } from 'react';
import axios from 'axios';

export const useUpscaleModal = (onActionComplete) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState(null);

  const openModal = (video) => {
    let gcsUri;
    if (typeof video.output_video_gcs_paths === 'string') {
      const gcsPaths = JSON.parse(video.output_video_gcs_paths);
      gcsUri = gcsPaths?.[0];
    } else {
      gcsUri = video.gcs_uri;
    }

    const signedUrl = Array.isArray(video.signed_urls) ? video.signed_urls[0] : video.signed_url;

    if (!gcsUri || !signedUrl) {
        console.error("Could not determine GCS URI or Signed URL for upscaling.", video);
        return;
    }
    
    setSelectedVideo({ ...video, gcs_uri: gcsUri, signed_url: signedUrl });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setSelectedVideo(null);
  };

  const handleSubmit = async (formData) => {
    if (!selectedVideo) return;

    const payload = {
      gcs_uri: selectedVideo.gcs_uri,
      ...formData,
    };

    const response = await axios.post('/api/videos/upscale', payload);

    if (onActionComplete) {
      onActionComplete(selectedVideo, response.data);
    }
  };

  return {
    modalOpen,
    selectedVideo,
    openModal,
    closeModal,
    handleSubmit,
  };
};
