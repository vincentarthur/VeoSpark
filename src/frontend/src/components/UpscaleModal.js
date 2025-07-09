import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Modal, Box, Typography, Button, CircularProgress, Alert, RadioGroup, FormControlLabel, Radio, FormControl
} from '@mui/material';

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

const UpscaleModal = ({ open, onClose, onSubmit, video }) => {
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [resolution, setResolution] = useState('1080p');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    try {
      await onSubmit({ resolution });
      onClose();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to upscale video.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose}>
      <Box sx={style} component="form" onSubmit={handleSubmit}>
        <Typography variant="h6" component="h2">
          {t('upscaleModal.title')}
        </Typography>
        
        <FormControl component="fieldset">
          <RadioGroup
            aria-label="resolution"
            name="resolution"
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
          >
            <FormControlLabel value="1080p" control={<Radio />} label="1080p" />
            <FormControlLabel value="4k" control={<Radio />} label="4K" />
          </RadioGroup>
        </FormControl>

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

export default UpscaleModal;
