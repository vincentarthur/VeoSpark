import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import {
  Box, Typography, Paper, CircularProgress, Alert, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, IconButton, Collapse, Modal, Button, Tooltip,
  TextField, Select, MenuItem, FormControl, InputLabel, Checkbox, FormControlLabel, Grid,
  TablePagination
} from '@mui/material';
import { 
  KeyboardArrowDown, KeyboardArrowUp, PlayCircleOutline, Refresh, ContentCut, Mic, FilterList, Clear
} from '@mui/icons-material';
import EditingModal from './EditingModal';
import { useEditingModal } from '../hooks/useEditingModal'; // Import the new hook

// --- Modal for Video Preview ---
const style = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: '80%',
  maxWidth: 700,
  bgcolor: 'background.paper',
  border: '2px solid #000',
  boxShadow: 24,
  p: 2,
};

// --- A single, expandable row in our history table ---
const HistoryRow = ({ row, onEditClick }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const isActionable = row.status === 'SUCCESS' && row.output_video_gcs_paths;

  return (
    <React.Fragment>
      <TableRow sx={{ '& > *': { borderBottom: 'unset' } }}>
        <TableCell>
          <IconButton aria-label="expand row" size="small" onClick={() => setOpen(!open)}>
            {open ? <KeyboardArrowUp /> : <KeyboardArrowDown />}
          </IconButton>
        </TableCell>
        <TableCell component="th" scope="row">
          {new Date(row.trigger_time).toLocaleString()}
        </TableCell>
        <TableCell sx={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {row.prompt}
        </TableCell>
        <TableCell align="center">
          <Typography variant="caption" color={row.status === 'SUCCESS' ? 'success.main' : 'error.main'}>
            {row.status}
          </Typography>
        </TableCell>
        <TableCell align="center">
  {row.model_used
    .replace(/veo-(\d\.\d+).*/, 'Veo $1')
    .replace('-preview', '')
    .replace('-exp', ' Exp')}
</TableCell>
        <TableCell>{row.video_name}</TableCell>
        <TableCell align="center">
          <Tooltip title={t('history.actions.preview')}>
            <span>
              <IconButton color="primary" onClick={() => setPreviewOpen(true)} disabled={!row.signed_urls || !row.signed_urls[0]}>
                <PlayCircleOutline />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title={t('history.actions.clip')}>
            <span>
              <IconButton color="secondary" onClick={() => onEditClick(row, 'clip')} disabled={!isActionable}>
                <ContentCut />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title={t('history.actions.dub')}>
            <span>
              <IconButton color="secondary" onClick={() => onEditClick(row, 'dub')} disabled={!isActionable}>
                <Mic />
              </IconButton>
            </span>
          </Tooltip>
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell style={{ paddingBottom: 0, paddingTop: 0 }} colSpan={6}>
          <Collapse in={open} timeout="auto" unmountOnExit>
            <Box sx={{ margin: 1, padding: 2, border: '1px dashed grey', borderRadius: '8px' }}>
              <Typography variant="h6" gutterBottom component="div">
                {t('history.details')}
              </Typography>
              <Typography variant="body2" component="p" sx={{ wordBreak: 'break-word' }}>
                <strong>{t('history.fullPrompt')}:</strong> {row.prompt}
              </Typography>
              <Typography variant="body2" component="p">
                <strong>{t('history.genDuration')}:</strong> {Math.round(row.operation_duration || 0)}s
              </Typography>
              <Typography variant="body2" component="p">
                <strong>{t('history.completionTime')}:</strong> {new Date(row.completion_time).toLocaleString()}
              </Typography>
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>

      <Modal open={previewOpen} onClose={() => setPreviewOpen(false)}>
        <Box sx={style}>
          {row.signed_urls && row.signed_urls[0] ? (
            <video src={row.signed_urls[0]} width="100%" controls autoPlay />
          ) : (
            <Alert severity="error">{t('history.noPreview')}</Alert>
          )}
        </Box>
      </Modal>
    </React.Fragment>
  );
};


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
        <Paper sx={{ borderRadius: '12px' }}>
          <TableContainer>
            <Table aria-label="collapsible table">
              <TableHead>
                <TableRow>
                  <TableCell />
                  <TableCell>{t('history.colDate')}</TableCell>
                  <TableCell>{t('history.colPrompt')}</TableCell>
                  <TableCell align="center">{t('history.colStatus')}</TableCell>
                  <TableCell align="center">{t('history.colModel')}</TableCell>
                  <TableCell>{t('history.colName')}</TableCell>
                  <TableCell align="center">{t('history.colPreview')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {history.map((row) => (
                  <HistoryRow key={row.trigger_time} row={row} onEditClick={openModal} />
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <TablePagination
            rowsPerPageOptions={[5, 10, 25]}
            component="div"
            count={totalRows}
            rowsPerPage={rowsPerPage}
            page={page}
            onPageChange={(e, newPage) => fetchHistory(false, newPage, rowsPerPage)}
            onRowsPerPageChange={(e) => fetchHistory(false, 0, parseInt(e.target.value, 10))}
          />
        </Paper>
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
