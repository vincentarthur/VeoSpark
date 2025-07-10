import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Card, CardContent, CardMedia, Typography, IconButton, Tooltip, Box, Chip, Collapse
} from '@mui/material';
import { ContentCut, Mic, ExpandMore, ArrowUpward, Share, Delete } from '@mui/icons-material';

const ExpandableCard = ({ children, title }) => {
    const [expanded, setExpanded] = useState(false);
  
    return (
      <Box>
        <Tooltip title={expanded ? "Show less" : "Show more"}>
            <IconButton
                onClick={() => setExpanded(!expanded)}
                aria-expanded={expanded}
                aria-label="show more"
                sx={{
                    transform: !expanded ? 'rotate(0deg)' : 'rotate(180deg)',
                    transition: (theme) => theme.transitions.create('transform', {
                        duration: theme.transitions.duration.shortest,
                    }),
                }}
            >
                <ExpandMore />
            </IconButton>
        </Tooltip>
        <Collapse in={expanded} timeout="auto" unmountOnExit>
          <CardContent>
            <Typography variant="body2" color="text.secondary">
                {children}
            </Typography>
          </CardContent>
        </Collapse>
      </Box>
    );
  };

const VideoCard = ({ video, models, user, onEditClick, onUpscaleClick, onShareClick, onShareDelete }) => {
  const { t } = useTranslation();
  const isActionable = video.status === 'SUCCESS' && (video.output_video_gcs_paths || video.video_gcs_uri);
  const canDelete = onShareDelete && user && video.shared_by_user_email === user.email;
  
  const getModelName = (modelId) => {
    if (modelId === 'EDITING_TOOL_CLIP') return t('history.editingTools.clip', 'Clipping Tool');
    if (modelId === 'EDITING_TOOL_DUB') return t('history.editingTools.dub', 'Dubbing Tool');
    const model = models?.find(m => m.id === modelId);
    return model ? model.name : modelId;
  }

  const modelName = getModelName(video.model_used);

  return (
    <Card sx={{ display: 'flex', flexDirection: 'column', height: '100%', borderRadius: '12px' }}>
      <Box sx={{ position: 'relative', paddingTop: '56.25%' /* 16:9 Aspect Ratio */ }}>
        {video.signed_urls && video.signed_urls[0] ? (
          <CardMedia
            component="video"
            src={video.signed_urls[0]}
            controls
            sx={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
          />
        ) : (
          <Box sx={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)' }}>
            <Typography variant="body2" color="white">{t('history.noPreview')}</Typography>
          </Box>
        )}
      </Box>
      <CardContent sx={{ flexGrow: 1 }}>
        <Typography gutterBottom variant="h6" component="div" noWrap>
            {video.prompt || 'No prompt available'}
        </Typography>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            {video.status && <Chip 
                label={video.status} 
                color={video.status === 'SUCCESS' ? 'success' : 'error'} 
                size="small" 
            />}
            <Typography variant="caption" color="text.secondary">
                {new Date(video.trigger_time || video.shared_at).toLocaleString()}
            </Typography>
        </Box>
        {video.shared_by_user_email && (
            <Typography variant="caption" display="block" color="text.secondary">
                {t('videoCard.sharedBy')}: {video.shared_by_user_email}
            </Typography>
        )}
        {video.user_email && video.user_email !== video.shared_by_user_email && (
             <Typography variant="caption" display="block" color="text.secondary">
                {t('videoCard.generatedBy')}: {video.user_email}
            </Typography>
        )}
        <ExpandableCard title={t('history.details')}>
            <Typography variant="body2" component="p" sx={{ wordBreak: 'break-word' }}>
                <strong>{t('history.fullPrompt')}:</strong> {video.prompt}
            </Typography>
            <Typography variant="body2" component="p">
                <strong>{t('history.model')}:</strong> {modelName}
            </Typography>
            <Typography variant="body2" component="p">
                <strong>{t('history.genDuration')}:</strong> {Math.round(video.operation_duration || 0)}s
            </Typography>
            <Typography variant="body2" component="p">
                <strong>{t('history.completionTime')}:</strong> {new Date(video.completion_time).toLocaleString()}
            </Typography>
        </ExpandableCard>
      </CardContent>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', p: 1 }}>
        {onEditClick && (
          <>
            <Tooltip title={t('history.actions.clip')}>
              <span>
                <IconButton color="secondary" onClick={() => onEditClick(video, 'clip')} disabled={!isActionable}>
                  <ContentCut />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={t('history.actions.dub')}>
              <span>
                <IconButton color="secondary" onClick={() => onEditClick(video, 'dub')} disabled={!isActionable}>
                  <Mic />
                </IconButton>
              </span>
            </Tooltip>
          </>
        )}
        {onUpscaleClick && (
          <Tooltip title={t('history.actions.upscale')}>
            <span>
              <IconButton color="primary" onClick={() => onUpscaleClick(video)} disabled={!isActionable}>
                <ArrowUpward />
              </IconButton>
            </span>
          </Tooltip>
        )}
        {onShareClick && (
          <Tooltip title={t('history.actions.share')}>
            <span>
              <IconButton color="primary" onClick={() => onShareClick(video)} disabled={!isActionable}>
                <Share />
              </IconButton>
            </span>
          </Tooltip>
        )}
        {canDelete && (
          <Tooltip title={t('videoCard.deleteShare')}>
            <IconButton color="error" onClick={() => onShareDelete(video)}>
              <Delete />
            </IconButton>
          </Tooltip>
        )}
      </Box>
    </Card>
  );
};

export default VideoCard;
