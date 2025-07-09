import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import {
  Box, Typography, CircularProgress, Alert, Grid, Select, MenuItem, FormControl, InputLabel, Button, IconButton
} from '@mui/material';
import { Refresh } from '@mui/icons-material';
import VideoCard from '../components/VideoCard';
import ConfirmationDialog from '../components/ConfirmationDialog';

const SharedVideosPage = ({ user }) => {
  const { t } = useTranslation();
  const [groups, setGroups] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState('');
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [videoToDelete, setVideoToDelete] = useState(null);

  useEffect(() => {
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
  }, []);

  useEffect(() => {
    if (!selectedGroup) return;

    const fetchVideos = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await axios.get(`/api/groups/${selectedGroup}/videos`);
        setVideos(response.data);
      } catch (err) {
        setError(err.response?.data?.detail || 'Could not fetch shared videos.');
      } finally {
        setLoading(false);
      }
    };
    fetchVideos();
  }, [selectedGroup]);

  const handleDeleteClick = (video) => {
    setVideoToDelete(video);
  };

  const handleConfirmDelete = async () => {
    if (!videoToDelete) return;
    try {
      await axios.delete(`/api/shared-videos/${videoToDelete.id}`);
      setVideos(videos.filter((v) => v.id !== videoToDelete.id));
      setVideoToDelete(null);
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not delete video.');
    }
  };

  const fetchVideos = async () => {
    if (!selectedGroup) return;
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get(`/api/groups/${selectedGroup}/videos`);
      setVideos(response.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not fetch shared videos.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedGroup) {
        fetchVideos();
    }
  }, [selectedGroup]);

  return (
    <Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h4" gutterBottom>{t('sharedVideos.title')}</Typography>
            <Button
                variant="contained"
                startIcon={loading ? <CircularProgress size={20} color="inherit" /> : <Refresh />}
                onClick={fetchVideos}
                disabled={loading || !selectedGroup}
            >
                {loading ? t('sharedVideos.refreshing') : t('sharedVideos.refresh')}
            </Button>
        </Box>
      
      <FormControl fullWidth sx={{ mb: 3 }}>
        <InputLabel>{t('sharedVideos.selectGroup')}</InputLabel>
        <Select value={selectedGroup} label={t('sharedVideos.selectGroup')} onChange={(e) => setSelectedGroup(e.target.value)}>
          {groups.map((group) => (
            <MenuItem key={group.id} value={group.id}>{group.name}</MenuItem>
          ))}
        </Select>
      </FormControl>

      {loading && <CircularProgress />}
      {error && <Alert severity="error">{error}</Alert>}
      
      {!loading && !error && videos.length === 0 && (
        <Typography>{t('sharedVideos.noVideos')}</Typography>
      )}

      {!loading && !error && videos.length > 0 && (
        <Grid container spacing={3}>
          {videos.map((video) => (
            <Grid item xs={12} sm={6} md={4} key={video.id}>
              <VideoCard video={video} user={user} onShareDelete={handleDeleteClick} />
            </Grid>
          ))}
        </Grid>
      )}
      {videoToDelete && (
        <ConfirmationDialog
          open={!!videoToDelete}
          onClose={() => setVideoToDelete(null)}
          onConfirm={handleConfirmDelete}
          title={t('sharedVideos.confirmDeleteTitle')}
          description={t('sharedVideos.confirmDeleteDescription')}
        />
      )}
    </Box>
  );
};

export default SharedVideosPage;
