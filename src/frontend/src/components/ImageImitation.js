import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Row, Col, Button, Input, Typography, Spin, Alert, Select, Upload, Card, Collapse, Form
} from 'antd';
import { UploadOutlined, CloseOutlined } from '@ant-design/icons';
import axios from 'axios';
import ImageCard from './ImageCard';

const { Title } = Typography;
const { TextArea } = Input;
const { Option } = Select;
const { Panel } = Collapse;

const ImageImitation = ({ user }) => {
  const { t } = useTranslation();
  const [form] = Form.useForm();

  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [generatedImages, setGeneratedImages] = useState([]);
  const [revisedPrompt, setRevisedPrompt] = useState('');
  const [selectedModel, setSelectedModel] = useState(null);

  useEffect(() => {
    const fetchModels = async () => {
      try {
        const response = await axios.get('/api/image-models');
        const fetchedModels = response.data.models || [];
        setModels(fetchedModels);
        if (fetchedModels.length > 0) {
          const initialModel = fetchedModels[0].id;
          form.setFieldsValue({ model: initialModel });
          setSelectedModel(initialModel);
        }
      } catch (error) {
        console.error("Failed to fetch models:", error);
      }
    };
    fetchModels();
  }, [form]);

  const handleImageUpload = (file) => {
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    return false; // Prevent upload
  };

  const clearImage = () => {
    setImageFile(null);
    setImagePreview(null);
  };

  const handleSubmit = async (values) => {
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
    formData.append('sub_prompt', values.sub_prompt);
    formData.append('model', values.model);
    formData.append('sample_count', values.sample_count);

    try {
      const response = await axios.post('/api/images/imitate', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const syntheticImages = response.data.images.map(image => ({
        ...image,
        prompt: response.data.revised_prompt,
        model_used: values.model,
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
    <Row gutter={32}>
      <Col xs={24} md={8}>
        <Card>
          <Title level={2}>{t('nav.imageImitation')}</Title>
          <Form form={form} layout="vertical" onFinish={handleSubmit} initialValues={{ sample_count: 1 }}>
            <Form.Item label={t('imageImitation.uploadImage')}>
              <Upload
                beforeUpload={handleImageUpload}
                showUploadList={false}
                accept="image/*"
              >
                {imagePreview ? (
                  <div style={{ position: 'relative' }}>
                    <img src={imagePreview} alt="Preview" style={{ maxWidth: '100%', maxHeight: '150px', borderRadius: '4px' }} />
                    <Button icon={<CloseOutlined />} onClick={clearImage} size="small" style={{ position: 'absolute', top: 0, right: 0 }} />
                  </div>
                ) : (
                  <Button icon={<UploadOutlined />}>
                    {t('imageImitation.uploadImage')}
                  </Button>
                )}
              </Upload>
            </Form.Item>
            <Form.Item name="sub_prompt" label={t('imageImitation.subPromptLabel')} rules={[{ required: true }]}>
              <TextArea rows={2} />
            </Form.Item>
            <Form.Item name="model" label={t('dashboard.modelLabel')} rules={[{ required: true }]}>
              <Select onChange={(value) => {
                setSelectedModel(value);
                if (value === 'imagen-4.0-ultra-generate-preview-06-06') {
                  form.setFieldsValue({ sample_count: 1 });
                }
              }}>
                {models.map((m) => (
                  <Option key={m.id} value={m.id}>{m.name}</Option>
                ))}
              </Select>
            </Form.Item>
            <Form.Item name="sample_count" label={t('imageGenerator.sampleCountLabel')}>
              <Select disabled={selectedModel === 'imagen-4.0-ultra-generate-preview-06-06'}>
                {[1, 2, 3, 4].map(count => (
                  <Option key={count} value={count}>{count}</Option>
                ))}
              </Select>
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit" loading={loading} block size="large">
                {t('imageImitation.generateButton')}
              </Button>
            </Form.Item>
          </Form>
        </Card>
      </Col>
      <Col xs={24} md={16}>
        {loading && <Spin size="large" />}
        {error && <Alert message={error} type="error" showIcon />}
        {revisedPrompt && (
          <Collapse>
            <Panel header="Consolidated Prompt" key="1">
              <Typography.Text italic>"{revisedPrompt}"</Typography.Text>
            </Panel>
          </Collapse>
        )}
        {generatedImages.length > 0 && (
          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            {generatedImages.map((image, index) => (
              <Col xs={24} sm={12} md={8} key={index}>
                <ImageCard image={image} models={models} user={user} />
              </Col>
            ))}
          </Row>
        )}
      </Col>
    </Row>
  );
};

export default ImageImitation;
