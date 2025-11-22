import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Row, Col, Button, Input, Typography, Spin, Alert, Upload, Form, List, Select, Card
} from 'antd';
import { PlusOutlined, SendOutlined, DeleteOutlined, SyncOutlined } from '@ant-design/icons';
import axios from 'axios';
import ImageCard from './ImageCard';

const { Paragraph, Text } = Typography;
const { TextArea } = Input;
const { Option } = Select;

const ConversationalImageEnrichment = ({ user, onUseAsFirstFrame, onUseAsLastFrame, selectedProject, onProjectSelect }) => {
  const { t } = useTranslation();
  const [form] = Form.useForm();

  const [conversation, setConversation] = useState([]);
  const [imageFiles, setImageFiles] = useState([]);
  const [imagePreviews, setImagePreviews] = useState([]);
  const [models, setModels] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [pollingTaskId, setPollingTaskId] = useState(null);
  const [generatingImages, setGeneratingImages] = useState(0);
  const [maxImages, setMaxImages] = useState(3);
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const shortcutText = isMac ? '⌘ + Enter' : 'Alt + Enter';

  useEffect(() => {
    form.setFieldsValue({ creative_project_id: selectedProject });
  }, [selectedProject, form]);

  useEffect(() => {
    const fetchModels = async () => {
      try {
        const response = await axios.get('/api/image-models');
        const fetchedModels = response.data.models || [];
        setModels(fetchedModels);
      } catch (error) {
        console.error("Failed to fetch models:", error);
      }
    };
    const fetchProjects = async () => {
      try {
        const response = await axios.get('/api/creative-projects');
        setProjects(response.data);
        if (selectedProject && !response.data.some(p => p.id === selectedProject)) {
          onProjectSelect(null); 
        }
      } catch (error) {
        console.error("Failed to fetch creative projects:", error);
      }
    };
    fetchModels();
    fetchProjects();
  }, [selectedProject, onProjectSelect]);

  const pollTaskStatus = useCallback(async (taskId) => {
    try {
      const response = await axios.get(`/api/tasks/${taskId}`);
      const { status, result, error } = response.data;

      if (status === 'completed') {
        const newModelMessage = {
          type: 'model',
          images: result.images.map(image => ({
            ...image,
            prompt: result.revised_prompt,
            model_used: result.model,
            status: 'SUCCESS',
            trigger_time: new Date().toISOString(),
            completion_time: new Date().toISOString(),
            operation_duration: result.duration,
            user_email: user.email,
            resolution: result.resolution,
            aspect_ratio: result.aspect_ratio,
          })),
          revisedPrompt: result.revised_prompt,
          raiReasons: result.rai_reasons,
          warnings: result.warnings,
        };
        setConversation(prev => [...prev, newModelMessage]);
        setGeneratingImages(0);
        setLoading(false);
        setPollingTaskId(null);
      } else if (status === 'failed') {
        setGeneratingImages(0);
        setError(error || 'An unexpected error occurred during generation.');
        setLoading(false);
        setPollingTaskId(null);
      } else {
        // If still processing, poll again
        setTimeout(() => pollTaskStatus(taskId), 5000);
      }
    } catch (err) {
      setError('Failed to get task status.');
      setGeneratingImages(0);
      setLoading(false);
      setPollingTaskId(null);
    }
  }, [user.email]);

  useEffect(() => {
    if (pollingTaskId) {
      pollTaskStatus(pollingTaskId);
    }
  }, [pollingTaskId, pollTaskStatus]);

  const handleImageUpload = (files) => {
    const newFiles = [...imageFiles, ...files].slice(0, maxImages);
    setImageFiles(newFiles);
    const newPreviews = newFiles.map(f => URL.createObjectURL(f));
    setImagePreviews(newPreviews);
  };

  const onValuesChange = (changedValues) => {
    if (changedValues.model) {
      const newMax = changedValues.model === 'gemini-3-pro-image-preview' ? 14 : 3;
      setMaxImages(newMax);
      if (imageFiles.length > newMax) {
        const trimmedFiles = imageFiles.slice(0, newMax);
        const trimmedPreviews = imagePreviews.slice(0, newMax);
        setImageFiles(trimmedFiles);
        setImagePreviews(trimmedPreviews);
      }
    }
  };

  const handleRemoveImage = (index) => {
    const newFiles = [...imageFiles];
    newFiles.splice(index, 1);
    setImageFiles(newFiles);

    const newPreviews = [...imagePreviews];
    newPreviews.splice(index, 1);
    setImagePreviews(newPreviews);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (isMac ? e.metaKey : e.altKey)) {
      e.preventDefault();
      form.submit();
    }
  };

  const handleClearHistory = () => {
    setConversation([]);
  };

  const handleRegenerate = async (messageIndex) => {
    const userMessage = conversation[messageIndex];
    if (!userMessage || userMessage.type !== 'user') return;

    const newConversation = conversation.slice(0, messageIndex + 1);
    setConversation(newConversation);

    setLoading(true);
    setGeneratingImages(form.getFieldValue('sample_count') || 1);
    setError(null);

    const formData = new FormData();

    if (userMessage.files && userMessage.files.length > 0) {
      userMessage.files.forEach(file => {
        formData.append('files', file);
      });
    } else {
      const previousConversation = conversation.slice(0, messageIndex);
      const lastModelMessage = [...previousConversation].reverse().find(m => m.type === 'model' && m.images.length > 0);
      if (lastModelMessage) {
          lastModelMessage.images.forEach(image => {
              formData.append('previous_image_gcs_paths', image.gcs_uri);
          });
      }
    }

    formData.append('sub_prompt', userMessage.prompt);
    formData.append('model', form.getFieldValue('model') || 'gemini-2.5-flash-image-preview');
    formData.append('sample_count', form.getFieldValue('sample_count') || 1);
    formData.append('aspect_ratio', form.getFieldValue('aspect_ratio') || '1:1');
    formData.append('resolution', form.getFieldValue('resolution') || '2K');
    formData.append('creative_project_id', form.getFieldValue('creative_project_id'));
    
    const textHistory = newConversation.map(m => ({
        type: m.type,
        prompt: m.prompt || m.revisedPrompt
    })).filter(m => m.prompt);
    formData.append('conversation_history', JSON.stringify(textHistory));

    try {
        const response = await axios.post('/api/images/enrich', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });
        if (response.data.task_id) {
            setPollingTaskId(response.data.task_id);
        } else {
            setError('Failed to start generation task.');
            setGeneratingImages(0);
            setLoading(false);
        }
    } catch (err) {
        setError(err.response?.data?.detail || 'An unexpected error occurred.');
        setGeneratingImages(0);
        setLoading(false);
    }
  };

  const handleSubmit = async (values) => {
    // if (imageFiles.length === 0 && conversation.length === 0) {
    //   setError(t('imageEnrichment.noImageError'));
    //   return;
    // }

    const userMessage = {
      type: 'user',
      prompt: values.prompt,
      images: imagePreviews, // For display
      files: [...imageFiles], // For regeneration
    };
    setConversation(prev => [...prev, userMessage]);
    setLoading(true);
    setGeneratingImages(values.sample_count);
    setError(null);
    form.resetFields(['prompt']);
    setImageFiles([]);
    setImagePreviews([]);

    const formData = new FormData();
    if (imageFiles.length > 0) {
      imageFiles.forEach(file => {
        formData.append('files', file);
      });
    } else {
      // Find the last generated image to use as input for the next turn
      const lastModelMessage = [...conversation].reverse().find(m => m.type === 'model' && m.images.length > 0);
      if (lastModelMessage) {
        lastModelMessage.images.forEach(image => {
          formData.append('previous_image_gcs_paths', image.gcs_uri);
        });
      }
    }
    formData.append('sub_prompt', values.prompt);
    formData.append('model', values.model);
    formData.append('sample_count', values.sample_count);
    formData.append('aspect_ratio', values.aspect_ratio);
    formData.append('resolution', values.resolution);
    formData.append('creative_project_id', values.creative_project_id);
    if (conversation.length > 0) {
      const textHistory = conversation.map(m => ({
        type: m.type,
        prompt: m.prompt || m.revisedPrompt
      })).filter(m => m.prompt);
      formData.append('conversation_history', JSON.stringify(textHistory));
    }

    try {
      const response = await axios.post('/api/images/enrich', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (response.data.task_id) {
        setPollingTaskId(response.data.task_id);
      } else {
        setError('Failed to start generation task.');
        setGeneratingImages(0);
        setLoading(false);
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'An unexpected error occurred.');
      setGeneratingImages(0);
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 280px)' }}>
      <div style={{ padding: '10px 20px 0', textAlign: 'right' }}>
        <Button onClick={handleClearHistory}>
          {t('imageEnrichment.clearHistory')}
        </Button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
        <List
          dataSource={conversation}
          renderItem={(item, index) => (
            <List.Item style={{ border: 'none', padding: '10px 0' }}>
              {item.type === 'user' && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%', alignItems: 'center' }}>
                  <Button 
                    icon={<SyncOutlined />} 
                    onClick={() => handleRegenerate(index)}
                    disabled={loading}
                    style={{ marginRight: '10px' }}
                    title={t('imageEnrichment.regenerate', 'Regenerate')}
                  />
                  <div style={{ maxWidth: '60%' }}>
                    {item.images && item.images.map((img, i) => <img key={i} src={img} alt={`User input ${i}`} style={{ maxWidth: '100px', borderRadius: '8px', marginBottom: '8px', marginRight: '8px' }} />)}
                    <Paragraph style={{ background: '#f0f0f0', padding: '10px', borderRadius: '8px', textAlign: 'left' }}>{item.prompt}</Paragraph>
                  </div>
                </div>
              )}
              {item.type === 'model' && (
                <div style={{ display: 'flex', justifyContent: 'flex-start', width: '100%' }}>
                  <Row gutter={[16, 16]} style={{ width: '100%' }}>
                    {item.images.map((image, imgIndex) => (
                      <Col xs={24} sm={12} md={8} lg={6} key={`${index}-${imgIndex}`}>
                        <ImageCard 
                          image={image} 
                          models={models} 
                          user={user} 
                          onUseAsFirstFrame={onUseAsFirstFrame} 
                          onUseAsLastFrame={onUseAsLastFrame}
                          onShareClick={true}
                          showAddToProject={false}
                          />
                      </Col>
                    ))}
                  </Row>
                  {item.warnings && item.warnings.length > 0 && (
                    <Alert
                      message="Warnings"
                      description={
                        <ul>
                          {item.warnings.map((warning, i) => (
                            <li key={i}>{warning}</li>
                          ))}
                        </ul>
                      }
                      type="warning"
                      showIcon
                      style={{ marginTop: '10px', width: '100%' }}
                    />
                  )}
                </div>
              )}
            </List.Item>
          )}
        />
        {generatingImages > 0 && (
          <List.Item style={{ border: 'none', padding: '10px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-start', width: '100%' }}>
              <Row gutter={[16, 16]} style={{ width: '100%' }}>
                {[...Array(generatingImages)].map((_, i) => (
                  <Col xs={24} sm={12} md={8} lg={6} key={`generating-${i}`}>
                    <Card style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                      <Spin size="large" />
                      <Text style={{ marginTop: '10px' }}>{t('imageEnrichment.generating', 'Generating...')}</Text>
                    </Card>
                  </Col>
                ))}
              </Row>
            </div>
          </List.Item>
        )}
        {error && <Alert message={error} type="error" showIcon style={{ margin: '10px 0' }} />}
      </div>
      <div style={{ padding: '20px', borderTop: '1px solid #f0f0f0' }}>
        <Form form={form} onFinish={handleSubmit} onValuesChange={onValuesChange} initialValues={{ aspect_ratio: '1:1', sample_count: 1, model: 'gemini-2.5-flash-image-preview', resolution: '2K' }}>
          <Row gutter={16}>
            <Col>
              <Form.Item name="creative_project_id" label={t('dashboard.dedicatedProjectLabel')} rules={[{ required: true, message: 'Please select a project!' }]}>
                <Select
                  placeholder="Select a project"
                  value={selectedProject}
                  onChange={onProjectSelect}
                  style={{ width: 200 }}
                >
                  {projects.map((p) => (
                    <Option key={p.id} value={p.id}>{p.name}</Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col>
              <Form.Item name="model" label={t('imageEnrichment.modelLabel')}>
                <Select style={{ width: 180 }}>
                  <Option value="gemini-2.5-flash-image-preview">Nano Banana</Option>
                  <Option value="gemini-3-pro-image-preview">Nano Banana Pro</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col>
              <Form.Item name="sample_count" label={t('imageEnrichment.sampleCount')}>
                <Select style={{ width: 70 }}>
                  {[...Array(4).keys()].map(i => (
                    <Option key={i + 1} value={i + 1}>{i + 1}</Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col>
              <Form.Item name="aspect_ratio" label={t('imageEnrichment.aspectRatio')}>
                <Select style={{ width: 100 }}>
                  <Select.OptGroup label="Landscape">
                    <Option value="21:9">21:9</Option>
                    <Option value="16:9">16:9</Option>
                    <Option value="4:3">4:3</Option>
                    <Option value="3:2">3:2</Option>
                  </Select.OptGroup>
                  <Select.OptGroup label="Square">
                    <Option value="1:1">1:1</Option>
                  </Select.OptGroup>
                  <Select.OptGroup label="Portrait">
                    <Option value="9:16">9:16</Option>
                    <Option value="3:4">3:4</Option>
                    <Option value="2:3">2:3</Option>
                  </Select.OptGroup>
                </Select>
              </Form.Item>
            </Col>
            <Col>
              <Form.Item name="resolution" label={t('imageEnrichment.resolutionLabel')}>
                 <Select style={{ width: 80 }}>
                   <Option value="1K">1K</Option>
                   <Option value="2K">2K</Option>
                   <Option value="4K">4K</Option>
                 </Select>
              </Form.Item>
            </Col>
          </Row>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <Upload
              customRequest={({ file, onSuccess }) => {
                handleImageUpload([file]);
                onSuccess("ok");
              }}
              showUploadList={false}
              accept="image/*"
              multiple
              disabled={imageFiles.length >= maxImages}
            >
              <Button icon={<PlusOutlined />} shape="circle" />
            </Upload>
            <Typography.Text type="secondary" style={{ marginLeft: '10px' }}>Max {maxImages} images</Typography.Text>
            {imagePreviews.map((preview, index) => (
              <div key={index} style={{ position: 'relative', marginLeft: '10px' }}>
                <img src={preview} alt={`Preview ${index}`} style={{ maxWidth: '50px', borderRadius: '4px', verticalAlign: 'middle' }} />
                <Button
                  icon={<DeleteOutlined />}
                  size="small"
                  shape="circle"
                  style={{ position: 'absolute', top: '-5px', right: '-5px', zIndex: 1 }}
                  onClick={() => handleRemoveImage(index)}
                />
              </div>
            ))}
            <Form.Item name="prompt" style={{ flex: 1, marginLeft: '10px', marginBottom: 0 }} rules={[{ required: true, message: 'Please enter your requirement' }]}>
              <TextArea
                rows={1}
                placeholder="Write your prompt here..."
                autoSize={{ minRows: 1, maxRows: 6 }}
                onKeyDown={handleKeyDown}
                style={{ height: '54px' }}
              />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} icon={<SendOutlined />} style={{ marginLeft: '10px', height: '54px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <div>{t('imageEnrichment.generate')}</div>
                <div style={{ fontSize: '10px', opacity: 0.8 }}>{shortcutText}</div>
              </div>
            </Button>
          </div>
        </Form>
      </div>
    </div>
  );
};

export default ConversationalImageEnrichment;
