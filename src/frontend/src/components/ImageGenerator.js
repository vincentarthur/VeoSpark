import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import {
  Row, Col, Typography, Spin, Alert, Button,
  Form, Input, Select, Slider, Card
} from 'antd';
import { CameraOutlined } from '@ant-design/icons';
import ImageCard from './ImageCard';
import ShareModal from './ShareModal';
import { useShareModal } from '../hooks/useShareModal';

const { Title } = Typography;
const { TextArea } = Input;
const { Option } = Select;

const ImageGenerator = ({ user, onUseAsFirstFrame }) => {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [sampleCount, setSampleCount] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [generatedImages, setGeneratedImages] = useState([]);
  const [pollingTaskId, setPollingTaskId] = useState(null);
  const {
    modalOpen: shareModalOpen,
    selectedItem: shareSelectedItem,
    openModal: openShareModal,
    closeModal: closeShareModal,
    handleSubmit: handleShareSubmit,
  } = useShareModal(() => {});

  useEffect(() => {
    const fetchModels = async () => {
      try {
        const response = await axios.get('/api/image-models');
        const fetchedModels = response.data.models || [];
        setModels(fetchedModels);
        if (fetchedModels.length > 0) {
          const defaultModel = fetchedModels[0].id;
          form.setFieldsValue({ model: defaultModel, sample_count: 1 });
          setSelectedModel(defaultModel);
        }
      } catch (error) {
        console.error("Failed to fetch image models:", error);
      }
    };
    fetchModels();
  }, [form]);

  useEffect(() => {
    if (!pollingTaskId) return;

    const interval = setInterval(async () => {
      try {
        const response = await axios.get(`/api/tasks/${pollingTaskId}`);
        const { status, result, error } = response.data;

        if (status === 'completed') {
          const syntheticImages = result.images.map(img => ({
            ...img,
            prompt: result.prompt,
            model_used: result.model_used,
            status: 'SUCCESS',
            trigger_time: new Date().toISOString(),
            user_email: user.email,
          }));
          setGeneratedImages(syntheticImages);
          setLoading(false);
          setPollingTaskId(null);
          clearInterval(interval);
        } else if (status === 'failed') {
          setError(error || 'An unexpected error occurred during generation.');
          setLoading(false);
          setPollingTaskId(null);
          clearInterval(interval);
        }
      } catch (err) {
        setError('Failed to get task status.');
        setLoading(false);
        setPollingTaskId(null);
        clearInterval(interval);
      }
    }, 5000); // Poll every 5 seconds

    return () => clearInterval(interval);
  }, [pollingTaskId, user.email]);

  const handleSubmit = async (values) => {
    setLoading(true);
    setError(null);
    setGeneratedImages([]);

    try {
      const response = await axios.post('/api/images/generate', { ...values, sample_count: sampleCount });
      if (response.data.task_id) {
        setPollingTaskId(response.data.task_id);
      } else {
        setError('Failed to start generation task.');
        setLoading(false);
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not generate images.');
      setLoading(false);
    }
  };

  return (
    <Row gutter={32}>
      <Col xs={24} md={8}>
        <Card>
          <Title level={2}>{t('imageGenerator.title')}</Title>
          <Form form={form} layout="vertical" onFinish={handleSubmit} initialValues={{
            aspect_ratio: '1:1',
            sample_count: 1,
          }}>
            <Form.Item name="model" label={t('imageGenerator.modelLabel')} rules={[{ required: true }]}>
              <Select onChange={(value) => {
                setSelectedModel(value);
                if (value === 'imagen-4.0-ultra-generate-preview-06-06') {
                  form.setFieldsValue({ sample_count: 1 });
                  setSampleCount(1);
                }
              }}>
                {models.map((m) => (
                  <Option key={m.id} value={m.id}>{m.name}</Option>
                ))}
              </Select>
            </Form.Item>
            <Form.Item name="prompt" label={t('imageGenerator.promptLabel')} rules={[{ required: true }]}>
              <TextArea rows={4} />
            </Form.Item>
            <Form.Item name="negative_prompt" label={t('imageGenerator.negativePromptLabel')}>
              <TextArea rows={2} />
            </Form.Item>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="aspect_ratio" label={t('imageGenerator.aspectRatioLabel')}>
                  <Select>
                    <Option value="1:1">1:1</Option>
                    <Option value="16:9">16:9</Option>
                    <Option value="9:16">9:16</Option>
                    <Option value="4:3">4:3</Option>
                    <Option value="3:4">3:4</Option>
                  </Select>
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label={`${t('imageGenerator.sampleCountLabel')}: ${sampleCount}`}>
                  <Slider
                    min={1}
                    max={4}
                    step={1}
                    onChange={setSampleCount}
                    value={sampleCount}
                    disabled={selectedModel === 'imagen-4.0-ultra-generate-preview-06-06'}
                  />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                loading={loading}
                icon={<CameraOutlined />}
                block
                size="large"
              >
                {t('imageGenerator.generateButton')}
              </Button>
            </Form.Item>
          </Form>
        </Card>
      </Col>
      <Col xs={24} md={16}>
        {loading && <Spin size="large" />}
        {error && <Alert message={error} type="error" showIcon />}
        {generatedImages.length > 0 && (
          <Card>
            <Title level={4}>{t('imageGenerator.resultsTitle')}</Title>
            <Row gutter={[16, 16]}>
              {generatedImages.map((image, index) => (
                <Col xs={24} sm={12} md={8} key={index}>
                  <ImageCard
                    image={image}
                    models={models}
                    user={user}
                    onShareClick={openShareModal}
                    onUseAsFirstFrame={onUseAsFirstFrame}
                  />
                </Col>
              ))}
            </Row>
          </Card>
        )}
      </Col>
      {shareSelectedItem && (
        <ShareModal
          open={shareModalOpen}
          onClose={closeShareModal}
          onSubmit={handleShareSubmit}
          item={shareSelectedItem}
        />
      )}
    </Row>
  );
};

export default ImageGenerator;
