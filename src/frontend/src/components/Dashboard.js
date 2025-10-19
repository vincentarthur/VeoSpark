import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Row, Col, Button, Input, Typography, Slider, Radio, Checkbox,
  Card, Spin, Alert, Select, Upload, Tooltip, Form, Table
} from 'antd';
import { ScissorOutlined, AudioOutlined, UploadOutlined, CloseOutlined, InboxOutlined, ArrowsAltOutlined } from '@ant-design/icons';
import axios from 'axios';
import { useEditingModal } from '../hooks/useEditingModal';
import EditingModal from './EditingModal';
import { useNavigate } from 'react-router-dom';

const { Title, Text } = Typography;
const { TextArea } = Input;
const { Option } = Select;

// A simple component for displaying the generated video
const FilmStripPlayer = ({ video, onEditClick, title, onExtendClick }) => {
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
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
        {onExtendClick && (
          <Tooltip title={t('dashboard.extendVideo')}>
            <Button icon={<ArrowsAltOutlined />} onClick={() => onExtendClick(video)} type="text" style={{ color: 'white' }} />
          </Tooltip>
        )}
        {onEditClick && (
          <>
            <Tooltip title={t('history.actions.clip')}>
              <Button icon={<ScissorOutlined />} onClick={() => onEditClick(video, 'clip')} type="text" style={{ color: 'white' }} />
            </Tooltip>
            <Tooltip title={t('history.actions.dub')}>
              <Button icon={<AudioOutlined />} onClick={() => onEditClick(video, 'dub')} type="text" style={{ color: 'white' }} />
            </Tooltip>
          </>
        )}
      </div>
    </Card>
  )
};

