import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import {
  Box, Typography, Paper, CircularProgress, Alert, Button,
  TextField, Select, MenuItem, FormControl, InputLabel, Checkbox, FormControlLabel, Grid,
  TablePagination
} from '@mui/material';
import { 
  Refresh, FilterList, Clear
} from '@mui/icons-material';
import ImageCard from './ImageCard';
import ShareModal from './ShareModal';
import { useShareModal } from '../hooks/useShareModal';

const ImageHistory = ({ user, history, models, loading, error, hasFetched, totalRows, page, rowsPerPage, fetchHistory, setFilters, clearFilters, filters, onUseAsFirstFrame }) => {
  const { t } = useTranslation();
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

  const handleFilterChange = (event) => {
    const { name, value } = event.target;
    setFilters(prev => ({
      ...prev,
      [name]: value,
    }));
  };

  return (
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
      ) : (
        <Box>
          <Grid container spacing={3}>
            {history.map((image) => (
              <Grid item xs={12} sm={6} md={4} key={image.trigger_time}>
                <ImageCard
                  image={image}
                  models={models}
                  user={user}
                  onShareClick={openShareModal}
                  onUseAsFirstFrame={onUseAsFirstFrame}
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

export default ImageHistory;
