import React, { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Row, Col, Button, Typography, Input, Select, Alert, Upload, Card
} from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import CameraMovements from './CameraMovements';

const { Title } = Typography;
const { TextArea } = Input;
const { Option } = Select;

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

  const handleImageChange = (file, setImage) => {
    setImage({
      file: file,
      preview: URL.createObjectURL(file),
    });
    return false; // Prevent upload
  };

  const handleSubmit = async () => {
    if (!characterImage && !backgroundImage && !propImage) {
      Alert.error(t('imagePromptGenerator.pleaseUploadAtLeastOne'));
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
      Alert.error(t('imagePromptGenerator.failedToGenerate'));
    } finally {
      setLoading(false);
    }
  };

  const handleMovementClick = (promptText) => {
    const currentPrompt = generatedPrompt;
    const newText = `${currentPrompt} ${promptText}`;
    setGeneratedPrompt(newText);
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
      Alert.error(t('imagePromptGenerator.failedToTranslate'));
    } finally {
      setTranslating(false);
    }
  };

  const ImageUpload = ({ title, image, onChange }) => (
    <Col xs={24} sm={8}>
      <Card>
        <Title level={5}>{title}</Title>
        <Upload.Dragger
          beforeUpload={(file) => onChange(file)}
          showUploadList={false}
          accept="image/*"
          height={200}
        >
          {image ? (
            <img src={image.preview} alt={t('imagePromptGenerator.preview')} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <>
              <p className="ant-upload-drag-icon">
                <UploadOutlined />
              </p>
              <p className="ant-upload-text">{t('imagePromptGenerator.clickToUpload')}</p>
            </>
          )}
        </Upload.Dragger>
      </Card>
    </Col>
  );

  return (
    <Card>
      <Title level={2} style={{ textAlign: 'center' }}>{t('imagePromptGenerator.title')}</Title>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <ImageUpload
          title={t('imagePromptGenerator.characterImage')}
          image={characterImage}
          onChange={(file) => handleImageChange(file, setCharacterImage)}
        />
        <ImageUpload
          title={t('imagePromptGenerator.backgroundImage')}
          image={backgroundImage}
          onChange={(file) => handleImageChange(file, setBackgroundImage)}
        />
        <ImageUpload
          title={t('imagePromptGenerator.propImage')}
          image={propImage}
          onChange={(file) => handleImageChange(file, setPropImage)}
        />
      </Row>
      <Button onClick={handleSubmit} type="primary" size="large" block loading={loading} style={{ marginBottom: 16 }}>
        {t('imagePromptGenerator.generatePrompt')}
      </Button>

      {generatedPrompt && (
        <Card>
          <Title level={5}>{t('imagePromptGenerator.generatedPrompt')}</Title>
          <TextArea
            ref={promptTextareaRef}
            value={generatedPrompt}
            onChange={(e) => setGeneratedPrompt(e.target.value)}
            rows={4}
          />
          <CameraMovements onMovementClick={handleMovementClick} />
          <Row justify="space-between" align="middle" style={{ marginTop: 16 }}>
            <Col>
              <Button onClick={() => setPreviewVisible(!isPreviewVisible)}>
                {isPreviewVisible ? t('Hide Preview') : t('Show Preview')}
              </Button>
            </Col>
            <Col>
              <Row gutter={8}>
                <Col>
                  <Select value={targetLanguage} onChange={setTargetLanguage}>
                    <Option value="en">English</Option>
                    <Option value="ja">日本語</Option>
                    <Option value="zh">中文</Option>
                  </Select>
                </Col>
                <Col>
                  <Button onClick={handleTranslate} type="primary" loading={translating}>
                    {t('imagePromptGenerator.translate')}
                  </Button>
                </Col>
              </Row>
            </Col>
          </Row>
          {isPreviewVisible && (
            <Alert message={t('Final Prompt Preview')} description={generatedPrompt} type="info" showIcon style={{ marginTop: 16 }} />
          )}
          {translatedPrompt && (
            <Alert message={t('imagePromptGenerator.translatedPromptTitle')} description={translatedPrompt} type="success" showIcon style={{ marginTop: 16 }} />
          )}
        </Card>
      )}
    </Card>
  );
};

export default ImagePromptGenerator;
