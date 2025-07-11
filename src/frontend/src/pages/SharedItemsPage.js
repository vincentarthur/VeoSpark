import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import {
  Box, Typography, CircularProgress, Alert, Grid, Select, MenuItem, FormControl, InputLabel, Button, IconButton
} from '@mui/material';
import { Refresh } from '@mui/icons-material';
import VideoCard from '../components/VideoCard';
import ImageCard from '../components/ImageCard';
import ConfirmationDialog from '../components/ConfirmationDialog';

const SharedItemsPage = ({ user, onUseAsFirstFrame }) => {
  const { t } = useTranslation();
  const [groups, setGroups] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [itemToDelete, setItemToDelete] = useState(null);

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

    const fetchItems = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await axios.get(`/api/groups/${selectedGroup}/items`);
        setItems(response.data);
      } catch (err) {
        setError(err.response?.data?.detail || 'Could not fetch shared items.');
      } finally {
        setLoading(false);
      }
    };
    fetchItems();
  }, [selectedGroup]);

  const handleDeleteClick = (item) => {
    setItemToDelete(item);
  };

  const handleConfirmDelete = async () => {
    if (!itemToDelete) return;
    try {
      await axios.delete(`/api/shared-items/${itemToDelete.id}`);
      setItems(items.filter((v) => v.id !== itemToDelete.id));
      setItemToDelete(null);
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not delete item.');
    }
  };

  const fetchItems = async () => {
    if (!selectedGroup) return;
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get(`/api/groups/${selectedGroup}/items`);
      setItems(response.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not fetch shared items.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedGroup) {
        fetchItems();
    }
  }, [selectedGroup]);

  return (
    <Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h4" gutterBottom>{t('sharedItems.title')}</Typography>
            <Button
                variant="contained"
                startIcon={loading ? <CircularProgress size={20} color="inherit" /> : <Refresh />}
                onClick={fetchItems}
                disabled={loading || !selectedGroup}
            >
                {loading ? t('sharedItems.refreshing') : t('sharedItems.refresh')}
            </Button>
        </Box>
      
      <FormControl fullWidth sx={{ mb: 3 }}>
        <InputLabel>{t('sharedItems.selectGroup')}</InputLabel>
        <Select value={selectedGroup} label={t('sharedItems.selectGroup')} onChange={(e) => setSelectedGroup(e.target.value)}>
          {groups.map((group) => (
            <MenuItem key={group.id} value={group.id}>{group.name}</MenuItem>
          ))}
        </Select>
      </FormControl>

      {loading && <CircularProgress />}
      {error && <Alert severity="error">{error}</Alert>}
      
      {!loading && !error && items.length === 0 && (
        <Typography>{t('sharedItems.noItems')}</Typography>
      )}

      {!loading && !error && items.length > 0 && (
        <Grid container spacing={3}>
          {items.map((item) => (
            <Grid item xs={12} sm={6} md={4} key={item.id}>
              {item.type === 'image' ? (
                <ImageCard image={item} user={user} onShareDelete={handleDeleteClick} onUseAsFirstFrame={onUseAsFirstFrame} />
              ) : (
                <VideoCard video={{...item, signed_urls: [item.signed_url]}} user={user} onShareDelete={handleDeleteClick} />
              )}
            </Grid>
          ))}
        </Grid>
      )}
      {itemToDelete && (
        <ConfirmationDialog
          open={!!itemToDelete}
          onClose={() => setItemToDelete(null)}
          onConfirm={handleConfirmDelete}
          title={t('sharedItems.confirmDeleteTitle')}
          description={t('sharedItems.confirmDeleteDescription')}
        />
      )}
    </Box>
  );
};

export default SharedItemsPage;
