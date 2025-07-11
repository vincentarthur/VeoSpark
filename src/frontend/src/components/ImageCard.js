import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Card, CardContent, CardMedia, Typography, IconButton, Tooltip, Box, Chip, Collapse, Modal
} from '@mui/material';
import { ExpandMore, Share, Delete, AddToQueue as UseAsFirstFrameIcon } from '@mui/icons-material';

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

const ImageCard = ({ image, models, user, onShareClick, onShareDelete, onUseAsFirstFrame }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const isActionable = image.status === 'SUCCESS' && (image.output_image_gcs_path || image.gcs_uri);
  const canDelete = onShareDelete && user && image.shared_by_user_email === user.email;
  const modelName = models?.find(m => m.id === image.model_used)?.name || image.model_used;

  return (
    <>
      <Card sx={{ display: 'flex', flexDirection: 'column', height: '100%', borderRadius: '12px' }}>
        <Box sx={{ position: 'relative', paddingTop: '56.25%' /* 16:9 Aspect Ratio */ }} onClick={() => setOpen(true)}>
          {image.signed_url ? (
            <CardMedia
              component="img"
              src={image.signed_url}
              sx={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', cursor: 'pointer' }}
            />
          ) : (
          <Box sx={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)' }}>
            <Typography variant="body2" color="white">{t('history.noPreview')}</Typography>
          </Box>
          )}
        </Box>
        <CardContent sx={{ flexGrow: 1 }}>
        <Tooltip title={image.prompt || 'No prompt available'}>
          <Typography gutterBottom variant="h6" component="div" noWrap>
              {image.prompt || 'No prompt available'}
          </Typography>
        </Tooltip>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            {image.status && <Chip 
                label={image.status} 
                color={image.status === 'SUCCESS' ? 'success' : 'error'} 
                size="small" 
            />}
            <Typography variant="caption" color="text.secondary">
                {new Date(image.trigger_time || image.shared_at).toLocaleString()}
            </Typography>
        </Box>
        {image.shared_by_user_email && (
            <Typography variant="caption" display="block" color="text.secondary">
                {t('videoCard.sharedBy')}: {image.shared_by_user_email}
            </Typography>
        )}
        {image.user_email && image.user_email !== image.shared_by_user_email && (
             <Typography variant="caption" display="block" color="text.secondary">
                {t('videoCard.generatedBy')}: {image.user_email}
            </Typography>
        )}
        <ExpandableCard title={t('history.details')}>
            <Typography variant="body2" component="p" sx={{ wordBreak: 'break-word' }}>
                <strong>{t('history.fullPrompt')}:</strong> {image.prompt}
            </Typography>
            <Typography variant="body2" component="p">
                <strong>{t('history.model')}:</strong> {modelName}
            </Typography>
            <Typography variant="body2" component="p">
                <strong>{t('history.genDuration')}:</strong> {Math.round(image.operation_duration || 0)}s
            </Typography>
            <Typography variant="body2" component="p">
                <strong>{t('history.completionTime')}:</strong> {new Date(image.completion_time).toLocaleString()}
            </Typography>
        </ExpandableCard>
      </CardContent>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', p: 1 }}>
        {onUseAsFirstFrame && (
            <Tooltip title={t('imageCard.useAsFirstFrame', 'Use as First Frame')}>
                <span>
                <IconButton color="secondary" onClick={() => onUseAsFirstFrame({ gcsUri: image.gcs_uri, signedUrl: image.signed_url })} disabled={!isActionable}>
                    <UseAsFirstFrameIcon />
                </IconButton>
                </span>
            </Tooltip>
        )}
        {onShareClick && (
          <Tooltip title={t('history.actions.share')}>
            <span>
              <IconButton color="primary" onClick={() => onShareClick(image)} disabled={!isActionable}>
                <Share />
              </IconButton>
            </span>
          </Tooltip>
        )}
        {canDelete && (
          <Tooltip title={t('videoCard.deleteShare')}>
            <IconButton color="error" onClick={() => onShareDelete(image)}>
              <Delete />
            </IconButton>
          </Tooltip>
        )}
      </Box>
    </Card>
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      aria-labelledby="image-modal-title"
      aria-describedby="image-modal-description"
    >
      <Box sx={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        bgcolor: 'background.paper',
        boxShadow: 24,
        p: 4,
      }}>
        <img src={image.signed_url} alt={image.prompt} style={{ maxWidth: '90vw', maxHeight: '90vh' }} />
      </Box>
    </Modal>
    </>
  );
};

export default ImageCard;
