import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Row, Col, Button, Input, Typography, Slider, Radio, Checkbox,
  Card, Spin, Alert, Select, Upload, Tooltip, Form, Table
} from 'antd';
import { ScissorOutlined, AudioOutlined, UploadOutlined, CloseOutlined } from '@ant-design/icons';
import axios from 'axios';
import { useEditingModal } from '../hooks/useEditingModal';
import EditingModal from './EditingModal';
import CameraMovements from './CameraMovements';

const { Title, Text } = Typography;
const { TextArea } = Input;
const { Option } = Select;

// A simple component for displaying the generated video
const FilmStripPlayer = ({ video, onEditClick, title }) => {
  const { t } = useTranslation();
  if (!video || !video.signed_url) {
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
      <video src={video.signed_url} width="400" controls autoPlay loop muted style={{ borderRadius: '4px' }} />
      {onEditClick && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
          <Tooltip title={t('history.actions.clip')}>
            <Button icon={<ScissorOutlined />} onClick={() => onEditClick(video, 'clip')} type="text" style={{ color: 'white' }} />
          </Tooltip>
          <Tooltip title={t('history.actions.dub')}>
            <Button icon={<AudioOutlined />} onClick={() => onEditClick(video, 'dub')} type="text" style={{ color: 'white' }} />
          </Tooltip>
        </div>
      )}
    </Card>
  )
};

