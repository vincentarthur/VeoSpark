import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import {
  Box, Typography, Paper, CircularProgress, Alert, TextField, Button,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, IconButton, Modal, Chip
} from '@mui/material';
import { Add, Delete, Search, ListAlt } from '@mui/icons-material';

const style = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: 400,
  bgcolor: 'background.paper',
  border: '2px solid #000',
  boxShadow: 24,
  p: 4,
};

const PromptGalleryPage = ({ user }) => {
  const { t } = useTranslation();
  const [prompts, setPrompts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [newPrompt, setNewPrompt] = useState({ text: '', keywords: '' });

  const fetchPrompts = useCallback(async (fetchAll = false) => {
    setLoading(true);
    setError(null);
    try {
      const params = {};
      if (searchTerm && !fetchAll) params.tags = searchTerm;
      const response = await axios.get('/api/prompts', { params });
      setPrompts(response.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not fetch prompts.');
    } finally {
      setLoading(false);
    }
  }, [searchTerm]);

  useEffect(() => {
    // Don't fetch on initial load
  }, []);

  const handleAddPrompt = async () => {
    try {
      await axios.post('/api/prompts', {
        prompt_text: newPrompt.text,
        keywords: newPrompt.keywords.split(',').map(k => k.trim()).filter(Boolean),
      });
      setModalOpen(false);
      setNewPrompt({ text: '', keywords: '' });
      fetchPrompts();
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to add prompt.');
    }
  };

  const handleDeletePrompt = async (promptId) => {
    if (window.confirm(t('gallery.confirmDelete'))) {
      try {
        await axios.delete(`/api/prompts/${promptId}`);
        fetchPrompts();
      } catch (err) {
        alert(err.response?.data?.detail || 'Failed to delete prompt.');
      }
    }
  };

  return (
    <Box>
      <Typography variant="h4" gutterBottom>{t('nav.gallery')}</Typography>
      <Paper sx={{ p: 2, mb: 2, display: 'flex', alignItems: 'center' }}>
        <Box sx={{ maxWidth: '400px', flexGrow: 1 }}>
          <TextField
            label={t('gallery.tags')}
            helperText={t('gallery.tagsHelper')}
            variant="outlined"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && fetchPrompts()}
          fullWidth
        />
        </Box>
        <IconButton onClick={() => fetchPrompts()}><Search /></IconButton>
        <Button variant="contained" startIcon={<ListAlt />} onClick={() => fetchPrompts(true)} sx={{ ml: 2 }}>
          {t('gallery.listAll')}
        </Button>
        <Button variant="contained" startIcon={<Add />} onClick={() => setModalOpen(true)} sx={{ ml: 2 }}>
          {t('gallery.addPrompt')}
        </Button>
      </Paper>

      {loading ? <CircularProgress /> : error ? <Alert severity="error">{error}</Alert> : (
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t('gallery.promptText')}</TableCell>
                <TableCell>{t('gallery.tags')}</TableCell>
                <TableCell>{t('gallery.by')}</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {prompts.map((prompt) => (
                <TableRow key={prompt.id}>
                  <TableCell>{prompt.prompt_text}</TableCell>
                  <TableCell>
                    {prompt.keywords?.map(kw => <Chip key={kw} label={kw} size="small" sx={{ mr: 0.5 }} />)}
                  </TableCell>
                  <TableCell>{prompt.created_by_name}</TableCell>
                  <TableCell>
                    {user?.email === prompt.created_by_email && (
                      <IconButton edge="end" aria-label="delete" onClick={() => handleDeletePrompt(prompt.id)}>
                        <Delete />
                      </IconButton>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)}>
        <Box sx={style}>
          <Typography variant="h6" component="h2">{t('gallery.addPrompt')}</Typography>
          <TextField
            label={t('gallery.promptText')}
            fullWidth
            multiline
            rows={4}
            value={newPrompt.text}
            onChange={(e) => setNewPrompt({ ...newPrompt, text: e.target.value })}
            sx={{ mt: 2 }}
          />
          <TextField
            label={t('gallery.tags')}
            fullWidth
            value={newPrompt.keywords}
            onChange={(e) => setNewPrompt({ ...newPrompt, keywords: e.target.value })}
            helperText={t('gallery.tagsHelper')}
            sx={{ mt: 2 }}
          />
          <Button onClick={handleAddPrompt} sx={{ mt: 2 }} variant="contained">{t('common.submit')}</Button>
        </Box>
      </Modal>
    </Box>
  );
};

export default PromptGalleryPage;
