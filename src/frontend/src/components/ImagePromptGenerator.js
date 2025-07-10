import React, { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box, Button, Typography, Paper, CircularProgress, TextField, Select, MenuItem, FormControl, InputLabel, Alert
} from '@mui/material';
import { CloudUpload } from '@mui/icons-material';
import CameraMovements from './CameraMovements';

const ImagePromptGenerator = () => {
  const { t, i18n } = useTranslation();
  const [characterImage, setCharacterImage] = useState(null);
  const [backgroundImage, setBackgroundImage] = useState(null);
  const [propImage, setPropImage] = useState(null);
  const [generatedPrompt, setGeneratedPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [targetLanguage, setTargetLanguage] = useState(i18n.language);
  const [translatedPrompt, setTranslatedPrompt] = useState('');
  const [translating, setTranslating] = useState(false);
  const [isPreviewVisible, setPreviewVisible] = useState(false);
  const promptTextareaRef = useRef(null);

  const handleImageChange = (e, setImage) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setImage({
        file: file,
        preview: URL.createObjectURL(file),
      });
    }
  };

  const handleSubmit = async () => {
    if (!characterImage && !backgroundImage && !propImage) {
      alert(t('imagePromptGenerator.pleaseUploadAtLeastOne'));
      return;
    }

    setLoading(true);
    setGeneratedPrompt('');

    const formData = new FormData();
    if (characterImage) formData.append('character_image', characterImage.file);
    if (backgroundImage) formData.append('background_image', backgroundImage.file);
    if (propImage) formData.append('prop_image', propImage.file);

    try {
      const response = await fetch('/api/generate-prompt-from-images', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setGeneratedPrompt(data.prompt);
      setTranslatedPrompt('');
    } catch (error) {
      console.error('Error generating prompt:', error);
      alert(t('imagePromptGenerator.failedToGenerate'));
    } finally {
      setLoading(false);
    }
  };

  const handleMovementClick = (promptText) => {
    const textarea = promptTextareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const currentPrompt = generatedPrompt;
    // Add a space if the current prompt is not empty and doesn't end with a space.
    const separator = currentPrompt && !currentPrompt.endsWith(' ') ? ' ' : '';
    const newText = `${currentPrompt.substring(0, start)}${separator}${promptText}${currentPrompt.substring(end)}`;

    setGeneratedPrompt(newText);

    // Move cursor to after the inserted text
    setTimeout(() => {
      textarea.selectionStart = textarea.selectionEnd = start + separator.length + promptText.length;
      textarea.focus();
    }, 0);
  };

  const handleTranslate = async () => {
    if (!generatedPrompt) return;
    setTranslating(true);
    try {
      const response = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: generatedPrompt, target_language: targetLanguage }),
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setTranslatedPrompt(data.translated_text);
    } catch (error) {
      console.error('Error translating prompt:', error);
      alert(t('imagePromptGenerator.failedToTranslate'));
    } finally {
      setTranslating(false);
    }
  };

  const ImageUpload = ({ title, image, onChange }) => (
    <Box sx={{ textAlign: 'center' }}>
      <Typography variant="h6" gutterBottom>{title}</Typography>
      <Paper
        variant="outlined"
        sx={{
          p: 2,
          border: '2px dashed',
          borderColor: 'grey.400',
          height: 220,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          position: 'relative',
          overflow: 'hidden',
          bgcolor: 'grey.50',
          '&:hover': { borderColor: 'primary.main' },
        }}
      >
        {image ? (
          <img src={image.preview} alt={t('imagePromptGenerator.preview')} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '4px' }} />
        ) : (
          <Button
            variant="text"
            component="label"
            startIcon={<CloudUpload />}
          >
            {t('imagePromptGenerator.clickToUpload')}
            <input type="file" hidden accept="image/*" onChange={onChange} />
          </Button>
        )}
      </Paper>
    </Box>
  );

  return (
    <Paper sx={{ p: 3, borderRadius: '16px', border: '1px solid rgba(255, 255, 255, 0.3)', boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.1)' }}>
      <Typography variant="h5" gutterBottom align="center">{t('imagePromptGenerator.title')}</Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: { sm: 'repeat(3, 1fr)' }, gap: 3, my: 3 }}>
        <ImageUpload
          title={t('imagePromptGenerator.characterImage')}
          image={characterImage}
          onChange={(e) => handleImageChange(e, setCharacterImage)}
        />
        <ImageUpload
          title={t('imagePromptGenerator.backgroundImage')}
          image={backgroundImage}
          onChange={(e) => handleImageChange(e, setBackgroundImage)}
        />
        <ImageUpload
          title={t('imagePromptGenerator.propImage')}
          image={propImage}
          onChange={(e) => handleImageChange(e, setPropImage)}
        />
      </Box>
      <Button onClick={handleSubmit} variant="contained" size="large" fullWidth disabled={loading} sx={{ mb: 2 }}>
        {loading ? <CircularProgress size={24} color="inherit" /> : t('imagePromptGenerator.generatePrompt')}
      </Button>

      {generatedPrompt && (
        <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
          <Typography variant="h6" gutterBottom>{t('imagePromptGenerator.generatedPrompt')}</Typography>
          <TextField
            inputRef={promptTextareaRef}
            value={generatedPrompt}
            onChange={(e) => setGeneratedPrompt(e.target.value)}
            multiline
            fullWidth
            rows={4}
            variant="outlined"
          />
          <CameraMovements onMovementClick={handleMovementClick} />
          <Box sx={{ mt: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Button onClick={() => setPreviewVisible(!isPreviewVisible)} variant="outlined" size="small">
              {isPreviewVisible ? t('Hide Preview') : t('Show Preview')}
            </Button>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <FormControl size="small">
                <InputLabel>{t('Translate')}</InputLabel>
                <Select value={targetLanguage} label={t('Translate')} onChange={(e) => setTargetLanguage(e.target.value)}>
                  <MenuItem value="en">English</MenuItem>
                  <MenuItem value="ja">日本語</MenuItem>
                  <MenuItem value="zh">中文</MenuItem>
                </Select>
              </FormControl>
              <Button onClick={handleTranslate} variant="contained" size="small" disabled={translating}>
                {translating ? <CircularProgress size={20} /> : t('imagePromptGenerator.translate')}
              </Button>
            </Box>
          </Box>
          {isPreviewVisible && (
            <Alert severity="info" sx={{ mt: 2, whiteSpace: 'pre-wrap' }}>
              <Typography variant="subtitle2" gutterBottom>{t('Final Prompt Preview')}</Typography>
              {generatedPrompt}
            </Alert>
          )}
          {translatedPrompt && (
            <Alert severity="success" sx={{ mt: 2, whiteSpace: 'pre-wrap' }}>
              <Typography variant="subtitle2" gutterBottom>{t('imagePromptGenerator.translatedPromptTitle')}</Typography>
              {translatedPrompt}
            </Alert>
          )}
        </Paper>
      )}
    </Paper>
  );
};

export default ImagePromptGenerator;
