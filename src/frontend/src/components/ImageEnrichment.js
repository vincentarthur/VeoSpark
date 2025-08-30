import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Row, Col, Button, Input, Typography, Spin, Alert, Select, Upload, Card, Collapse, Form
} from 'antd';
import { UploadOutlined, CloseOutlined } from '@ant-design/icons';
import axios from 'axios';
import ImageCard from './ImageCard';

const { Title, Text } = Typography;
const { TextArea } = Input;
const { Option } = Select;
const { Panel } = Collapse;

const ImageEnrichment = ({ user }) => {
  const { t } = useTranslation();
  const [form] = Form.useForm();

  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [models, setModels] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [generatedImages, setGeneratedImages] = useState([]);
  const [revisedPrompt, setRevisedPrompt] = useState('');
  const [raiReasons, setRaiReasons] = useState([]);
  const [selectedModel, setSelectedModel] = useState(null);
  const [pollingTaskId, setPollingTaskId] = useState(null);
  const [selectedProject, setSelectedProject] = useState(null);

  useEffect(() => {
    const fetchModels = async () => {
      try {
        const response = await axios.get('/api/image-enrichment-models');
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
    const fetchProjects = async () => {
      try {
        const response = await axios.get('/api/creative-projects');
        const fetchedProjects = response.data;
        setProjects(fetchedProjects);

        const lastSelectedProjectId = sessionStorage.getItem('lastSelectedProjectId');
        if (lastSelectedProjectId && fetchedProjects.some(p => p.id === lastSelectedProjectId)) {
          form.setFieldsValue({ creative_project_id: lastSelectedProjectId });
          const project = fetchedProjects.find(p => p.id === lastSelectedProjectId);
          setSelectedProject(project);
        } else if (fetchedProjects.length > 0) {
          // If no project is saved in session, default to the first project
          form.setFieldsValue({ creative_project_id: fetchedProjects[0].id });
          setSelectedProject(fetchedProjects[0]);
        }
      } catch (error) {
        console.error("Failed to fetch creative projects:", error);
      }
    };
    fetchModels();
    fetchProjects();
  }, [form]);

  useEffect(() => {
    if (!pollingTaskId) return;

    const interval = setInterval(async () => {
      try {
        const response = await axios.get(`/api/tasks/${pollingTaskId}`);
        const { status, result, error } = response.data;

        if (status === 'completed') {
          const syntheticImages = result.images.map(image => ({
            ...image,
            prompt: result.revised_prompt,
            model_used: result.model,
            status: 'SUCCESS',
            trigger_time: new Date().toISOString(),
            completion_time: new Date().toISOString(),
            operation_duration: result.duration,
            user_email: user.email,
            resolution: result.resolution,
            creative_project_id: selectedProject?.id,
            project_name: selectedProject?.name,
          }));
          setGeneratedImages(syntheticImages);
          setRevisedPrompt(result.revised_prompt);
          if (result.rai_reasons) {
            setRaiReasons(result.rai_reasons);
          }
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
  }, [pollingTaskId, user.email, selectedProject]);

  const handleImageUpload = (file) => {
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    return false; // Prevent upload
  };

  const clearImage = () => {
    setImageFile(null);
    setImagePreview(null);
  };

  const handleUseAsFirstFrame = async ({ signedUrl }) => {
    if (!signedUrl) return;
    try {
      const response = await fetch(signedUrl);
      const blob = await response.blob();
      const file = new File([blob], `used-as-frame.${blob.type.split('/')[1] || 'png'}`, { type: blob.type });
      setImageFile(file);
      setImagePreview(URL.createObjectURL(file));
      window.scrollTo(0, 0);
    } catch (err) {
      setError('Failed to use image as a new frame.');
      console.error("Failed to use image as first frame:", err);
    }
  };

  const handleSubmit = async (values) => {
    if (!imageFile) {
      setError(t('imageEnrichment.noImageError'));
      return;
    }

    setLoading(true);
    setError(null);
    setGeneratedImages([]);
    setRevisedPrompt('');
    setRaiReasons([]);

    const project = projects.find(p => p.id === values.creative_project_id);
    setSelectedProject(project);

    const formData = new FormData();
    formData.append('file', imageFile);
    formData.append('sub_prompt', values.sub_prompt);
    formData.append('model', values.model);
    formData.append('creative_project_id', values.creative_project_id);

    try {
      const response = await axios.post('/api/images/enrich', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (response.data.task_id) {
        setPollingTaskId(response.data.task_id);
      } else {
        setError('Failed to start generation task.');
        setLoading(false);
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'An unexpected error occurred.');
      setLoading(false);
    }
  };

  return (
    <Row gutter={32}>
      <Col xs={24} md={8}>
        <Card>
          <Title level={2}>{t('nav.imageEnrichment')}</Title>
          <Form form={form} layout="vertical" onFinish={handleSubmit} initialValues={{ sample_count: 1, image_size: '1K' }}>
            <Form.Item label={t('imageEnrichment.uploadImage')}>
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
                    {t('imageEnrichment.uploadImage')}
                  </Button>
                )}
              </Upload>
            </Form.Item>
            <Form.Item name="sub_prompt" label={t('imageEnrichment.subPromptLabel')} rules={[{ required: true }]}>
              <TextArea rows={2} />
            </Form.Item>
            <Form.Item name="creative_project_id" label={t('dashboard.dedicatedProjectLabel')} rules={[{ required: true, message: 'Please select a project!' }]}>
              <Select
                placeholder="Select a project"
                onChange={(projectId) => {
                  sessionStorage.setItem('lastSelectedProjectId', projectId);
                  const project = projects.find(p => p.id === projectId);
                  setSelectedProject(project);
                  form.setFieldsValue({ creative_project_id: projectId });
                }}
              >
                {projects.map((p) => (
                  <Option key={p.id} value={p.id}>{p.name}</Option>
                ))}
              </Select>
            </Form.Item>
            <Form.Item name="model" label={t('dashboard.modelLabel')} rules={[{ required: true }]}>
              <Select onChange={(value) => setSelectedModel(value)}>
                {models.map((m) => (
                  <Option key={m.id} value={m.id}>{m.name}</Option>
                ))}
              </Select>
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit" loading={loading} block size="large">
                {t('imageEnrichment.generateButton')}
              </Button>
            </Form.Item>
          </Form>
        </Card>
      </Col>
      <Col xs={24} md={16}>
        {loading && <Spin size="large" />}
        {error && <Alert message={error} type="error" showIcon />}
        {raiReasons && raiReasons.length > 0 && (
            <Alert
              message={t('dashboard.raiFilterTitle')}
              description={
                <div>
                  {raiReasons.map((reason, index) => (
                    <div key={index} style={{ marginBottom: '10px' }}>
                      <Text strong>{t('dashboard.raiFilterErrorCode')}:</Text> {reason.code}<br />
                      <Text strong>{t('dashboard.raiFilterCategory')}:</Text> {reason.category}<br />
                      <Text strong>{t('dashboard.raiFilterDescription')}:</Text> {reason.description}<br />
                      <Text strong>{t('dashboard.raiFilterFilteredContent')}:</Text> {reason.filtered}
                    </div>
                  ))}
                </div>
              }
              type="warning"
              showIcon
              style={{ width: '100%', marginBottom: 16 }}
            />
        )}
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
                <ImageCard
                  image={image}
                  models={models}
                  user={user}
                  onUseAsFirstFrame={handleUseAsFirstFrame}
                  showAddToProject={false}
                />
              </Col>
            ))}
          </Row>
        )}
      </Col>
    </Row>
  );
};

export default ImageEnrichment;
