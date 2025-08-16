import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Typography, Button, Tooltip, Tag, Collapse } from 'antd';
import { ScissorOutlined, AudioOutlined, ArrowUpOutlined, ShareAltOutlined, DeleteOutlined, VideoCameraOutlined, PlusOutlined } from '@ant-design/icons';
import AddToProjectModal from './AddToProjectModal';
import ShareToGroupModal from './ShareToGroupModal';

const { Title, Text } = Typography;
const { Panel } = Collapse;

const ResolutionIcon = ({ resolution }) => {
  if (!resolution) return null;

  if (resolution.includes('720')) return <Tag>720p</Tag>;
  if (resolution.includes('1080')) return <Tag>1080p</Tag>;
  if (resolution.toLowerCase().includes('4k')) return <Tag>4K</Tag>;

  return null;
};

const VideoCard = ({ video, models, user, onEditClick, onShareClick, onShareDelete, showAddToProject = true }) => {
  const { t } = useTranslation();
  const [isAddToProjectModalOpen, setIsAddToProjectModalOpen] = useState(false);
  const [isShareToGroupModalOpen, setIsShareToGroupModalOpen] = useState(false);
  const isActionable = video.status === 'SUCCESS' && (video.output_video_gcs_paths || video.video_gcs_uri);
  const canDelete = onShareDelete && user && video.shared_by_user_email === user.email;

  const getModelName = (modelId) => {
    if (modelId === 'EDITING_TOOL_CLIP') return t('history.editingTools.clip', 'Clipping Tool');
    if (modelId === 'EDITING_TOOL_DUB') return t('history.editingTools.dub', 'Dubbing Tool');
    const model = models?.find(m => m.id === modelId);
    return model ? model.name : modelId;
  }

  const modelName = getModelName(video.model_used);

  const actions = [];
  if (onEditClick) {
    actions.push(
      <Tooltip title={t('history.actions.clip')}>
        <Button icon={<ScissorOutlined />} onClick={() => onEditClick(video, 'clip')} disabled={!isActionable} />
      </Tooltip>
    );
    actions.push(
      <Tooltip title={t('history.actions.dub')}>
        <Button icon={<AudioOutlined />} onClick={() => onEditClick(video, 'dub')} disabled={!isActionable} />
      </Tooltip>
    );
  }
  if (onShareClick) {
    actions.push(
      <Tooltip title={t('history.actions.share')}>
        <Button icon={<ShareAltOutlined />} onClick={() => setIsShareToGroupModalOpen(true)} disabled={!isActionable} />
      </Tooltip>
    );
  }
  if (showAddToProject) {
    actions.push(
      <Tooltip title={t('creativeProjects.addToProject')}>
        <Button icon={<PlusOutlined />} onClick={() => setIsAddToProjectModalOpen(true)} disabled={!isActionable} />
      </Tooltip>
    );
  }
  if (canDelete) {
    actions.push(
      <Tooltip title={t('videoCard.deleteShare')}>
        <Button icon={<DeleteOutlined />} onClick={() => onShareDelete(video)} danger />
      </Tooltip>
    );
  }

  return (
    <>
      <Card
        hoverable
        style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
      cover={
        video.signed_url || (video.signed_urls && video.signed_urls[0]) ? (
          <video
            src={video.signed_url || video.signed_urls[0]}
            controls
            style={{ width: '100%', height: 300, objectFit: 'contain' }}
          />
        ) : (
          <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0f2f5' }}>
            <VideoCameraOutlined style={{ fontSize: 48, color: '#ccc' }} />
          </div>
        )
      }
      actions={actions}
    >
      <Card.Meta
        title={<Tooltip title={video.prompt}><Title level={5} ellipsis>{video.prompt || 'No prompt available'}</Title></Tooltip>}
        description={
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Tag color={video.status === 'SUCCESS' ? 'success' : 'error'}>{video.status}</Tag>
              <Text type="secondary">{new Date(video.trigger_time || video.shared_at).toLocaleString()}</Text>
            </div>
            {video.shared_by_user_email && (
              <Text type="secondary" style={{ display: 'block' }}>
                {t('videoCard.sharedBy')}: {video.shared_by_user_email}
              </Text>
            )}
            {video.user_email && video.user_email !== video.shared_by_user_email && (
              <Text type="secondary" style={{ display: 'block' }}>
                {t('videoCard.generatedBy')}: {video.user_email}
              </Text>
            )}
          </>
        }
      />
      <Collapse ghost>
        <Panel header={t('history.details')} key="1">
          <Text strong>{t('history.fullPrompt')}:</Text> <Text>{video.prompt}</Text><br />
          <Text strong>{t('history.model')}:</Text> <Text>{modelName}</Text><br />
          {video.project_name && <><Text strong>{t('nav.creativeProjects')}:</Text> <Text>{video.project_name}</Text><br /></>}
          <Text strong>{t('history.genDuration')}:</Text> <Text>{Math.round(video.operation_duration || 0)}s</Text><br />
          <Text strong>{t('history.completionTime')}:</Text> <Text>{new Date(video.completion_time).toLocaleString()}</Text><br />
          {video.resolution && (
            <>
              <Text strong>{t('history.resolution')}:</Text> <ResolutionIcon resolution={video.resolution} />
            </>
          )}
        </Panel>
      </Collapse>
    </Card>
    <AddToProjectModal
      open={isAddToProjectModalOpen}
      onClose={() => setIsAddToProjectModalOpen(false)}
      asset={video}
      onComplete={() => {}}
    />
    <ShareToGroupModal
      open={isShareToGroupModalOpen}
      onClose={() => setIsShareToGroupModalOpen(false)}
      asset={video}
      onComplete={() => {}}
    />
    </>
  );
};

export default VideoCard;
