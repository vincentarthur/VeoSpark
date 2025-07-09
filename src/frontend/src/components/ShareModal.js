import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import {
  Modal, Box, Typography, Button, CircularProgress, Alert, Select, MenuItem, FormControl, InputLabel
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

const ShareModal = ({ open, onClose, onSubmit, video }) => {
  const { t } = useTranslation();
  const [groups, setGroups] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      const fetchGroups = async () => {
        try {
          const response = await axios.get('/api/groups');
          setGroups(response.data);
          if (response.data.length > 0) {
            setSelectedGroup(response.data[0].id);
          }
        } catch (err) {
          setError(err.response?.data?.detail || 'Could not fetch groups.');
        }
      };
      fetchGroups();
    }
  }, [open]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    try {
      await onSubmit({ group_id: selectedGroup, video_gcs_uri: video.gcs_uri });
      onClose();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to share video.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose}>
      <Box sx={style} component="form" onSubmit={handleSubmit}>
        <Typography variant="h6" component="h2">
          {t('shareModal.title')}
        </Typography>
        
        <FormControl fullWidth>
          <InputLabel>{t('shareModal.selectGroup')}</InputLabel>
          <Select value={selectedGroup} label={t('shareModal.selectGroup')} onChange={(e) => setSelectedGroup(e.target.value)}>
            {groups.map((group) => (
              <MenuItem key={group.id} value={group.id}>{group.name}</MenuItem>
            ))}
          </Select>
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

export default ShareModal;
