import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Row, Col, Button, Input, Typography, Spin, Alert, Upload, Form, List, Card
} from 'antd';
import { PlusOutlined, SendOutlined, DeleteOutlined, SyncOutlined } from '@ant-design/icons';
import axios from 'axios';

const { Paragraph } = Typography;
const { TextArea } = Input;

const ImagePromptGenerator = ({ user }) => {
  const { t } = useTranslation();
  const [form] = Form.useForm();

  const [conversation, setConversation] = useState([]);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const shortcutText = isMac ? '⌘ + Enter' : 'Alt + Enter';

  const handleImageUpload = (file) => {
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const handleRemoveImage = () => {
    setImageFile(null);
    setImagePreview(null);
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
    setError(null);

    const formData = new FormData();
    formData.append('file', userMessage.file);
    formData.append('prompt', userMessage.prompt);

    try {
      const response = await axios.post('/api/images/generate-prompt', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      const newModelMessage = {
        type: 'model',
        description: response.data.description,
      };
      setConversation(prev => [...prev, newModelMessage]);
    } catch (err) {
      setError(err.response?.data?.detail || 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (values) => {
    if (!imageFile) {
      setError(t('imagePromptGenerator.noImageError'));
      return;
    }

    const userMessage = {
      type: 'user',
      prompt: values.prompt,
      image: imagePreview,
      file: imageFile,
    };
    setConversation(prev => [...prev, userMessage]);
    setLoading(true);
    setError(null);
    form.resetFields(['prompt']);
    setImageFile(null);
    setImagePreview(null);

    const formData = new FormData();
    formData.append('file', imageFile);
    formData.append('prompt', values.prompt);

    try {
      const response = await axios.post('/api/images/generate-prompt', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      const newModelMessage = {
        type: 'model',
        description: response.data.description,
      };
      setConversation(prev => [...prev, newModelMessage]);
    } catch (err) {
      setError(err.response?.data?.detail || 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 280px)' }}>
      <div style={{ padding: '10px 20px 0', textAlign: 'right' }}>
        <Button onClick={handleClearHistory}>
          {t('imagePromptGenerator.clearHistory')}
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
                    title={t('imagePromptGenerator.regenerate', 'Regenerate')}
                  />
                  <div style={{ maxWidth: '60%' }}>
                    {item.image && <img src={item.image} alt="User input" style={{ maxWidth: '100px', borderRadius: '8px', marginBottom: '8px' }} />}
                    <Paragraph style={{ background: '#f0f0f0', padding: '10px', borderRadius: '8px', textAlign: 'left' }}>{item.prompt}</Paragraph>
                  </div>
                </div>
              )}
              {item.type === 'model' && (
                <div style={{ display: 'flex', justifyContent: 'flex-start', width: '100%' }}>
                   <Paragraph style={{ background: '#e6f7ff', padding: '10px', borderRadius: '8px', textAlign: 'left', whiteSpace: 'pre-wrap' }}>{item.description}</Paragraph>
                </div>
              )}
            </List.Item>
          )}
        />
        {loading && (
          <List.Item style={{ border: 'none', padding: '10px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-start', width: '100%' }}>
                <Card style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  <Spin size="large" />
                </Card>
            </div>
          </List.Item>
        )}
        {error && <Alert message={error} type="error" showIcon style={{ margin: '10px 0' }} />}
      </div>
      <div style={{ padding: '20px', borderTop: '1px solid #f0f0f0' }}>
        <Form form={form} onFinish={handleSubmit}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <Upload
              customRequest={({ file, onSuccess }) => {
                handleImageUpload(file);
                onSuccess("ok");
              }}
              showUploadList={false}
              accept="image/*"
              disabled={!!imageFile}
            >
              <Button icon={<PlusOutlined />} shape="circle" />
            </Upload>
            {imagePreview && (
              <div style={{ position: 'relative', marginLeft: '10px' }}>
                <img src={imagePreview} alt="Preview" style={{ maxWidth: '50px', borderRadius: '4px', verticalAlign: 'middle' }} />
                <Button
                  icon={<DeleteOutlined />}
                  size="small"
                  shape="circle"
                  style={{ position: 'absolute', top: '-5px', right: '-5px', zIndex: 1 }}
                  onClick={handleRemoveImage}
                />
              </div>
            )}
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
                <div>Generate</div>
                <div style={{ fontSize: '10px', opacity: 0.8 }}>{shortcutText}</div>
              </div>
            </Button>
          </div>
        </Form>
      </div>
    </div>
  );
};

export default ImagePromptGenerator;
