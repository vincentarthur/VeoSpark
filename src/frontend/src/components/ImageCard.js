import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Typography, Button, Tooltip, Tag, Modal, Collapse } from 'antd';
import { ShareAltOutlined, DeleteOutlined, PictureOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;
const { Panel } = Collapse;

const ImageCard = ({ image, models, user, onShareClick, onShareDelete, onUseAsFirstFrame }) => {
  const { t } = useTranslation();
  const [isModalVisible, setIsModalVisible] = useState(false);

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return isNaN(date) ? t('history.invalidDate') : date.toLocaleString();
  };

  const isActionable = image.status === 'SUCCESS' && (image.output_image_gcs_path || image.gcs_uri);
  const canDelete = onShareDelete && user && image.shared_by_user_email === user.email;
  const modelName = models?.find(m => m.id === image.model_used)?.name || image.model_used;

  const actions = [];
  if (onUseAsFirstFrame) {
    actions.push(
      <Tooltip title={t('imageCard.useAsFirstFrame', 'Use as First Frame')}>
        <Button
          icon={<PictureOutlined />}
          onClick={() => onUseAsFirstFrame({ gcsUri: image.gcs_uri, signedUrl: image.signed_url })}
          disabled={!isActionable}
        />
      </Tooltip>
    );
  }
  if (onShareClick) {
    actions.push(
      <Tooltip title={t('history.actions.share')}>
        <Button icon={<ShareAltOutlined />} onClick={() => onShareClick(image)} disabled={!isActionable} />
      </Tooltip>
    );
  }
  if (canDelete) {
    actions.push(
      <Tooltip title={t('videoCard.deleteShare')}>
        <Button icon={<DeleteOutlined />} onClick={() => onShareDelete(image)} danger />
      </Tooltip>
    );
  }

  return (
    <>
      <Card
        hoverable
        style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
        cover={
          image.signed_url ? (
            <img
              alt={image.prompt}
              src={image.signed_url}
              style={{ height: 300, objectFit: 'contain', cursor: 'pointer' }}
              onClick={() => setIsModalVisible(true)}
            />
          ) : (
            <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0f2f5' }}>
              <Text type="secondary">{t('history.noPreview')}</Text>
            </div>
          )
        }
        actions={actions}
      >
        <Card.Meta
          title={<Title level={5} ellipsis>{image.prompt || 'No prompt available'}</Title>}
          description={
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <Tag color={image.status === 'SUCCESS' ? 'success' : 'error'}>{image.status}</Tag>
                <Text type="secondary">{formatDate(image.trigger_time || image.shared_at)}</Text>
              </div>
              {image.shared_by_user_email && (
                <Text type="secondary" style={{ display: 'block' }}>
                  {t('videoCard.sharedBy')}: {image.shared_by_user_email}
                </Text>
              )}
              {image.user_email && image.user_email !== image.shared_by_user_email && (
                <Text type="secondary" style={{ display: 'block' }}>
                  {t('videoCard.generatedBy')}: {image.user_email}
                </Text>
              )}
            </>
          }
        />
        <Collapse ghost>
          <Panel header={t('history.details')} key="1">
            <Text strong>{t('history.fullPrompt')}:</Text> <Text>{image.prompt}</Text><br />
            <Text strong>{t('history.model')}:</Text> <Text>{modelName}</Text><br />
            <Text strong>{t('history.genDuration')}:</Text> <Text>{Math.round(image.operation_duration || 0)}s</Text><br />
            <Text strong>{t('history.completionTime')}:</Text> <Text>{formatDate(image.completion_time)}</Text><br />
          </Panel>
        </Collapse>
      </Card>
      <Modal
        visible={isModalVisible}
        onCancel={() => setIsModalVisible(false)}
        footer={null}
        width="auto"
        centered
        bodyStyle={{ padding: 0, display: 'flex', justifyContent: 'center', alignItems: 'center' }}
      >
        <img src={image.signed_url} alt={image.prompt} style={{ maxWidth: '90vw', maxHeight: '90vh' }} />
      </Modal>
    </>
  );
};

export default ImageCard;
