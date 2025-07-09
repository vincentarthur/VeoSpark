import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import './ImagePromptGenerator.css';

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
      setTranslatedPrompt(''); // Reset translation when a new prompt is generated
    } catch (error) {
      console.error('Error generating prompt:', error);
      alert(t('imagePromptGenerator.failedToGenerate'));
    } finally {
      setLoading(false);
    }
  };

  const handleTranslate = async () => {
    if (!generatedPrompt) return;
    setTranslating(true);
    try {
      const response = await fetch('/api/translate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: generatedPrompt,
          target_language: targetLanguage,
        }),
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
    <div className="image-upload-container">
      <h3>{title}</h3>
      <div className="image-upload-box">
        {image ? (
          <img src={image.preview} alt={t('imagePromptGenerator.preview')} className="image-preview" />
        ) : (
          <div className="upload-placeholder">{t('imagePromptGenerator.clickToUpload')}</div>
        )}
        <input type="file" accept="image/*" onChange={onChange} />
      </div>
    </div>
  );

  return (
    <div className="prompt-generator-container">
      <h2>{t('imagePromptGenerator.title')}</h2>
      <div className="images-section">
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
      </div>
      <button onClick={handleSubmit} disabled={loading}>
        {loading ? t('imagePromptGenerator.generating') : t('imagePromptGenerator.generatePrompt')}
      </button>
      {generatedPrompt && (
        <div className="generated-prompt-section">
          <h3>{t('imagePromptGenerator.generatedPrompt')}</h3>
          <p>{generatedPrompt}</p>
          <div className="translation-controls">
            <select value={targetLanguage} onChange={(e) => setTargetLanguage(e.target.value)}>
              <option value="en">English</option>
              <option value="ja">日本語</option>
              <option value="zh">中文</option>
            </select>
            <button onClick={handleTranslate} disabled={translating}>
              {translating ? t('imagePromptGenerator.translating') : t('imagePromptGenerator.translate')}
            </button>
          </div>
          {translatedPrompt && (
            <div className="translated-prompt">
              <h4>{t('imagePromptGenerator.translatedPromptTitle')}</h4>
              <p>{translatedPrompt}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ImagePromptGenerator;
