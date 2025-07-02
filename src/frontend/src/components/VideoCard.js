import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Card, CardContent, CardMedia, Typography, IconButton, Tooltip, Box, Chip, Collapse
} from '@mui/material';
import { PlayCircleOutline, ContentCut, Mic, ExpandMore } from '@mui/icons-material';

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

const VideoCard = ({ video, onEditClick }) => {
  const { t } = useTranslation();
  const isActionable = video.status === 'SUCCESS' && video.output_video_gcs_paths;

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
        <Tooltip title={video.prompt}>
            <Typography gutterBottom variant="h6" component="div" noWrap>
                {video.prompt}
            </Typography>
        </Tooltip>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            <Chip 
                label={video.status} 
                color={video.status === 'SUCCESS' ? 'success' : 'error'} 
                size="small" 
            />
            <Typography variant="caption" color="text.secondary">
                {new Date(video.trigger_time).toLocaleString()}
            </Typography>
        </Box>
        <ExpandableCard title={t('history.details')}>
            <Typography variant="body2" component="p" sx={{ wordBreak: 'break-word' }}>
                <strong>{t('history.fullPrompt')}:</strong> {video.prompt}
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
      </Box>
    </Card>
  );
};

export default VideoCard;