const Dashboard = ({ initialFirstFrame, initialLastFrame }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [form] = Form.useForm();

  const [models, setModels] = useState([]);
  const [model, setModel] = useState('');
  const [projects, setProjects] = useState([]);
  const [prompt] = useState('A dramatic timelapse of a storm cloud over a desert');
  const [generationMode, setGenerationMode] = useState('generate'); // 'generate' or 'extend'
  const [duration] = useState(8);
  const [aspectRatio] = useState('16:9');
  const [resolution] = useState('1080p');
  const [generateAudio] = useState(true);
  const [enhancePrompt, setEnhancePrompt] = useState(true);
  const [sampleCount] = useState(1);

  // State for V3.1 reference images
  const [referenceImageGcsUris, setReferenceImageGcsUris] = useState([]);
  const [referenceImagePreviews, setReferenceImagePreviews] = useState([]);
  const [, setReferenceImageUploading] = useState(false);
  const [referenceImageUploadError, setReferenceImageUploadError] = useState(null);
  const [v31GenerationMode, setV31GenerationMode] = useState('frameControl'); // 'referenceImage' or 'frameControl'


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



  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [generatedVideos, setGeneratedVideos] = useState([]); // Now stores array of video objects
  const [revisedPrompt, setRevisedPrompt] = useState('');
  const [raiReasons, setRaiReasons] = useState([]);
  const [pollingTaskId, setPollingTaskId] = useState(null);
  const promptInputRef = useRef(null);

  const handleExtendClick = (video) => {
    navigate('/', { state: { video, tab: '6' } });
  };

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

  const handleReferenceImageUpload = async (file) => {
    if (referenceImageGcsUris.length >= 3) {
      setReferenceImageUploadError('You can upload at most 3 images.');
      return;
    }
    setReferenceImageUploading(true);
    setReferenceImageUploadError(null);

    const newPreview = URL.createObjectURL(file);
    setReferenceImagePreviews(prev => [...prev, newPreview]);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await axios.post('/api/images/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setReferenceImageGcsUris(prev => [...prev, response.data.gcs_uri]);
    } catch (err) {
      setReferenceImageUploadError(err.response?.data?.detail || 'Upload failed.');
      setReferenceImagePreviews(prev => prev.filter(p => p !== newPreview)); // Remove preview on error
    } finally {
      setReferenceImageUploading(false);
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

  const clearReferenceImage = (index) => {
    setReferenceImageGcsUris(prev => prev.filter((_, i) => i !== index));
    setReferenceImagePreviews(prev => prev.filter((_, i) => i !== index));
  };

  const isV3Model = model.startsWith('veo-3.');
  const isV2GenerateModel = model === 'veo-2.0-generate-001';
  const isVeo2Model = model.startsWith('veo-2.0');
  const isVeo31Model = model.startsWith('veo-3.1');
  const showFirstLastFrameUpload = isVeo2Model || isVeo31Model;
  const selectedModelName = models.find(m => m.id === model)?.name;
  const showReferenceImageOption = selectedModelName === 'Veo 3.1 Preview';

  useEffect(() => {
    if (!showReferenceImageOption && v31GenerationMode === 'referenceImage') {
      setV31GenerationMode('frameControl');
    }
    if (!showReferenceImageOption) {
      setReferenceImageGcsUris([]);
      setReferenceImagePreviews([]);
    }
  }, [model, models, v31GenerationMode, showReferenceImageOption]);

  useEffect(() => {
    if (initialFirstFrame) {
      setImageGcsUri(initialFirstFrame.gcsUri);
      setImagePreview(initialFirstFrame.signedUrl);
    }
    if (initialLastFrame) {
      setFinalFrameGcsUri(initialLastFrame.gcsUri);
      setFinalFramePreview(initialLastFrame.signedUrl);
    }
  }, [initialFirstFrame, initialLastFrame]);

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
  }, [model, isV3Model, isV2GenerateModel, generationMode, aspectRatio]);

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
      let payload = {
        ...values,
        image_gcs_uri: imageGcsUri,
        final_frame_gcs_uri: finalFrameGcsUri,
        reference_image_gcs_uris: null,
      };

      if (isVeo31Model && v31GenerationMode === 'referenceImage') {
        payload.reference_image_gcs_uris = referenceImageGcsUris;
        payload.image_gcs_uri = null;
        payload.final_frame_gcs_uri = null;
      }

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
          }}>
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

            {(() => {
              const handleControlModeChange = (e) => {
                const newMode = e.target.value;
                if (newMode === 'generate') {
                  setGenerationMode('generate');
                  if (isVeo31Model) {
                    setV31GenerationMode('frameControl');
                    // Clear reference image state
                    setReferenceImageGcsUris([]);
                    setReferenceImagePreviews([]);
                  }
                } else if (newMode === 'extend') {
                  setGenerationMode('extend');
                  if (isVeo31Model) {
                    setV31GenerationMode('frameControl');
                    // Clear reference image state
                    setReferenceImageGcsUris([]);
                    setReferenceImagePreviews([]);
                  }
                } else if (newMode === 'referenceImage') {
                  setV31GenerationMode('referenceImage');
                  setGenerationMode('generate'); // Keep it clean
                  // Clear single frame state
                  clearImage();
                  clearFinalFrame();
                }
              };

              let currentControlMode;
              if (isVeo31Model && v31GenerationMode === 'referenceImage') {
                currentControlMode = 'referenceImage';
              } else {
                currentControlMode = generationMode;
              }

              const showControlModes = showFirstLastFrameUpload;

              if (showControlModes) {
                return (
                  <Form.Item label="Control Mode">
                    <Radio.Group value={currentControlMode} onChange={handleControlModeChange}>
                      <Radio.Button value="generate">{t('dashboard.generateWithImage')}</Radio.Button>
                      {isVeo31Model && showReferenceImageOption && <Radio.Button value="referenceImage">Reference Image</Radio.Button>}
                    </Radio.Group>
                  </Form.Item>
                );
              }
              return null;
            })()}

            {isVeo31Model && showReferenceImageOption && v31GenerationMode === 'referenceImage' && (
              <Card size="small" title="Reference Images (Up to 3)">
                <Upload.Dragger
                  customRequest={({ file, onSuccess }) => { onSuccess('ok') }}
                  beforeUpload={handleReferenceImageUpload}
                  showUploadList={false}
                  accept="image/*"
                  multiple
                  disabled={referenceImageGcsUris.length >= 3}
                  height={100}
                >
                  <p className="ant-upload-drag-icon"><InboxOutlined /></p>
                  <p className="ant-upload-text" style={{ fontSize: '12px' }}>Click or drag file(s)</p>
                </Upload.Dragger>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '10px' }}>
                  {referenceImagePreviews.map((preview, index) => (
                    <div key={index} style={{ position: 'relative', textAlign: 'center' }}>
                      <img src={preview} alt={`Preview ${index}`} style={{ width: '100px', height: '100px', objectFit: 'cover', borderRadius: '4px' }} />
                      <Button icon={<CloseOutlined />} onClick={() => clearReferenceImage(index)} size="small" style={{ position: 'absolute', top: 0, right: 0 }} />
                    </div>
                  ))}
                </div>
                {referenceImageUploadError && <Alert message={referenceImageUploadError} type="error" showIcon style={{ marginTop: 8 }} />}
              </Card>
            )}

            {((!showFirstLastFrameUpload || generationMode === 'generate') && (!isVeo31Model || v31GenerationMode === 'frameControl')) && (
              showFirstLastFrameUpload ? (
                <Card size="small" title="Frame Control">
                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Item label={<span style={{ fontSize: '12px' }}>{t('dashboard.uploadFirstFrame')}</span>}>
                        {imagePreview ? (
                          <div style={{ position: 'relative', textAlign: 'center' }}>
                            <img src={imagePreview} alt="Preview" style={{ maxWidth: '100%', maxHeight: '150px', borderRadius: '4px' }} />
                            <Button icon={<CloseOutlined />} onClick={clearImage} size="small" style={{ position: 'absolute', top: 0, right: 0 }} />
                          </div>
                        ) : (
                          <Upload.Dragger
                            customRequest={({ file, onSuccess }) => { onSuccess('ok') }}
                            beforeUpload={handleImageUpload}
                            showUploadList={false}
                            accept="image/*"
                            loading={uploading}
                            height={100}
                          >
                            <p className="ant-upload-drag-icon"><InboxOutlined /></p>
                            <p className="ant-upload-text" style={{ fontSize: '12px' }}>Click or drag file</p>
                          </Upload.Dragger>
                        )}
                        {uploadError && <Alert message={uploadError} type="error" showIcon style={{ marginTop: 8 }} />}
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item label={<span style={{ fontSize: '12px' }}>{t('dashboard.uploadLastFrame')}</span>}>
                        {finalFramePreview ? (
                          <div style={{ position: 'relative', textAlign: 'center' }}>
                            <img src={finalFramePreview} alt="Final Frame Preview" style={{ maxWidth: '100%', maxHeight: '150px', borderRadius: '4px' }} />
                            <Button icon={<CloseOutlined />} onClick={clearFinalFrame} size="small" style={{ position: 'absolute', top: 0, right: 0 }} />
                          </div>
                        ) : (
                          <Upload.Dragger
                            customRequest={({ file, onSuccess }) => { onSuccess('ok') }}
                            beforeUpload={handleFinalFrameUpload}
                            showUploadList={false}
                            accept="image/*"
                            loading={finalFrameUploading}
                            height={100}
                          >
                            <p className="ant-upload-drag-icon"><InboxOutlined /></p>
                            <p className="ant-upload-text" style={{ fontSize: '12px' }}>Click or drag file</p>
                          </Upload.Dragger>
                        )}
                        {finalFrameUploadError && <Alert message={finalFrameUploadError} type="error" showIcon style={{ marginTop: 8 }} />}
                      </Form.Item>
                    </Col>
                  </Row>
                </Card>
              ) : (
                <Form.Item label={t('dashboard.uploadImage')}>
                  <Upload
                    customRequest={({ file, onSuccess }) => { onSuccess('ok') }}
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
              )
            )}


            <Form.Item name="duration" label={t('dashboard.durationLabel')}>
              <Slider
                min={4}
                max={8}
                step={2}
                marks={{ 4: '4s', 6: '6s', 8: '8s' }}
                disabled={(isVeo31Model && v31GenerationMode === 'referenceImage')}
              />
            </Form.Item>

            <Form.Item name="sampleCount" label={t('dashboard.videoCountLabel')}>
              <Slider
                min={1}
                max={4}
                step={1}
                marks={{ 1: '1', 2: '2', 3: '3', 4: '4' }}
                disabled={showFirstLastFrameUpload && generationMode === 'extend'}
              />
            </Form.Item>

            <Form.Item name="aspectRatio" label={t('dashboard.aspectRatioLabel')}>
              <Radio.Group disabled={isVeo31Model && v31GenerationMode === 'referenceImage'}>
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
          {generatedVideos.map((video, index) => (
            <FilmStripPlayer
              key={video.gcs_uri || index}
              video={video}
              onEditClick={openModal}
              onExtendClick={handleExtendClick}
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
