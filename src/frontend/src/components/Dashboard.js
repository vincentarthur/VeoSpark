import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box, Button, TextField, Typography, Slider, RadioGroup, FormControlLabel, Radio, Checkbox,
  Paper, CircularProgress, Alert, Select, MenuItem, InputLabel, FormControl, IconButton, Tooltip
} from '@mui/material';
import { ContentCut, Mic, CloudUpload, Clear } from '@mui/icons-material';
import axios from 'axios';
import { useEditingModal } from '../hooks/useEditingModal';
import EditingModal from './EditingModal';

// A simple component for displaying the generated video
const FilmStripPlayer = ({ video, onEditClick }) => {
  const { t } = useTranslation();
  return (
    <Box
      sx={{
        bgcolor: '#212121',
        p: '10px',
        pb: '20px',
        borderRadius: '8px',
//        transform: 'rotate(-1deg)',
        boxShadow: '0 10px 20px rgba(0,0,0,0.2)',
        display: 'inline-block',
      }}
    >
      <Box sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: '10px',
      }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {[...Array(8)].map((_, i) => (
            <Box key={i} sx={{ width: '8px', height: '8px', bgcolor: 'rgba(255,255,255,0.2)', borderRadius: '2px' }} />
          ))}
        </Box>
        <video src={video.signed_url} width="400" controls autoPlay loop muted style={{ borderRadius: '4px' }} />
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {[...Array(8)].map((_, i) => (
            <Box key={i} sx={{ width: '8px', height: '8px', bgcolor: 'rgba(255,255,255,0.2)', borderRadius: '2px' }} />
          ))}
        </Box>
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: '10px', px: 1 }}>
        <Typography variant="caption" sx={{ color: 'grey.500' }}>
          VEO STUDIO - PREVIEW
        </Typography>
        <Box>
          <Tooltip title={t('history.actions.clip')}>
            <IconButton size="small" onClick={() => onEditClick(video, 'clip')}>
              <ContentCut sx={{ color: 'grey.400' }} />
            </IconButton>
          </Tooltip>
          <Tooltip title={t('history.actions.dub')}>
            <IconButton size="small" onClick={() => onEditClick(video, 'dub')}>
              <Mic sx={{ color: 'grey.400' }} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>
    </Box>
  )
};

