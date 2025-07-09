import { useState } from 'react';
import axios from 'axios';

export const useShareModal = (onActionComplete) => {
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

    if (!gcsUri) {
        console.error("Could not determine GCS URI for sharing.", video);
        return;
    }
    
    setSelectedVideo({ ...video, gcs_uri: gcsUri });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setSelectedVideo(null);
  };

  const handleSubmit = async (formData) => {
    if (!selectedVideo) return;

    const payload = {
      video: selectedVideo,
      group_id: formData.group_id,
    };

    const response = await axios.post('/api/videos/share', payload);

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
