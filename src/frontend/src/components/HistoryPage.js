import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import {
  Box, Typography, Paper, CircularProgress, Alert, Button,
  TextField, Select, MenuItem, FormControl, InputLabel, Checkbox, FormControlLabel, Grid,
  TablePagination, Tabs, Tab
} from '@mui/material';
import { 
  Refresh, FilterList, Clear
} from '@mui/icons-material';
import EditingModal from './EditingModal';
import { useEditingModal } from '../hooks/useEditingModal'; // Import the new hook
import VideoCard from './VideoCard'; // Import the new VideoCard component
import UpscaleModal from './UpscaleModal';
import { useUpscaleModal } from '../hooks/useUpscaleModal';
import UpscaleJobsTab from './UpscaleJobsTab';
import ShareModal from './ShareModal';
import { useShareModal } from '../hooks/useShareModal';
import ImageHistory from './ImageHistory';


const HistoryPage = ({ user, onUseAsFirstFrame }) => {
  const { t } = useTranslation();
  const [history, setHistory] = useState([]);
  const [tab, setTab] = useState(0);
  const [config, setConfig] = useState({ enable_upscale: false });
  const [totalRows, setTotalRows] = useState(0);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [models, setModels] = useState([]);

  // Caching state
  const [videoHistoryCache, setVideoHistoryCache] = useState({ data: [], total: 0 });
  const [imageHistoryCache, setImageHistoryCache] = useState({ data: [], total: 0 });
  const [videoHasFetched, setVideoHasFetched] = useState(false);
  const [imageHasFetched, setImageHasFetched] = useState(false);

  // State for filters
  const [filters, setFilters] = useState({
    start_date: '',
    end_date: '',
    status: '',
    model: '',
    is_edited: false,
    only_success: false,
  });

  const handleFilterChange = (event) => {
    const { name, value, type, checked } = event.target;
    setFilters(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const handleTabChange = (event, newValue) => {
    setTab(newValue);
    if (newValue === 0) {
      setHistory(videoHistoryCache.data);
      setTotalRows(videoHistoryCache.total);
    } else if (newValue === 1) {
      setHistory(imageHistoryCache.data);
      setTotalRows(imageHistoryCache.total);
    }
    setPage(0);
  };

  const clearFilters = () => {
    setFilters({
      start_date: '',
      end_date: '',
      status: '',
      model: '',
      is_edited: false,
      only_success: false,
    });
    fetchHistory(true); // Pass true to indicate clearing
  };

  const { 
    modalOpen, 
    selectedVideo, 
    modalMode, 
    openModal, 
    closeModal, 
    handleSubmit 
  } = useEditingModal(() => {
    // onActionComplete: just refetch the history
    fetchHistory();
  });

  const {
    modalOpen: upscaleModalOpen,
    selectedVideo: upscaleSelectedVideo,
    openModal: openUpscaleModal,
    closeModal: closeUpscaleModal,
    handleSubmit: handleUpscaleSubmit,
  } = useUpscaleModal((originalVideo, data) => {
    // For now, just log the job ID and refetch history
    console.log("Upscale job started:", data.job_id);
    fetchHistory();
  });

  const {
    modalOpen: shareModalOpen,
    selectedItem: shareSelectedItem,
    openModal: openShareModal,
    closeModal: closeShareModal,
    handleSubmit: handleShareSubmit,
  } = useShareModal(() => {
    // For now, just log and close
    console.log("Item shared successfully");
  });

  const fetchHistory = async (isCleared = false, newPage = 0, newRowsPerPage = 10) => {
    setLoading(true);
    setError(null);

    const activeFilters = isCleared ? {} : Object.entries(filters).reduce((acc, [key, value]) => {
      if (value) { // Only include non-empty/non-false values
        acc[key] = value;
      }
      return acc;
    }, {});

    if (filters.only_success) {
      activeFilters.status = 'SUCCESS';
    }

    const endpoint = tab === 0 ? '/api/videos/history' : '/api/images/history';

    try {
      const response = await axios.get(endpoint, { 
        params: { 
          ...activeFilters,
          page: newPage + 1,
          page_size: newRowsPerPage
        } 
      });
      const newHistory = response.data.rows;
      const newTotal = response.data.total;

      if (tab === 0) {
        setVideoHistoryCache({ data: newHistory, total: newTotal });
        if (!videoHasFetched) setVideoHasFetched(true);
      } else {
        setImageHistoryCache({ data: newHistory, total: newTotal });
        if (!imageHasFetched) setImageHasFetched(true);
      }

      setHistory(newHistory);
      setTotalRows(newTotal);
      setPage(newPage);
      setRowsPerPage(newRowsPerPage);
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not fetch history.');
      setHistory([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await axios.get('/api/config');
        setConfig(response.data);
      } catch (error) {
        console.error("Failed to fetch config", error);
      }
    };
    const fetchModels = async () => {
      try {
        const response = await axios.get(tab === 0 ? '/api/models' : '/api/image-models');
        setModels(response.data.models || []);
      } catch (error) {
        console.error("Failed to fetch models:", error);
      }
    };
    fetchConfig();
    fetchModels();
  }, [tab]);

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap' }}>
        <Typography variant="h4" gutterBottom mb={0}>
          {t('history.title')}
        </Typography>
        <Button
          variant="contained"
          startIcon={loading ? <CircularProgress size={20} color="inherit" /> : <Refresh />}
          onClick={() => fetchHistory()}
          disabled={loading}
        >
          {loading ? t('history.fetching') : t('history.fetchButton')}
        </Button>
      </Box>

      <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tabs value={tab} onChange={handleTabChange} aria-label="history tabs">
          <Tab label={t('history.tabs.videoHistory')} />
          <Tab label={t('history.tabs.imageHistory')} />
          {config.enable_upscale && <Tab label={t('history.tabs.upscaleJobs')} />}
        </Tabs>
      </Box>

      {tab === 0 && (
        <Box>
          <Paper sx={{ p: 2, mb: 3, borderRadius: '12px' }}>
            <Grid container spacing={2} alignItems="center">
              <Grid item xs={12} sm={6} md={3}>
                <TextField
                  name="start_date"
                  label={t('history.filters.startDate')}
                  type="date"
                  fullWidth
                  value={filters.start_date}
                  onChange={handleFilterChange}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <TextField
                  name="end_date"
                  label={t('history.filters.endDate')}
                  type="date"
                  fullWidth
                  value={filters.end_date}
                  onChange={handleFilterChange}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
              <Grid item xs={12} sm={6} md={2}>
                <FormControl fullWidth>
                  <InputLabel>{t('history.filters.status')}</InputLabel>
                  <Select name="status" value={filters.status} label={t('history.filters.status')} onChange={handleFilterChange}>
                    <MenuItem value=""><em>{t('history.filters.all')}</em></MenuItem>
                    <MenuItem value="SUCCESS">Success</MenuItem>
                    <MenuItem value="FAILURE">Failure</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6} md={2}>
                <FormControl fullWidth>
                  <InputLabel>{t('history.filters.model')}</InputLabel>
                  <Select name="model" value={filters.model} label={t('history.filters.model')} onChange={handleFilterChange}>
                    <MenuItem value=""><em>{t('history.filters.all')}</em></MenuItem>
                    {models.map((m) => (
                      <MenuItem key={m.id} value={m.id}>{m.name}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6} md={2}>
                 <FormControlLabel
                    control={<Checkbox name="is_edited" checked={filters.is_edited} onChange={handleFilterChange} />}
                    label={t('history.filters.editedOnly')}
                  />
              </Grid>
              <Grid item xs={12} sm={6} md={2}>
                <FormControlLabel
                  control={<Checkbox name="only_success" checked={filters.only_success} onChange={handleFilterChange} />}
                  label={t('history.filters.onlySuccess')}
                />
              </Grid>
              <Grid item xs={12} md={2} sx={{ display: 'flex', gap: 1 }}>
                <Button variant="outlined" onClick={() => fetchHistory()} startIcon={<FilterList />}>{t('history.filters.apply')}</Button>
                <Button onClick={clearFilters}><Clear size="small" /></Button>
              </Grid>
            </Grid>
          </Paper>

          {loading ? (
            <CircularProgress />
          ) : error ? (
            <Alert severity="error">{error}</Alert>
          ) : videoHasFetched && history.length === 0 ? (
            <Typography>{t('history.noResults')}</Typography>
          ) : !videoHasFetched ? (
            <Typography>{t('history.pressFetch')}</Typography>
          ) : (
            <Box>
              <Grid container spacing={3}>
                {history.map((video) => (
                  <Grid item xs={12} sm={6} md={4} key={video.trigger_time}>
                    <VideoCard
                      video={video}
                      models={models}
                      onEditClick={openModal}
                      onUpscaleClick={config.enable_upscale ? openUpscaleModal : null}
                      onShareClick={openShareModal}
                    />
                  </Grid>
                ))}
              </Grid>
              <TablePagination
                rowsPerPageOptions={[5, 10, 25, 50]}
                component="div"
                count={totalRows}
                rowsPerPage={rowsPerPage}
                page={page}
                onPageChange={(e, newPage) => fetchHistory(false, newPage, rowsPerPage)}
                onRowsPerPageChange={(e) => fetchHistory(false, 0, parseInt(e.target.value, 10))}
                sx={{ mt: 2, display: 'flex', justifyContent: 'center' }}
              />
            </Box>
          )}
        </Box>
      )}

      {tab === 1 && (
        <ImageHistory 
          user={user} 
          history={history}
          models={models}
          loading={loading}
          error={error}
          hasFetched={imageHasFetched}
          totalRows={totalRows}
          page={page}
          rowsPerPage={rowsPerPage}
          fetchHistory={fetchHistory}
          setFilters={setFilters}
          clearFilters={clearFilters}
          filters={filters}
          onUseAsFirstFrame={onUseAsFirstFrame}
        />
      )}

      {tab === 2 && config.enable_upscale && <UpscaleJobsTab />}

      {selectedVideo && (
        <EditingModal
          open={modalOpen}
          onClose={closeModal}
          onSubmit={handleSubmit}
          video={selectedVideo}
          mode={modalMode}
        />
      )}

      {upscaleSelectedVideo && (
        <UpscaleModal
          open={upscaleModalOpen}
          onClose={closeUpscaleModal}
          onSubmit={handleUpscaleSubmit}
          video={upscaleSelectedVideo}
        />
      )}

      {shareSelectedItem && (
        <ShareModal
          open={shareModalOpen}
          onClose={closeShareModal}
          onSubmit={handleShareSubmit}
          item={shareSelectedItem}
        />
      )}
    </Box>
  );
};
export default HistoryPage;