// Reusable component for a cleaner slider layout
const LabeledSlider = ({ label, displayValue, ...sliderProps }) => {
  return (
    <Box sx={{ mt: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography id={`${label}-slider-label`} gutterBottom mb={0}>
          {label}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {displayValue}
        </Typography>
      </Box>
      <Slider
        aria-labelledby={`${label}-slider-label`}
        {...sliderProps}
      />
    </Box>
  );
};

const VEO_MODELS = {
  'veo-3.0-generate-preview': 'Veo 3.0 Preview',
  'veo-2.0-generate-001': 'Veo 2.0',
  'veo-2.0-generate-exp': 'Veo 2.0 Experimental',
};

const CAMERA_CONTROLS = [
  'FIXED', 'PAN_LEFT', 'PAN_RIGHT', 'TILT_UP', 'TILT_DOWN', 'TRUCK_LEFT', 'TRUCK_RIGHT',
  'PEDESTAL_UP', 'PEDESTAL_DOWN', 'PUSH_IN', 'PULL_OUT'
];

const Dashboard = () => {
  const { t } = useTranslation();

  const [model, setModel] = useState('veo-3.0-generate-preview');
  const [prompt, setPrompt] = useState('A dramatic timelapse of a storm cloud over a desert');
  const [duration, setDuration] = useState(8);
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [cameraControl, setCameraControl] = useState('');
  const [generateAudio, setGenerateAudio] = useState(true);
  const [enhancePrompt, setEnhancePrompt] = useState(true);
  const [sampleCount, setSampleCount] = useState(1);

  // State for image-to-video
  const [imageGcsUri, setImageGcsUri] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [generatedVideos, setGeneratedVideos] = useState([]); // Now stores array of video objects
  const [revisedPrompt, setRevisedPrompt] = useState('');

  const {
    modalOpen,
    selectedVideo, 
    modalMode, 
    openModal, 
    closeModal, 
    handleSubmit: handleModalSubmit
  } = useEditingModal((originalVideo, newVideoData) => {
    // onActionComplete: update the specific video in our local state
    setGeneratedVideos(currentVideos =>
      currentVideos.map(v =>
        v.gcs_uri === originalVideo.gcs_uri ? { ...v, ...newVideoData } : v
      )
    );
  });

  const handleImageUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setUploading(true);
    setUploadError(null);
    setImagePreview(URL.createObjectURL(file)); // Show instant preview

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await axios.post('/api/images/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setImageGcsUri(response.data.gcs_uri);
    } catch (err) {
      setUploadError(err.response?.data?.detail || 'Upload failed.');
      setImagePreview(null); // Clear preview on error
    } finally {
      setUploading(false);
    }
  };

  const clearImage = () => {
    setImageGcsUri(null);
    setImagePreview(null);
    setUploadError(null);
  };

  const isExpModel = model === 'veo-2.0-generate-exp';
  const isV3Model = model === 'veo-3.0-generate-preview';

  useEffect(() => {
    if (isV3Model && aspectRatio === '9:16') setAspectRatio('16:9');
    if (!isExpModel) setCameraControl('');
    if (isV3Model) {
      setEnhancePrompt(true);
      setDuration(8);
    }
  }, [model, isV3Model, isExpModel, aspectRatio]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setGeneratedVideos([]);
    setRevisedPrompt('');

    try {
      const response = await axios.post('/api/videos/generate', {
        model,
        prompt,
        duration,
        aspectRatio,
        sampleCount,
        image_gcs_uri: imageGcsUri, // Add the image URI to the request
        camera_control: isExpModel ? cameraControl : undefined,
        generateAudio: isV3Model ? generateAudio : undefined,
        enhancePrompt: isV3Model ? enhancePrompt : undefined,
      });

      setGeneratedVideos(response.data.videos);
      if (response.data.revisedPrompt) {
        setRevisedPrompt(response.data.revisedPrompt);
      }

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
        <Typography variant="h5" gutterBottom>{t('dashboard.title')}</Typography>

        <FormControl fullWidth margin="normal">
          <InputLabel id="model-select-label">{t('dashboard.modelLabel')}</InputLabel>
          <Select
            labelId="model-select-label"
            value={model}
            label={t('dashboard.modelLabel')}
            onChange={(e) => setModel(e.target.value)}
          >
            {Object.entries(VEO_MODELS).map(([id, name]) => (
              <MenuItem key={id} value={id}>{name}</MenuItem>
            ))}
          </Select>
        </FormControl>

        <TextField label={t('dashboard.promptLabel')} multiline rows={4} fullWidth value={prompt} onChange={(e) => setPrompt(e.target.value)} margin="normal" required />

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
              startIcon={uploading ? <CircularProgress size={20} /> : <CloudUpload />}
              disabled={uploading}
            >
              {t('dashboard.uploadImage')}
              <input type="file" hidden accept="image/*" onChange={handleImageUpload} />
            </Button>
          )}
          {uploadError && <Alert severity="error" sx={{ mt: 1 }}>{uploadError}</Alert>}
        </Box>

        <LabeledSlider
          label={t('dashboard.durationLabel')}
          displayValue={t('dashboard.seconds', { count: duration })}
          value={duration}
          onChange={(_, val) => setDuration(val)}
          valueLabelDisplay="auto"
          step={1}
          marks
          min={5}
          max={8}
          disabled={isV3Model}
        />

        <LabeledSlider
          label={t('dashboard.videoCountLabel')}
          displayValue={sampleCount}
          value={sampleCount}
          onChange={(_, val) => setSampleCount(val)}
          valueLabelDisplay="auto"
          step={1}
          marks
          min={1}
          max={2}
        />

        <Typography gutterBottom sx={{ mt: 2 }}>{t('dashboard.aspectRatioLabel')}</Typography>
        <RadioGroup row value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)}>
            <FormControlLabel value="16:9" control={<Radio />} label="16:9" />
            <FormControlLabel value="9:16" control={<Radio />} label="9:16" disabled={isV3Model} />
        </RadioGroup>

        {isV3Model && (
          <Box sx={{ mt: 2, border: '1px solid rgba(0, 0, 0, 0.23)', borderRadius: '8px', p: 2 }}>
            <Typography variant="subtitle1" gutterBottom>{t('dashboard.v3options')}</Typography>
            <FormControlLabel control={<Checkbox checked={generateAudio} onChange={(e) => setGenerateAudio(e.target.checked)} />} label={t('dashboard.generateAudio')} />
            <FormControlLabel disabled control={<Checkbox checked={enhancePrompt} />} label={t('dashboard.enhancePrompt')} />
          </Box>
        )}

        {isExpModel && (
          <FormControl fullWidth margin="normal" sx={{ mt: 2 }}>
            <InputLabel id="camera-control-label">{t('dashboard.cameraControlLabel')}</InputLabel>
            <Select
              labelId="camera-control-label"
              value={cameraControl}
              onChange={(e) => setCameraControl(e.target.value)}
              label={t('dashboard.cameraControlLabel')}
            >
              <MenuItem value=""><em>None</em></MenuItem>
              {CAMERA_CONTROLS.map((name) => (
                <MenuItem key={name} value={name}>{name}</MenuItem>
              ))}
            </Select>
          </FormControl>
        )}

        <Button type="submit" variant="contained" size="large" disabled={loading} fullWidth sx={{ mt: 3, py: 1.5 }}>
            {loading ? <CircularProgress size={24} color="inherit" /> : t('dashboard.generateButton')}
        </Button>
      </Paper>
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, pt: 4 }}>
        {loading && (
          <Box sx={{ textAlign: 'center' }}>
            <CircularProgress />
            <Typography sx={{ mt: 2 }}>{t('dashboard.generatingStatus')}</Typography>
          </Box>
        )}
        {error && <Alert severity="error" sx={{ width: '100%' }}>{error}</Alert>}

        {revisedPrompt && (
          <Paper sx={{ p: 2, background: 'rgba(232, 245, 233, 0.8)', width: '100%', maxWidth: '600px', border: '1px solid #4caf50' }}>
            <Typography variant="h6" gutterBottom>Enhanced Prompt</Typography>
            <Typography variant="body1" sx={{ fontStyle: 'italic' }}>"{revisedPrompt}"</Typography>
          </Paper>
        )}

        {generatedVideos.map((video, index) => (
          <FilmStripPlayer key={video.gcs_uri || index} video={video} onEditClick={openModal} />
        ))}
      </Box>

      {selectedVideo && (
        <EditingModal
          open={modalOpen}
          onClose={closeModal}
          onSubmit={handleModalSubmit}
          video={selectedVideo}
          mode={modalMode}
        />
      )}
    </Box>
  );
};
export default Dashboard;
