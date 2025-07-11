import { useState } from 'react';
import axios from 'axios';

export const useShareModal = (onActionComplete) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);

  const openModal = (item) => {
    let gcsUri;
    const isVideo = 'output_video_gcs_paths' in item || (item.gcs_uri && item.gcs_uri.includes('.mp4'));

    if (isVideo) {
      if (typeof item.output_video_gcs_paths === 'string') {
        const gcsPaths = JSON.parse(item.output_video_gcs_paths);
        gcsUri = gcsPaths?.[0];
      } else {
        gcsUri = item.gcs_uri;
      }
    } else {
      gcsUri = item.output_image_gcs_path;
    }

    if (!gcsUri) {
        console.error("Could not determine GCS URI for sharing.", item);
        return;
    }
    
    setSelectedItem({ ...item, gcs_uri: gcsUri, type: isVideo ? 'video' : 'image' });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setSelectedItem(null);
  };

  const handleSubmit = async (formData) => {
    if (!selectedItem) return;

    const payload = {
      item: selectedItem,
      group_id: formData.group_id,
    };
    
    const endpoint = selectedItem.type === 'video' ? '/api/videos/share' : '/api/images/share';
    const response = await axios.post(endpoint, payload);

    if (onActionComplete) {
      onActionComplete(selectedItem, response.data);
    }
  };

  return {
    modalOpen,
    selectedItem,
    openModal,
    closeModal,
    handleSubmit,
  };
};
