import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Row, Col, Button, Input, Typography, Spin, Alert, Upload, Form, List, Select
} from 'antd';
import { PlusOutlined, SendOutlined, DeleteOutlined } from '@ant-design/icons';
import axios from 'axios';
import ImageCard from './ImageCard';

const { Paragraph } = Typography;
const { TextArea } = Input;
const { Option } = Select;

const ConversationalImageEnrichment = ({ user, onUseAsFirstFrame }) => {
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
      } catch (error) {
        console.error("Failed to fetch creative projects:", error);
      }
    };
    fetchModels();
    fetchProjects();
  }, []);

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
          })),
          revisedPrompt: result.revised_prompt,
          raiReasons: result.rai_reasons,
        };
        setConversation(prev => [...prev, newModelMessage]);
        setLoading(false);
        setPollingTaskId(null);
      } else if (status === 'failed') {
        setError(error || 'An unexpected error occurred during generation.');
        setLoading(false);
        setPollingTaskId(null);
      } else {
        // If still processing, poll again
        setTimeout(() => pollTaskStatus(taskId), 5000);
      }
    } catch (err) {
      setError('Failed to get task status.');
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
    const newFiles = [...imageFiles, ...files].slice(0, 3);
    setImageFiles(newFiles);
    const newPreviews = newFiles.map(f => URL.createObjectURL(f));
    setImagePreviews(newPreviews);
  };

  const handleRemoveImage = (index) => {
    const newFiles = [...imageFiles];
    newFiles.splice(index, 1);
    setImageFiles(newFiles);

    const newPreviews = [...imagePreviews];
    newPreviews.splice(index, 1);
    setImagePreviews(newPreviews);
  };

  const handleSubmit = async (values) => {
    if (imageFiles.length === 0 && conversation.length === 0) {
      setError(t('imageEnrichment.noImageError'));
      return;
    }

    const userMessage = {
      type: 'user',
      prompt: values.prompt,
      images: imagePreviews,
    };
    setConversation(prev => [...prev, userMessage]);
    setLoading(true);
    setError(null);
    form.resetFields();
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
        // This part needs backend support to work with GCS paths instead of file uploads
        // For now, we assume the backend can handle a reference to the previous image
        lastModelMessage.images.forEach(image => {
          formData.append('previous_image_gcs_paths', image.gcs_uri);
        });
      }
    }
    formData.append('sub_prompt', values.prompt);
    formData.append('model', 'gemini-2.5-flash-image-preview'); // Hardcoded as per requirement
    formData.append('sample_count', 1);
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
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 380px)', maxWidth: '1024px', margin: '0 auto' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
        <List
          dataSource={conversation}
          renderItem={(item, index) => (
            <List.Item style={{ border: 'none', padding: '10px 0' }}>
              {item.type === 'user' && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%' }}>
                  <div style={{ maxWidth: '60%' }}>
                    {item.images && item.images.map((img, i) => <img key={i} src={img} alt={`User input ${i}`} style={{ maxWidth: '100px', borderRadius: '8px', marginBottom: '8px', marginRight: '8px' }} />)}
                    <Paragraph style={{ background: '#f0f0f0', padding: '10px', borderRadius: '8px', textAlign: 'left' }}>{item.prompt}</Paragraph>
                  </div>
                </div>
              )}
              {item.type === 'model' && (
                <div style={{ display: 'flex', justifyContent: 'flex-start', width: '100%' }}>
                  <Row gutter={[16, 16]} style={{ maxWidth: '60%' }}>
                    {item.images.map((image, imgIndex) => (
                      <Col xs={24} key={`${index}-${imgIndex}`}>
                        <ImageCard image={image} models={models} user={user} onUseAsFirstFrame={onUseAsFirstFrame} />
                      </Col>
                    ))}
                  </Row>
                </div>
              )}
            </List.Item>
          )}
        />
        {loading && <div style={{ textAlign: 'center', padding: '20px' }}><Spin /></div>}
        {error && <Alert message={error} type="error" showIcon style={{ margin: '10px 0' }} />}
      </div>
      <div style={{ padding: '20px', borderTop: '1px solid #f0f0f0' }}>
        <Form form={form} onFinish={handleSubmit}>
          <Form.Item name="creative_project_id" label={t('dashboard.dedicatedProjectLabel')} rules={[{ required: true, message: 'Please select a project!' }]}>
            <Select placeholder="Select a project">
              {projects.map((p) => (
                <Option key={p.id} value={p.id}>{p.name}</Option>
              ))}
            </Select>
          </Form.Item>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <Upload
              customRequest={({ file, onSuccess }) => {
                handleImageUpload([file]);
                onSuccess("ok");
              }}
              showUploadList={false}
              accept="image/*"
              multiple
              disabled={imageFiles.length >= 3}
            >
              <Button icon={<PlusOutlined />} shape="circle" />
            </Upload>
            <Typography.Text type="secondary" style={{ marginLeft: '10px' }}>{t('imageEnrichment.maxImagesTip')}</Typography.Text>
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
              />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} icon={<SendOutlined />} style={{ marginLeft: '10px' }}>
              Generate
            </Button>
          </div>
        </Form>
      </div>
    </div>
  );
};

export default ConversationalImageEnrichment;
