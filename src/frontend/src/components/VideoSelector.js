import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Modal, Card } from 'antd';
import VideoHistorySelector from './VideoHistorySelector';

const VideoSelector = ({ selectedVideo, onVideoSelect }) => {
  const { t } = useTranslation();
  const [isModalVisible, setIsModalVisible] = useState(false);

  const handleVideoSelect = (video) => {
    onVideoSelect(video);
    setIsModalVisible(false);
  };

  return (
    <>
      {selectedVideo ? (
        <Card
          size="small"
          cover={<img alt={selectedVideo.prompt} src={selectedVideo.signed_url || (selectedVideo.signed_urls && selectedVideo.signed_urls[0])} style={{ maxHeight: 150, objectFit: 'contain' }} />}
          actions={[
            <Button type="link" onClick={() => setIsModalVisible(true)}>
              {t('common.change')}
            </Button>,
          ]}
        >
          <Card.Meta title={selectedVideo.prompt} />
        </Card>
      ) : (
        <Button onClick={() => setIsModalVisible(true)} block>
          {t('dashboard.selectVideoToExtend')}
        </Button>
      )}
      <Modal
        title={t('dashboard.selectVideoToExtend')}
        open={isModalVisible}
        onCancel={() => setIsModalVisible(false)}
        footer={null}
        width="66%"
      >
        <VideoHistorySelector onVideoSelect={handleVideoSelect} />
      </Modal>
    </>
  );
};

export default VideoSelector;
