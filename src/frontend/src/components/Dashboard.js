import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box, Button, TextField, Typography, Slider, RadioGroup, FormControlLabel, Radio, Checkbox,
  Paper, CircularProgress, Alert, Select, MenuItem, InputLabel, FormControl, IconButton, Tooltip
} from '@mui/material';
import { ContentCut, Mic, CloudUpload, Clear } from '@mui/icons-material';
import axios from 'axios';
import { useEditingModal } from '../hooks/useEditingModal';
import EditingModal from './EditingModal';
import CameraMovements from './CameraMovements';

// A simple component for displaying the generated video
const FilmStripPlayer = ({ video, onEditClick, title }) => {
  const { t } = useTranslation();
  if (!video || !video.signed_url) {
    return null;
  }
  return (
    <Box
      sx={{
        bgcolor: '#212121',
        p: '10px',
        pb: '20px',
        borderRadius: '8px',
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
          {title}
        </Typography>
        {onEditClick && (
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
        )}
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

const Dashboard = ({ initialFirstFrame }) => {
  const { t } = useTranslation();

  const [models, setModels] = useState([]);
  const [model, setModel] = useState('');
  const [prompt, setPrompt] = useState('A dramatic timelapse of a storm cloud over a desert');
  const [generationMode, setGenerationMode] = useState('generate'); // 'generate' or 'extend'
  const [duration, setDuration] = useState(8);
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [resolution, setResolution] = useState('1080p');
  const [generateAudio, setGenerateAudio] = useState(true);
  const [enhancePrompt, setEnhancePrompt] = useState(true);
  const [sampleCount, setSampleCount] = useState(1);

  // State for image-to-video
  const [imageGcsUri, setImageGcsUri] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);

  // State for final frame image
  const [finalFrameGcsUri, setFinalFrameGcsUri] = useState(null);
  const [finalFramePreview, setFinalFramePreview] = useState(null);
  const [finalFrameUploading, setFinalFrameUploading] = useState(false);
  const [finalFrameUploadError, setFinalFrameUploadError] = useState(null);

  // State for video extension
  const [userVideos, setUserVideos] = useState([]);
  const [selectedVideo, setSelectedVideo] = useState('');
  const [extendDuration, setExtendDuration] = useState(5);
  const [gcsFetchError, setGcsFetchError] = useState(null);
  const [gcsPrefix, setGcsPrefix] = useState('');
  const [isFetchingGcs, setIsFetchingGcs] = useState(false);


  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [generatedVideos, setGeneratedVideos] = useState([]); // Now stores array of video objects
  const [revisedPrompt, setRevisedPrompt] = useState('');
  const promptInputRef = useRef(null);

  const {
    modalOpen,
    selectedVideo: editingVideo, 
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

  const handleMovementClick = (promptText) => {
    const textarea = promptInputRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const currentPrompt = prompt;
    // Add a space if the current prompt is not empty and doesn't end with a space.
    const separator = currentPrompt && !currentPrompt.endsWith(' ') ? ' ' : '';
    const newPrompt = `${currentPrompt.substring(0, start)}${separator}${promptText}${currentPrompt.substring(end)}`;

    setPrompt(newPrompt);

    // Move cursor to after the inserted text
    setTimeout(() => {
      textarea.selectionStart = textarea.selectionEnd = start + separator.length + promptText.length;
      textarea.focus();
    }, 0);
  };

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

  const handleFinalFrameUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setFinalFrameUploading(true);
    setFinalFrameUploadError(null);
    setFinalFramePreview(URL.createObjectURL(file)); // Show instant preview

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await axios.post('/api/images/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setFinalFrameGcsUri(response.data.gcs_uri);
    } catch (err) {
      setFinalFrameUploadError(err.response?.data?.detail || 'Upload failed.');
      setFinalFramePreview(null); // Clear preview on error
    } finally {
      setFinalFrameUploading(false);
    }
  };

  const clearImage = () => {
    setImageGcsUri(null);
    setImagePreview(null);
    setUploadError(null);
  };

  const clearFinalFrame = () => {
    setFinalFrameGcsUri(null);
    setFinalFramePreview(null);
    setFinalFrameUploadError(null);
  };

  const isV3Model = model.startsWith('veo-3.0');
  const isV2GenerateModel = model === 'veo-2.0-generate-001';
  const isVeo2Model = model.startsWith('veo-2.0');

  useEffect(() => {
    if (initialFirstFrame) {
      setImageGcsUri(initialFirstFrame.gcsUri);
      setImagePreview(initialFirstFrame.signedUrl);
    }
  }, [initialFirstFrame]);

  useEffect(() => {
    const fetchModels = async () => {
      try {
        const response = await axios.get('/api/models');
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

  useEffect(() => {
    if (isV3Model && aspectRatio === '9:16') setAspectRatio('16:9');
    if (isV3Model) {
      setEnhancePrompt(true);
      setDuration(8);
    }
    if (isV2GenerateModel && generationMode === 'extend') {
      const fetchUserVideos = async () => {
        setIsFetchingGcs(true);
        try {
          setGcsFetchError(null);
          const response = await axios.get('/api/gcs/videos', { params: { prefix: gcsPrefix } });
          setUserVideos(response.data.videos || []);
          setGcsPrefix(response.data.prefix);
        } catch (err) {
          setGcsFetchError(err.response?.data?.detail || 'Failed to fetch user videos.');
        } finally {
          setIsFetchingGcs(false);
        }
      };
      fetchUserVideos();
    }
  }, [model, isV3Model, isV2GenerateModel, generationMode, aspectRatio, gcsPrefix]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setGeneratedVideos([]);
    setRevisedPrompt('');

    try {
      const isExtending = isV2GenerateModel && generationMode === 'extend';
      const response = await axios.post('/api/videos/generate', {
        model,
        prompt,
        duration,
        aspectRatio,
        sampleCount,
        image_gcs_uri: isExtending ? selectedVideo : imageGcsUri,
        final_frame_gcs_uri: finalFrameGcsUri,
        generateAudio: isV3Model ? generateAudio : undefined,
        enhancePrompt: isV3Model || isV2GenerateModel ? enhancePrompt : undefined,
        extend_duration: isExtending ? extendDuration : undefined,
        resolution: isV3Model ? resolution : undefined,
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
            {models.map((m) => (
              <MenuItem key={m.id} value={m.id}>{m.name}</MenuItem>
            ))}
          </Select>
        </FormControl>

        <TextField
          label={t('dashboard.promptLabel')}
          multiline
          rows={4}
          fullWidth
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          margin="normal"
          required
          inputRef={promptInputRef}
        />

        <CameraMovements onMovementClick={handleMovementClick} />

        {isV2GenerateModel && (
          <Box sx={{ my: 2 }}>
            <RadioGroup row value={generationMode} onChange={(e) => setGenerationMode(e.target.value)}>
              <FormControlLabel value="generate" control={<Radio />} label={t('dashboard.generateWithImage')} />
              <FormControlLabel value="extend" control={<Radio />} label={t('dashboard.extendVideo')} />
            </RadioGroup>
          </Box>
        )}

        {(!isV2GenerateModel || generationMode === 'generate') && (
          <>
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
                  {isV2GenerateModel ? t('dashboard.uploadFirstFrame') : t('dashboard.uploadImage')}
                  <input type="file" hidden accept="image/*" onChange={handleImageUpload} />
                </Button>
              )}
              {uploadError && <Alert severity="error" sx={{ mt: 1 }}>{uploadError}</Alert>}
            </Box>

            {isV2GenerateModel && (
              <Box sx={{ my: 2, p: 2, border: '1px dashed grey', borderRadius: '8px', textAlign: 'center' }}>
                {finalFramePreview ? (
                  <Box sx={{ position: 'relative' }}>
                    <img src={finalFramePreview} alt="Final Frame Preview" style={{ maxWidth: '100%', maxHeight: '150px', borderRadius: '4px' }} />
                    <IconButton onClick={clearFinalFrame} size="small" sx={{ position: 'absolute', top: 0, right: 0, background: 'rgba(255,255,255,0.7)' }}>
                      <Clear />
                    </IconButton>
                  </Box>
                ) : (
                  <Button
                    variant="outlined"
                    component="label"
                    startIcon={finalFrameUploading ? <CircularProgress size={20} /> : <CloudUpload />}
                    disabled={finalFrameUploading}
                  >
                    {t('dashboard.uploadLastFrame')}
                    <input type="file" hidden accept="image/*" onChange={handleFinalFrameUpload} />
                  </Button>
                )}
                {finalFrameUploadError && <Alert severity="error" sx={{ mt: 1 }}>{finalFrameUploadError}</Alert>}
              </Box>
            )}
          </>
        )}

        {isV2GenerateModel && generationMode === 'extend' && (
          <Box sx={{ my: 2, p: 2, border: '1px solid grey', borderRadius: '8px' }}>
            <Typography variant="h6" gutterBottom>{t('dashboard.extendVideoTitle')}</Typography>
            <FormControl fullWidth margin="normal" disabled={isFetchingGcs}>
              <InputLabel id="video-select-label">
                {isFetchingGcs ? t('dashboard.loadingVideos') : t('dashboard.selectVideoLabel')}
              </InputLabel>
              <Select
                labelId="video-select-label"
                value={selectedVideo}
                label={isFetchingGcs ? t('dashboard.loadingVideos') : t('dashboard.selectVideoLabel')}
                onChange={(e) => setSelectedVideo(e.target.value)}
                startAdornment={isFetchingGcs && <CircularProgress size={20} sx={{ mr: 1 }} />}
              >
                {userVideos.map((video) => (
                  <MenuItem key={video.gcs_uri} value={video.gcs_uri}>{video.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
            {gcsFetchError && <Alert severity="error" sx={{ mt: 1 }}>{gcsFetchError}</Alert>}

            <LabeledSlider
              label={t('dashboard.extendDurationLabel')}
              displayValue={t('dashboard.seconds', { count: extendDuration })}
              value={extendDuration}
              onChange={(_, val) => setExtendDuration(val)}
              valueLabelDisplay="auto"
              step={1}
              marks
              min={5}
              max={8}
            />
          </Box>
        )}

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
          disabled={isV3Model || (isV2GenerateModel && generationMode === 'extend')}
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
          disabled={isV2GenerateModel && generationMode === 'extend'}
        />

        <Typography gutterBottom sx={{ mt: 2 }}>{t('dashboard.aspectRatioLabel')}</Typography>
        <RadioGroup row value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)}>
            <FormControlLabel value="16:9" control={<Radio />} label="16:9" />
            <FormControlLabel value="9:16" control={<Radio />} label="9:16" disabled={isV3Model} />
        </RadioGroup>

        {isV3Model && (
          <FormControl fullWidth margin="normal">
            <InputLabel id="resolution-select-label">{t('dashboard.resolutionLabel')}</InputLabel>
            <Select
              labelId="resolution-select-label"
              value={resolution}
              label={t('dashboard.resolutionLabel')}
              onChange={(e) => setResolution(e.target.value)}
            >
              <MenuItem value="720p">720p</MenuItem>
              <MenuItem value="1080p">1080p</MenuItem>
            </Select>
          </FormControl>
        )}

        {(isV3Model || isVeo2Model) && (
          <Box sx={{ mt: 2, border: '1px solid rgba(0, 0, 0, 0.23)', borderRadius: '8px', p: 2 }}>
            <Typography variant="subtitle1" gutterBottom>
              {isV3Model ? t('dashboard.v3options') : t('dashboard.v2options')}
            </Typography>
            {isV3Model && (
              <FormControlLabel control={<Checkbox checked={generateAudio} onChange={(e) => setGenerateAudio(e.target.checked)} />} label={t('dashboard.generateAudio')} />
            )}
            <FormControlLabel
              control={<Checkbox checked={enhancePrompt} onChange={(e) => setEnhancePrompt(e.target.checked)} />}
              label={isV3Model ? t('dashboard.enhancePromptWithHint') : t('dashboard.enhancePrompt')}
              disabled={isV3Model}
            />
          </Box>
        )}

        <Button type="submit" variant="contained" size="large" disabled={loading} fullWidth sx={{ mt: 3, py: 1.5 }}>
            {loading ? <CircularProgress size={24} color="inherit" /> : t('dashboard.generateButton')}
        </Button>
      </Paper>
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'row', alignItems: 'flex-start', gap: 4, pt: 4, flexWrap: 'wrap', justifyContent: 'center' }}>
        {loading && (
          <Box sx={{ textAlign: 'center', width: '100%' }}>
            <CircularProgress />
            <Typography sx={{ mt: 2 }}>{t('dashboard.generatingStatus')}</Typography>
          </Box>
        )}
        {error && <Alert severity="error" sx={{ width: '100%' }}>{error}</Alert>}

        {revisedPrompt && (
          <Paper sx={{ p: 2, background: 'rgba(232, 245, 233, 0.8)', width: '100%', maxWidth: '820px', border: '1px solid #4caf50' }}>
            <Typography variant="h6" gutterBottom>Enhanced Prompt</Typography>
            <Typography variant="body1" sx={{ fontStyle: 'italic' }}>"{revisedPrompt}"</Typography>
          </Paper>
        )}

        {isV2GenerateModel && generationMode === 'extend' && selectedVideo && (
          <FilmStripPlayer
            title="EXTENDED VIDEO"
            video={userVideos.find(v => v.gcs_uri === selectedVideo)}
          />
        )}

        {generatedVideos.map((video, index) => (
          <FilmStripPlayer
            key={video.gcs_uri || index}
            video={video}
            onEditClick={openModal}
            title={`PREVIEW VIDEO ${index + 1}`}
          />
        ))}
      </Box>

      {editingVideo && (
        <EditingModal
          open={modalOpen}
          onClose={closeModal}
          onSubmit={handleModalSubmit}
          video={editingVideo}
          mode={modalMode}
        />
      )}
    </Box>
  );
};
export default Dashboard;
