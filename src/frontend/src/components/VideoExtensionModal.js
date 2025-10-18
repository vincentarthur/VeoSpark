import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Row, Col, Button, Typography, Slider, Select, Card, Form, Modal
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import axios from 'axios';
import VideoHistorySelector from './VideoHistorySelector';

const { Title } = Typography;
const { Option } = Select;

const VideoExtensionModal = () => {
  const { t } = useTranslation();
  const [form] = Form.useForm();

  const [models, setModels] = useState([]);
  const [model, setModel] = useState('');
  const [projects, setProjects] = useState([]);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [extendDuration, setExtendDuration] = useState(5);
  const [loading, setLoading] = useState(false);
  const [, setError] = useState(null);
  const [, setGeneratedVideos] = useState([]);
  const [pollingTaskId, setPollingTaskId] = useState(null);
  const [isModalVisible, setIsModalVisible] = useState(false);

  useEffect(() => {
    const fetchModels = async () => {
      try {
        const response = await axios.get('/api/models');
        const fetchedModels = response.data.models || [];
        const veo31Model = fetchedModels.find(m => m.name === 'Veo 3.1 Preview');
        if (veo31Model) {
          setModels([veo31Model]);
          setModel(veo31Model.id);
        }
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

  useEffect(() => {
    if (!pollingTaskId) return;

    const interval = setInterval(async () => {
      try {
        const response = await axios.get(`/api/tasks/${pollingTaskId}`);
        const { status, result, error } = response.data;

        if (status === 'completed') {
          if (result.error) {
            setError(result.error || 'An unexpected error occurred during generation.');
          } else {
            setGeneratedVideos(result.videos || []);
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
    }, 5000);

    return () => clearInterval(interval);
  }, [pollingTaskId]);

  const handleExtendClick = (video) => {
    setSelectedVideo(video);
    setIsModalVisible(false);
  };

  const onFinish = async (values) => {
    setLoading(true);
    setError(null);
    setGeneratedVideos([]);

    try {
      const payload = {
        ...values,
        model: model,
        image_gcs_uri: selectedVideo.gcs_uri,
        generation_mode: 'extend',
      };

      const response = await axios.post('/api/videos/generate', payload);

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

  const handleVideoSelect = (video) => {
    setSelectedVideo(video);
    setIsModalVisible(false);
  };

  return (
    <>
      <Row>
        <Col xs={24} lg={16}>
          <Row gutter={32}>
            <Col xs={24} md={8}>
              <Card>
                <Title level={2}>{t('dashboard.extendVideoTitle')}</Title>
                <Form form={form} layout="vertical" onFinish={onFinish} initialValues={{
                  extend_duration: extendDuration,
                }}>
                  <Form.Item label={t('dashboard.modelLabel')}>
                    <Select value={model} disabled>
                      {models.map((m) => (
                        <Option key={m.id} value={m.id}>{m.name}</Option>
                      ))}
                    </Select>
                  </Form.Item>
                  <Form.Item name="creative_project_id" label={t('dashboard.dedicatedProjectLabel')} rules={[{ required: true, message: 'Please select a project!' }]}>
                    <Select placeholder="Select a project">
                      {projects.map((p) => (
                        <Option key={p.id} value={p.id}>{p.name}</Option>
                      ))}
                    </Select>
                  </Form.Item>
                  <Form.Item label={t('dashboard.selectVideoLabel')}>
                    {selectedVideo ? (
                      <Card
                        size="small"
                        cover={<video src={selectedVideo.signed_url || (selectedVideo.signed_urls && selectedVideo.signed_urls[0])} style={{ maxHeight: 150, objectFit: 'contain' }} controls autoPlay loop muted />}
                        actions={[
                          <Button type="primary" ghost icon={<ReloadOutlined />} onClick={() => setIsModalVisible(true)}>
                            {t('common.change')}
                          </Button>,
                        ]}
                      >
                        {/* <Card.Meta title={selectedVideo.prompt} /> */}
                      </Card>
                    ) : (
                      <Button onClick={() => setIsModalVisible(true)} block>
                        {t('dashboard.selectVideoToExtend')}
                      </Button>
                    )}
                  </Form.Item>
                  <Form.Item name="extend_duration" label={t('dashboard.extendDurationLabel')}>
                    <Slider
                      min={5}
                      max={8}
                      step={1}
                      marks={{ 5: '5s', 8: '8s' }}
                      onChange={setExtendDuration}
                    />
                  </Form.Item>
                  <Form.Item>
                    <Button type="primary" htmlType="submit" loading={loading} block size="large" disabled={!selectedVideo}>
                      {t('dashboard.extendVideo')}
                    </Button>
                  </Form.Item>
                </Form>
              </Card>
            </Col>
            <Col xs={24} md={16}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}>
                {/* The generated videos will be displayed here */}
              </div>
            </Col>
          </Row>
        </Col>
      </Row>
      <Modal
        title={t('dashboard.selectVideoToExtend')}
        open={isModalVisible}
        onCancel={() => setIsModalVisible(false)}
        footer={null}
        width="66%"
      >
        <VideoHistorySelector onVideoSelect={handleVideoSelect} onExtendClick={handleExtendClick} />
      </Modal>
    </>
  );
};

export default VideoExtensionModal;
