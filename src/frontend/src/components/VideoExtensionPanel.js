import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Row, Col, Button, Typography, Slider, Select, Card, Spin, Alert, Form, Collapse
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import axios from 'axios';
import VideoHistorySelector from './VideoHistorySelector';

const { Title } = Typography;
const { Option } = Select;

const FilmStripPlayer = ({ video, title }) => {
  const videoUrl = video?.signed_url || (video?.signed_urls && video.signed_urls[0]);
  if (!video || !videoUrl) {
    return null;
  }
  return (
    <Card
      title={title}
      variant={false}
      style={{
        backgroundColor: '#212121',
        color: 'white',
        boxShadow: '0 10px 20px rgba(0,0,0,0.2)',
        display: 'inline-block',
      }}
      bodyStyle={{ padding: 10 }}
      headStyle={{ color: 'white', borderBottom: '1px solid #444' }}
    >
      <video src={videoUrl} width="400" controls autoPlay loop muted style={{ borderRadius: '4px' }} />
    </Card>
  )
};

const VideoExtensionPanel = () => {
  const { t } = useTranslation();
  const [form] = Form.useForm();

  const [models, setModels] = useState([]);
  const [model, setModel] = useState('');
  const [projects, setProjects] = useState([]);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [extendDuration, setExtendDuration] = useState(5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [generatedVideos, setGeneratedVideos] = useState([]);
  const [pollingTaskId, setPollingTaskId] = useState(null);

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

  return (
    <Row gutter={32}>
      <Col xs={24} md={6}>
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
                    <Button type="primary" ghost icon={<ReloadOutlined />} onClick={() => setSelectedVideo(null)}>
                      {t('common.change')}
                    </Button>,
                  ]}
                >
                  {/* <Card.Meta title={selectedVideo.prompt} /> */}
                </Card>
              ) : (
                <Alert message="Select a video to extend" type="info" showIcon />
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
        <Collapse style={{ marginBottom: 16 }}>
          <Collapse.Panel header={t('dashboard.selectVideoToExtend')} key="1">
            <VideoHistorySelector onVideoSelect={setSelectedVideo} />
          </Collapse.Panel>
        </Collapse>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}>
          {loading && <Spin size="large" tip={t('dashboard.generatingStatus')} />}
          {error && <Alert message={error} type="error" showIcon />}
          {generatedVideos.map((video, index) => (
            <FilmStripPlayer
              key={video.gcs_uri || index}
              video={video}
              title={`EXTENDED VIDEO ${index + 1}`}
            />
          ))}
        </div>
      </Col>
    </Row>
  );
};

export default VideoExtensionPanel;
