import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box, Button, TextField, Typography, Paper, CircularProgress, Alert, Select, MenuItem, InputLabel, FormControl, IconButton, Accordion, AccordionSummary, AccordionDetails, Grid
} from '@mui/material';
import { CloudUpload, Clear, ExpandMore as ExpandMoreIcon } from '@mui/icons-material';
import axios from 'axios';
import ImageCard from './ImageCard';

const ImageImitation = ({ user }) => {
  const { t } = useTranslation();

  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [subPrompt, setSubPrompt] = useState('');
  const [sampleCount, setSampleCount] = useState(1);
  const [models, setModels] = useState([]);
  const [model, setModel] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [generatedImages, setGeneratedImages] = useState([]);
  const [revisedPrompt, setRevisedPrompt] = useState('');

  useEffect(() => {
    const fetchModels = async () => {
      try {
        const response = await axios.get('/api/image-models');
        const fetchedModels = response.data.models || [];
        setModels(fetchedModels);
        if (fetchedModels.length > 0) {
          setModel(fetchedModels[0].id);
        }
      } catch (error) {
        console.error("Failed to fetch models:", error);
      }
    };
    fetchModels();
  }, []);

  const handleImageUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const clearImage = () => {
    setImageFile(null);
    setImagePreview(null);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!imageFile) {
      setError(t('imageImitation.noImageError'));
      return;
    }

    setLoading(true);
    setError(null);
    setGeneratedImages([]);
    setRevisedPrompt('');

    const formData = new FormData();
    formData.append('file', imageFile);
    formData.append('sub_prompt', subPrompt);
    formData.append('model', model);
    formData.append('sample_count', sampleCount);

    try {
      const response = await axios.post('/api/images/imitate', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const syntheticImages = response.data.images.map(image => ({
        ...image,
        prompt: response.data.revised_prompt,
        model_used: model,
        status: 'SUCCESS',
        trigger_time: new Date().toISOString(),
        completion_time: new Date().toISOString(),
        operation_duration: response.data.duration,
        user_email: user.email,
      }));
      setGeneratedImages(syntheticImages);
      setRevisedPrompt(response.data.revised_prompt);
    } catch (err) {
      setError(err.response?.data?.detail || 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 4 }}>
      <Paper
        component="form"
        onSubmit={handleSubmit}
        sx={{
          p: 3, width: { xs: '100%', md: '450px' }, flexShrink: 0,
          borderRadius: '16px',
          border: '1px solid rgba(255, 255, 255, 0.3)', boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.1)'
        }}
      >
        <Typography variant="h5" gutterBottom>{t('nav.imageImitation')}</Typography>

        <Box sx={{ my: 2, p: 2, border: '1px dashed grey', borderRadius: '8px', textAlign: 'center' }}>
          {imagePreview ? (
            <Box sx={{ position: 'relative' }}>
              <img src={imagePreview} alt="Preview" style={{ maxWidth: '100%', maxHeight: '150px', borderRadius: '4px' }} />
              <IconButton onClick={clearImage} size="small" sx={{ position: 'absolute', top: 0, right: 0, background: 'rgba(255,255,255,0.7)' }}>
                <Clear />
              </IconButton>
            </Box>
          ) : (
            <Button
              variant="outlined"
              component="label"
              startIcon={<CloudUpload />}
            >
              {t('imageImitation.uploadImage')}
              <input type="file" hidden accept="image/*" onChange={handleImageUpload} />
            </Button>
          )}
        </Box>

        <TextField
          label={t('imageImitation.subPromptLabel')}
          multiline
          rows={2}
          fullWidth
          value={subPrompt}
          onChange={(e) => setSubPrompt(e.target.value)}
          margin="normal"
          required
        />

        <FormControl fullWidth margin="normal">
          <InputLabel id="model-select-label">{t('dashboard.modelLabel')}</InputLabel>
          <Select
            labelId="model-select-label"
            value={model}
            label={t('dashboard.modelLabel')}
            onChange={(e) => setModel(e.target.value)}
          >
            {models.map((m) => (
              <MenuItem key={m.id} value={m.id}>{m.name}</MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl fullWidth margin="normal" disabled={model === 'imagen-4.0-ultra-generate-preview-06-06'}>
          <InputLabel id="sample-count-select-label">{t('imageGenerator.sampleCountLabel')}</InputLabel>
          <Select
            labelId="sample-count-select-label"
            value={model === 'imagen-4.0-ultra-generate-preview-06-06' ? 1 : sampleCount}
            label={t('imageGenerator.sampleCountLabel')}
            onChange={(e) => setSampleCount(e.target.value)}
          >
            {[1, 2, 3, 4].map(count => (
              <MenuItem key={count} value={count}>{count}</MenuItem>
            ))}
          </Select>
        </FormControl>

        <Button type="submit" variant="contained" size="large" disabled={loading} fullWidth sx={{ mt: 3, py: 1.5 }}>
          {loading ? <CircularProgress size={24} color="inherit" /> : t('imageImitation.generateButton')}
        </Button>
      </Paper>
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, pt: 4 }}>
        {loading && (
          <Box sx={{ textAlign: 'center', width: '100%' }}>
            <CircularProgress />
            <Typography sx={{ mt: 2 }}>{t('dashboard.generatingStatus')}</Typography>
          </Box>
        )}
        {error && <Alert severity="error" sx={{ width: '100%' }}>{error}</Alert>}

        {revisedPrompt && (
          <Accordion sx={{ width: '100%', maxWidth: '820px' }}>
            <AccordionSummary
              expandIcon={<ExpandMoreIcon />}
              aria-controls="panel1a-content"
              id="panel1a-header"
            >
              <Typography>Consolidated Prompt</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Typography sx={{ fontStyle: 'italic' }}>
                "{revisedPrompt}"
              </Typography>
            </AccordionDetails>
          </Accordion>
        )}

        {generatedImages.length > 0 && (
          <Grid container spacing={2}>
            {generatedImages.map((image, index) => (
              <Grid item xs={12} sm={6} md={4} key={index}>
                <ImageCard image={image} models={models} user={user} />
              </Grid>
            ))}
          </Grid>
        )}
      </Box>
    </Box>
  );
};

export default ImageImitation;
