import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import {
  Box, Typography, Paper, CircularProgress, Alert, Modal, Button, Tooltip,
  TextField, Select, MenuItem, FormControl, InputLabel, Checkbox, FormControlLabel, Grid,
  TablePagination
} from '@mui/material';
import { 
  Refresh, FilterList, Clear
} from '@mui/icons-material';
import EditingModal from './EditingModal';
import { useEditingModal } from '../hooks/useEditingModal'; // Import the new hook
import VideoCard from './VideoCard'; // Import the new VideoCard component


const HistoryPage = () => {
  const { t } = useTranslation();
  const [history, setHistory] = useState([]);
  const [totalRows, setTotalRows] = useState(0);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hasFetched, setHasFetched] = useState(false);

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

  const fetchHistory = async (isCleared = false, newPage = 0, newRowsPerPage = 10) => {
    setLoading(true);
    setError(null);
    setHasFetched(true);

    const activeFilters = isCleared ? {} : Object.entries(filters).reduce((acc, [key, value]) => {
      if (value) { // Only include non-empty/non-false values
        acc[key] = value;
      }
      return acc;
    }, {});

    if (filters.only_success) {
      activeFilters.status = 'SUCCESS';
    }

    try {
      const response = await axios.get('/api/videos/history', { 
        params: { 
          ...activeFilters,
          page: newPage + 1,
          page_size: newRowsPerPage
        } 
      });
      setHistory(response.data.rows);
      setTotalRows(response.data.total);
      setPage(newPage);
      setRowsPerPage(newRowsPerPage);
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not fetch history.');
      setHistory([]); // Clear cache on error
    } finally {
      setLoading(false);
    }
  };

  // The useEffect hook is now empty, so nothing happens on initial load.
  useEffect(() => {
    // Intentionally empty
  }, []);

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
                <MenuItem value="veo-2.0-generate-001">Veo 2.0</MenuItem>
                <MenuItem value="veo-3.0-generate-preview">Veo 3.0</MenuItem>
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
      ) : hasFetched && history.length === 0 ? (
        <Typography>{t('history.noResults')}</Typography>
      ) : !hasFetched ? (
        <Typography>{t('history.pressFetch')}</Typography>
      ) : (
        <Box>
          <Grid container spacing={3}>
            {history.map((video) => (
              <Grid item xs={12} sm={6} md={4} key={video.trigger_time}>
                <VideoCard video={video} onEditClick={openModal} />
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

      {selectedVideo && (
        <EditingModal
          open={modalOpen}
          onClose={closeModal}
          onSubmit={handleSubmit}
          video={selectedVideo}
          mode={modalMode}
        />
      )}
    </Box>
  );
};
export default HistoryPage;
