import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Box, Typography, TextField, Button, CircularProgress, Alert } from '@mui/material';
import VisualTrimmer from './VisualTrimmer'; // Import the new component

// Reusable style for the modal
const style = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: 450,
  bgcolor: 'background.paper',
  border: '2px solid #000',
  boxShadow: 24,
  p: 4,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};

const EditingModal = ({ open, onClose, onSubmit, video, mode }) => {
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({});

  // Reset form when the modal opens for a new video or mode
  useEffect(() => {
    if (open) {
      setError('');
      setIsLoading(false);
      // For dub mode, initialize form data. For clip mode, VisualTrimmer handles it.
      if (mode === 'dub') {
        setFormData({ text: '' });
      } else {
        setFormData({});
      }
    }
  }, [open, mode, video]);

  const handleTrimChange = useCallback((startTime, endTime) => {
    setFormData({ start_time: startTime, end_time: endTime });
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    try {
      await onSubmit(formData);
      onClose(); // Close modal on success
    } catch (err) {
      setError(err.response?.data?.detail || `Failed to ${mode} video.`);
    } finally {
      setIsLoading(false);
    }
  };

  const getTitle = () => {
    if (mode === 'clip') return t('editModal.clipTitle');
    if (mode === 'dub') return t('editModal.dubTitle');
    return '';
  };

  return (
    <Modal open={open} onClose={onClose}>
      <Box sx={style} component="form" onSubmit={handleSubmit}>
        <Typography variant="h6" component="h2">
          {getTitle()}
        </Typography>
        
        {mode === 'clip' && video?.signed_url && (
          <VisualTrimmer 
            videoUrl={video.signed_url}
            onTrimChange={handleTrimChange}
          />
        )}

        {mode === 'dub' && (
          <TextField
            name="text"
            label={t('editModal.dubText')}
            variant="outlined"
            fullWidth
            required
            multiline
            rows={4}
            value={formData.text || ''}
            onChange={handleChange}
          />
        )}

        {error && <Alert severity="error">{error}</Alert>}

        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 2 }}>
          <Button onClick={onClose} disabled={isLoading}>{t('common.cancel')}</Button>
          <Button type="submit" variant="contained" disabled={isLoading}>
            {isLoading ? <CircularProgress size={24} /> : t('common.submit')}
          </Button>
        </Box>
      </Box>
    </Modal>
  );
};

export default EditingModal;
