import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import {
  Box, Typography, Paper, CircularProgress, Alert, Button,
  TextField, Select, MenuItem, FormControl, InputLabel, Grid, Slider, Modal
} from '@mui/material';
import { PhotoCamera } from '@mui/icons-material';
import ImageCard from './ImageCard';

const ImageGenerator = ({ user, onUseAsFirstFrame }) => {
  const { t } = useTranslation();
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [generatedImages, setGeneratedImages] = useState([]);
  const [selectedImage, setSelectedImage] = useState(null);

  const [formState, setFormState] = useState({
    model: '',
    prompt: '',
    negative_prompt: '',
    aspect_ratio: '1:1',
    sample_count: 1,
  });

  useEffect(() => {
    const fetchModels = async () => {
      try {
        const response = await axios.get('/api/image-models');
        setModels(response.data.models || []);
        if (response.data.models.length > 0) {
          setFormState(prev => ({ ...prev, model: response.data.models[0].id }));
        }
      } catch (error) {
        console.error("Failed to fetch image models:", error);
      }
    };
    fetchModels();
  }, []);

  const handleInputChange = (event) => {
    const { name, value } = event.target;
    setFormState(prev => ({ ...prev, [name]: value }));
  };

  const handleSliderChange = (name) => (event, value) => {
    setFormState(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);
    setGeneratedImages([]);

    try {
      const response = await axios.post('/api/images/generate', formState);
      const syntheticImages = response.data.images.map(img => ({
        ...img,
        prompt: formState.prompt,
        model_used: formState.model,
        status: 'SUCCESS',
        trigger_time: new Date().toISOString(),
        user_email: user.email,
      }));
      setGeneratedImages(syntheticImages);
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not generate images.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box>
      <Grid container spacing={3}>
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 3, borderRadius: '12px', height: '100%' }}>
            <Typography variant="h5" gutterBottom>
              {t('imageGenerator.title')}
            </Typography>
            <Grid container spacing={3}>
              <Grid item xs={12}>
                <FormControl fullWidth>
                  <InputLabel>{t('imageGenerator.modelLabel')}</InputLabel>
                  <Select name="model" value={formState.model} label={t('imageGenerator.modelLabel')} onChange={handleInputChange}>
                    {models.map((m) => (
                      <MenuItem key={m.id} value={m.id}>{m.name}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12}>
                <TextField
                  name="prompt"
                  label={t('imageGenerator.promptLabel')}
                  multiline
                  rows={4}
                  fullWidth
                  value={formState.prompt}
                  onChange={handleInputChange}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  name="negative_prompt"
                  label={t('imageGenerator.negativePromptLabel')}
                  multiline
                  rows={2}
                  fullWidth
                  value={formState.negative_prompt}
                  onChange={handleInputChange}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth>
                  <InputLabel>{t('imageGenerator.aspectRatioLabel')}</InputLabel>
                  <Select name="aspect_ratio" value={formState.aspect_ratio} label={t('imageGenerator.aspectRatioLabel')} onChange={handleInputChange}>
                    <MenuItem value="1:1">1:1</MenuItem>
                    <MenuItem value="16:9">16:9</MenuItem>
                    <MenuItem value="9:16">9:16</MenuItem>
                    <MenuItem value="4:3">4:3</MenuItem>
                    <MenuItem value="3:4">3:4</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography gutterBottom>{t('imageGenerator.sampleCountLabel')}: {formState.model === 'imagen-4.0-ultra-generate-preview-06-06' ? 1 : formState.sample_count}</Typography>
                <Slider
                  name="sample_count"
                  value={formState.model === 'imagen-4.0-ultra-generate-preview-06-06' ? 1 : formState.sample_count}
                  onChange={handleSliderChange('sample_count')}
                  aria-labelledby="input-slider"
                  valueLabelDisplay="auto"
                  step={1}
                  marks
                  min={1}
                  max={4}
                  disabled={formState.model === 'imagen-4.0-ultra-generate-preview-06-06'}
                />
              </Grid>
              <Grid item xs={12}>
                <Button
                  variant="contained"
                  startIcon={loading ? <CircularProgress size={20} color="inherit" /> : <PhotoCamera />}
                  onClick={handleSubmit}
                  disabled={loading || !formState.prompt}
                  fullWidth
                >
                  {loading ? t('imageGenerator.generatingStatus') : t('imageGenerator.generateButton')}
                </Button>
              </Grid>
            </Grid>
          </Paper>
        </Grid>
        <Grid item xs={12} md={8}>
          {loading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
              <CircularProgress />
            </Box>
          )}
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          {generatedImages.length > 0 && (
            <Paper sx={{ p: 3, borderRadius: '12px', background: 'linear-gradient(to right, #ece9e6, #ffffff)', height: '100%' }}>
              <Typography variant="h5" gutterBottom sx={{ mb: 2, fontWeight: 'bold', color: 'primary.main' }}>{t('imageGenerator.resultsTitle')}</Typography>
              <Grid container spacing={2}>
                {generatedImages.map((image, index) => (
                  <Grid item xs={12} sm={6} md={4} key={index}>
                    <ImageCard
                      image={image}
                      models={models}
                      user={user}
                      onUseAsFirstFrame={onUseAsFirstFrame}
                    />
                  </Grid>
                ))}
              </Grid>
            </Paper>
          )}
        </Grid>
      </Grid>
      <Modal
        open={!!selectedImage}
        onClose={() => setSelectedImage(null)}
        aria-labelledby="image-modal-title"
        aria-describedby="image-modal-description"
      >
        <Box sx={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          bgcolor: 'background.paper',
          boxShadow: 24,
          p: 4,
        }}>
          <img src={selectedImage?.signed_url} alt={selectedImage?.prompt} style={{ maxWidth: '90vw', maxHeight: '90vh' }} />
        </Box>
      </Modal>
    </Box>
  );
};

export default ImageGenerator;