const Dashboard = ({ initialFirstFrame }) => {
  const { t } = useTranslation();
  const [form] = Form.useForm();

  const [models, setModels] = useState([]);
  const [model, setModel] = useState('');
  const [projects, setProjects] = useState([]);
  const [prompt, setPrompt] = useState('A dramatic timelapse of a storm cloud over a desert');
  const [generationMode, setGenerationMode] = useState('generate'); // 'generate' or 'extend'
  const [duration, setDuration] = useState(8);
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [resolution, setResolution] = useState('1080p');
  const [generateAudio, setGenerateAudio] = useState(true);
  const [enhancePrompt, setEnhancePrompt] = useState(true);
  const [sampleCount, setSampleCount] = useState(1);

  // State for image-to-video
  const [imageGcsUri, setImageGcsUri] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);

  // State for final frame image
  const [finalFrameGcsUri, setFinalFrameGcsUri] = useState(null);
  const [finalFramePreview, setFinalFramePreview] = useState(null);
  const [finalFrameUploading, setFinalFrameUploading] = useState(false);
  const [finalFrameUploadError, setFinalFrameUploadError] = useState(null);

  // State for video extension
  const [userVideos, setUserVideos] = useState([]);
  const [selectedVideo, setSelectedVideo] = useState('');
  const [extendDuration, setExtendDuration] = useState(5);
  const [gcsFetchError, setGcsFetchError] = useState(null);
  const [gcsPrefix, setGcsPrefix] = useState('');
  const [isFetchingGcs, setIsFetchingGcs] = useState(false);


  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [generatedVideos, setGeneratedVideos] = useState([]); // Now stores array of video objects
  const [revisedPrompt, setRevisedPrompt] = useState('');
  const [raiReasons, setRaiReasons] = useState([]);
  const [pollingTaskId, setPollingTaskId] = useState(null);
  const promptInputRef = useRef(null);

  const {
    modalOpen,
    selectedVideo: editingVideo,
    modalMode,
    openModal,
    closeModal,
    handleSubmit: handleModalSubmit
  } = useEditingModal((originalVideo, newVideoData) => {
    // onActionComplete: update the specific video in our local state
    setGeneratedVideos(currentVideos =>
      currentVideos.map(v =>
        v.gcs_uri === originalVideo.gcs_uri ? { ...v, ...newVideoData } : v
      )
    );
  });

  const handleMovementClick = (promptText) => {
    const currentPrompt = form.getFieldValue('prompt') || '';
    const newPrompt = `${currentPrompt} ${promptText}`;
    form.setFieldsValue({ prompt: newPrompt });
  };

  const handleImageUpload = async (file) => {
    setUploading(true);
    setUploadError(null);
    setImagePreview(URL.createObjectURL(file)); // Show instant preview

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await axios.post('/api/images/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setImageGcsUri(response.data.gcs_uri);
    } catch (err) {
      setUploadError(err.response?.data?.detail || 'Upload failed.');
      setImagePreview(null); // Clear preview on error
    } finally {
      setUploading(false);
    }
  };

  const handleFinalFrameUpload = async (file) => {
    setFinalFrameUploading(true);
    setFinalFrameUploadError(null);
    setFinalFramePreview(URL.createObjectURL(file)); // Show instant preview

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await axios.post('/api/images/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setFinalFrameGcsUri(response.data.gcs_uri);
    } catch (err) {
      setFinalFrameUploadError(err.response?.data?.detail || 'Upload failed.');
      setFinalFramePreview(null); // Clear preview on error
    } finally {
      setFinalFrameUploading(false);
    }
  };

  const clearImage = () => {
    setImageGcsUri(null);
    setImagePreview(null);
    setUploadError(null);
  };

  const clearFinalFrame = () => {
    setFinalFrameGcsUri(null);
    setFinalFramePreview(null);
    setFinalFrameUploadError(null);
  };

  const isV3Model = model.startsWith('veo-3.');
  const isV2GenerateModel = model === 'veo-2.0-generate-001';
  const isVeo2Model = model.startsWith('veo-2.0');

  useEffect(() => {
    if (initialFirstFrame) {
      setImageGcsUri(initialFirstFrame.gcsUri);
      setImagePreview(initialFirstFrame.signedUrl);
    }
  }, [initialFirstFrame]);

  useEffect(() => {
    const fetchModels = async () => {
      try {
        const response = await axios.get('/api/models');
        const fetchedModels = response.data.models || [];
        setModels(fetchedModels);
        if (fetchedModels.length > 0) {
          setModel(fetchedModels[0].id);
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
    if (isV3Model) {
      setEnhancePrompt(true);
    }
    if (isV2GenerateModel && generationMode === 'extend') {
      const fetchUserVideos = async () => {
        setIsFetchingGcs(true);
        try {
          setGcsFetchError(null);
          const response = await axios.get('/api/gcs/videos', { params: { prefix: gcsPrefix } });
          setUserVideos(response.data.videos || []);
          setGcsPrefix(response.data.prefix);
        } catch (err) {
          setGcsFetchError(err.response?.data?.detail || 'Failed to fetch user videos.');
        } finally {
          setIsFetchingGcs(false);
        }
      };
      fetchUserVideos();
    }
  }, [model, isV3Model, isV2GenerateModel, generationMode, aspectRatio, gcsPrefix]);

  useEffect(() => {
    if (!pollingTaskId) return;

    const interval = setInterval(async () => {
      try {
        const response = await axios.get(`/api/tasks/${pollingTaskId}`);
        const { status, result, error } = response.data;

        if (status === 'completed') {
          // The task itself completed, but the generation might have failed gracefully.
          if (result.error || result.rai_reasons) {
            if (result.rai_reasons) {
              setRaiReasons(result.rai_reasons);
            } else {
              setError(result.error || 'An unexpected error occurred during generation.');
            }
          } else {
            // This is a true success.
            setGeneratedVideos(result.videos || []);
            if (result.revisedPrompt) {
              setRevisedPrompt(result.revisedPrompt);
            }
          }
          setLoading(false);
          setPollingTaskId(null);
          clearInterval(interval);
        } else if (status === 'failed') {
          // The task itself failed unexpectedly.
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
  }, [pollingTaskId]);

  const onFinish = async (values) => {
    setLoading(true);
    setError(null);
    setGeneratedVideos([]);
    setRevisedPrompt('');
    setRaiReasons([]);

    try {
      const isExtending = isV2GenerateModel && generationMode === 'extend';
      const response = await axios.post('/api/videos/generate', {
        ...values,
        image_gcs_uri: isExtending ? selectedVideo : imageGcsUri,
        final_frame_gcs_uri: finalFrameGcsUri,
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
          <Title level={2}>{t('dashboard.title')}</Title>
          <Form form={form} layout="vertical" onFinish={onFinish} onFinishFailed={(e) => e.preventDefault()} initialValues={{
            model: model,
            prompt: prompt,
            duration: duration,
            aspectRatio: aspectRatio,
            sampleCount: sampleCount,
            generateAudio: generateAudio,
            enhancePrompt: enhancePrompt,
            resolution: resolution,
            extend_duration: extendDuration,
          }} action="#/">
            <Form.Item name="model" label={t('dashboard.modelLabel')} rules={[{ required: true }]}>
              <Select onChange={setModel}>
                {models.map((m) => (
                  <Option key={m.id} value={m.id}>{m.name}</Option>
                ))}
              </Select>
            </Form.Item>
            <Form.Item name="prompt" label={t('dashboard.promptLabel')} rules={[{ required: true }]}>
              <TextArea rows={4} ref={promptInputRef} />
            </Form.Item>
            <Form.Item name="creative_project_id" label={t('dashboard.dedicatedProjectLabel')} rules={[{ required: true, message: 'Please select a project!' }]}>
              <Select placeholder="Select a project">
                {projects.map((p) => (
                  <Option key={p.id} value={p.id}>{p.name}</Option>
                ))}
              </Select>
            </Form.Item>

            <CameraMovements onMovementClick={handleMovementClick} />

            {isV2GenerateModel && (
              <Form.Item>
                <Radio.Group value={generationMode} onChange={(e) => setGenerationMode(e.target.value)}>
                  <Radio.Button value="generate">{t('dashboard.generateWithImage')}</Radio.Button>
                  <Radio.Button value="extend">{t('dashboard.extendVideo')}</Radio.Button>
                </Radio.Group>
              </Form.Item>
            )}

            {(!isV2GenerateModel || generationMode === 'generate') && (
              <>
                <Form.Item label={isV2GenerateModel ? t('dashboard.uploadFirstFrame') : t('dashboard.uploadImage')}>
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
                      <Button icon={<UploadOutlined />} loading={uploading}>
                        {t('dashboard.uploadImage')}
                      </Button>
                    )}
                  </Upload>
                  {uploadError && <Alert message={uploadError} type="error" showIcon />}
                </Form.Item>

                {isV2GenerateModel && (
                  <Form.Item label={t('dashboard.uploadLastFrame')}>
                    <Upload
                      beforeUpload={handleFinalFrameUpload}
                      showUploadList={false}
                      accept="image/*"
                    >
                      {finalFramePreview ? (
                        <div style={{ position: 'relative' }}>
                          <img src={finalFramePreview} alt="Final Frame Preview" style={{ maxWidth: '100%', maxHeight: '150px', borderRadius: '4px' }} />
                          <Button icon={<CloseOutlined />} onClick={clearFinalFrame} size="small" style={{ position: 'absolute', top: 0, right: 0 }} />
                        </div>
                      ) : (
                        <Button icon={<UploadOutlined />} loading={finalFrameUploading}>
                          {t('dashboard.uploadLastFrame')}
                        </Button>
                      )}
                    </Upload>
                    {finalFrameUploadError && <Alert message={finalFrameUploadError} type="error" showIcon />}
                  </Form.Item>
                )}
              </>
            )}

            {isV2GenerateModel && generationMode === 'extend' && (
              <Card title={t('dashboard.extendVideoTitle')} size="small">
                <Form.Item label={t('dashboard.selectVideoLabel')}>
                  <Select
                    value={selectedVideo}
                    onChange={setSelectedVideo}
                    loading={isFetchingGcs}
                  >
                    {userVideos.map((video) => (
                      <Option key={video.gcs_uri} value={video.gcs_uri}>{video.name}</Option>
                    ))}
                  </Select>
                  {gcsFetchError && <Alert message={gcsFetchError} type="error" showIcon />}
                </Form.Item>
                <Form.Item name="extend_duration" label={t('dashboard.extendDurationLabel')}>
                  <Slider
                    min={5}
                    max={8}
                    step={1}
                    marks={{ 5: '5s', 8: '8s' }}
                  />
                </Form.Item>
              </Card>
            )}

            <Form.Item name="duration" label={t('dashboard.durationLabel')}>
              <Slider
                min={4}
                max={8}
                step={2}
                marks={{ 4: '4s', 6: '6s', 8: '8s' }}
                disabled={(isV2GenerateModel && generationMode === 'extend')}
              />
            </Form.Item>

            <Form.Item name="sampleCount" label={t('dashboard.videoCountLabel')}>
              <Slider
                min={1}
                max={2}
                step={1}
                marks={{ 1: '1', 2: '2' }}
                disabled={isV2GenerateModel && generationMode === 'extend'}
              />
            </Form.Item>

            <Form.Item name="aspectRatio" label={t('dashboard.aspectRatioLabel')}>
              <Radio.Group>
                <Radio.Button value="16:9">16:9</Radio.Button>
                <Radio.Button value="9:16">9:16</Radio.Button>
              </Radio.Group>
            </Form.Item>

            {isV3Model && (
              <Form.Item name="resolution" label={t('dashboard.resolutionLabel')}>
                <Select>
                  <Option value="720p">720p</Option>
                  <Option value="1080p">1080p</Option>
                </Select>
              </Form.Item>
            )}

            {(isV3Model || isVeo2Model) && (
              <Card size="small" title={isV3Model ? t('dashboard.v3options') : t('dashboard.v2options')}>
                {isV3Model && (
                  <Form.Item name="generateAudio" valuePropName="checked">
                    <Checkbox>{t('dashboard.generateAudio')}</Checkbox>
                  </Form.Item>
                )}
                <Form.Item name="enhancePrompt" valuePropName="checked">
                  <Checkbox disabled={isV3Model}>
                    {isV3Model ? t('dashboard.enhancePromptWithHint') : t('dashboard.enhancePrompt')}
                  </Checkbox>
                </Form.Item>
              </Card>
            )}

            <Form.Item>
              <Button type="primary" htmlType="submit" loading={loading} block size="large">
                {t('dashboard.generateButton')}
              </Button>
            </Form.Item>
          </Form>
        </Card>
      </Col>
      <Col xs={24} md={16}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}>
          {loading && <Spin size="large" tip={t('dashboard.generatingStatus')} />}
          {error && <Alert message={error} type="error" showIcon />}
          {raiReasons && raiReasons.length > 0 && (
            <Alert
              message={t('dashboard.raiFilterTitle')}
              description={
                <Table
                  dataSource={raiReasons}
                  columns={[
                    { title: t('dashboard.raiFilterErrorCode'), dataIndex: 'code', key: 'code' },
                    { title: t('dashboard.raiFilterCategory'), dataIndex: 'category', key: 'category' },
                    { title: t('dashboard.raiFilterDescription'), dataIndex: 'description', key: 'description' },
                    { title: t('dashboard.raiFilterFilteredContent'), dataIndex: 'filtered', key: 'filtered' },
                  ]}
                  pagination={false}
                  size="small"
                  rowKey="code"
                />
              }
              type="warning"
              showIcon
              style={{ width: '100%' }}
            />
          )}
          {revisedPrompt && (
            <Alert
              message={<Text strong>Enhanced Prompt</Text>}
              description={<Text italic>"{revisedPrompt}"</Text>}
              type="success"
              showIcon
              style={{ width: '100%' }}
            />
          )}
          {isV2GenerateModel && generationMode === 'extend' && selectedVideo && (
            <FilmStripPlayer
              title="EXTENDED VIDEO"
              video={userVideos.find(v => v.gcs_uri === selectedVideo)}
            />
          )}
          {generatedVideos.map((video, index) => (
            <FilmStripPlayer
              key={video.gcs_uri || index}
              video={video}
              onEditClick={openModal}
              title={`PREVIEW VIDEO ${index + 1}`}
            />
          ))}
        </div>
      </Col>
      {editingVideo && (
        <EditingModal
          open={modalOpen}
          onClose={closeModal}
          onSubmit={handleModalSubmit}
          video={editingVideo}
          mode={modalMode}
        />
      )}
    </Row>
  );
};
export default Dashboard;
