import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import {
  Row, Col, Typography, Spin, Alert, Button,
  DatePicker, Select, Checkbox, Card, Pagination, Tabs, Input
} from 'antd';
import { 
  ReloadOutlined, FilterOutlined, ClearOutlined
} from '@ant-design/icons';
import EditingModal from './EditingModal';
import { useEditingModal } from '../hooks/useEditingModal';
import VideoCard from './VideoCard';
import ShareModal from './ShareModal';
import { useShareModal } from '../hooks/useShareModal';
import ImageHistory from './ImageHistory';
import ImageEnrichmentHistory from './ImageEnrichmentHistory';
import { useHistoryState, useHistoryDispatch } from '../contexts/HistoryContext';
import { useNavigate } from 'react-router-dom';

const { Title } = Typography;
const { Option } = Select;
const { TabPane } = Tabs;

const HistoryPage = ({ user, onUseAsFirstFrame, onUseAsLastFrame }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("video");
  const historyState = useHistoryState();
  const historyDispatch = useHistoryDispatch();

  const { history, totalRows, page, rowsPerPage, filters, searchText, hasFetched, cache } = historyState[activeTab];

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [models, setModels] = useState([]);
  const [, setConfig] = useState({ enable_upscale: false });

  const handleFilterChange = (name, value) => {
    historyDispatch({
      type: 'SET_FILTERS',
      payload: { tab: activeTab, filters: { ...filters, [name]: value } },
    });
  };

  const handleDateChange = (dates) => {
    if (dates) {
      historyDispatch({
        type: 'SET_FILTERS',
        payload: {
          tab: activeTab,
          filters: {
            ...filters,
            start_date: dates[0].format('YYYY-MM-DD'),
            end_date: dates[1].format('YYYY-MM-DD'),
          },
        },
      });
    } else {
      historyDispatch({
        type: 'SET_FILTERS',
        payload: {
          tab: activeTab,
          filters: { ...filters, start_date: null, end_date: null },
        },
      });
    }
  };

  const clearFilters = () => {
    historyDispatch({
      type: 'SET_FILTERS',
      payload: {
        tab: activeTab,
        filters: {
          start_date: null,
          end_date: null,
          status: '',
          model: '',
          is_edited: false,
          only_success: false,
        },
      },
    });
    fetchHistory(true, 1, rowsPerPage, true);
  };

  const handleExtendClick = (video) => {
    navigate('/', { state: { video, tab: 'infinite-video' } });
  };

  const {
    modalOpen,
    selectedVideo,
    modalMode,
    openModal,
    closeModal,
    handleSubmit,
  } = useEditingModal(() => {
    fetchHistory(false, page, rowsPerPage, true);
  });


  const {
    modalOpen: shareModalOpen,
    selectedItem: shareSelectedItem,
    openModal: openShareModal,
    closeModal: closeShareModal,
    handleSubmit: handleShareSubmit,
  } = useShareModal(() => {});

  const search_similarity_video = async (text) => {
    setLoading(true);
    setError(null);
    historyDispatch({ type: 'CLEAR_CACHE', payload: { tab: 'video' } });
    try {
      const response = await axios.post('/api/videos/search_similarity_video', { text });
      historyDispatch({
        type: 'SET_DATA',
        payload: { tab: 'video', data: response.data, page: 1, rowsPerPage },
      });
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not fetch similar videos.');
    } finally {
      setLoading(false);
    }
  };

  const search_similarity_image = async (text) => {
    setLoading(true);
    setError(null);
    historyDispatch({ type: 'CLEAR_CACHE', payload: { tab: 'image' } });
    try {
      const response = await axios.post('/api/images/search_similarity_image', { text });
      historyDispatch({
        type: 'SET_DATA',
        payload: { tab: 'image', data: response.data, page: 1, rowsPerPage },
      });
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not fetch similar images.');
    } finally {
      setLoading(false);
    }
  };

  const search_similarity_image_enrich = async (text) => {
    setLoading(true);
    setError(null);
    historyDispatch({ type: 'CLEAR_CACHE', payload: { tab: 'image-enrichment' } });
    try {
      const response = await axios.post('/api/images/search_similarity_image_enrich', { text });
      historyDispatch({
        type: 'SET_DATA',
        payload: { tab: 'image-enrichment', data: response.data, page: 1, rowsPerPage },
      });
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not fetch similar image enrichments.');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    historyDispatch({ type: 'CLEAR_CACHE', payload: { tab: activeTab } });
    if (activeTab === 'video') {
      await search_similarity_video(searchText);
    } else if (activeTab === 'image') {
      await search_similarity_image(searchText);
    } else if (activeTab === 'image-enrichment') {
      await search_similarity_image_enrich(searchText);
    }
  };

  const fetchHistory = useCallback(async (isCleared = false, newPage = 1, newRowsPerPage = 10, forceRefresh = false) => {
    const cacheKey = `${activeTab}-${JSON.stringify(filters)}-${newPage}-${newRowsPerPage}`;
    if (!forceRefresh && cache[cacheKey]) {
      const data = cache[cacheKey];
      historyDispatch({ type: 'SET_DATA', payload: { tab: activeTab, data, page: newPage, rowsPerPage: newRowsPerPage } });
      return;
    }

    setLoading(true);
    setError(null);

    const activeFilters = isCleared ? {} : Object.entries(filters).reduce((acc, [key, value]) => {
      if (value) {
        acc[key] = value;
      }
      return acc;
    }, {});

    if (filters.only_success) {
      activeFilters.status = 'SUCCESS';
    }

    let endpoint;
    if (activeTab === 'video') {
      endpoint = '/api/videos/history';
    } else if (activeTab === 'image') {
      endpoint = '/api/images/history';
    } else {
      endpoint = '/api/images/enrichment-history';
    }

    try {
      const response = await axios.get(endpoint, {
        params: {
          ...activeFilters,
          page: newPage,
          page_size: newRowsPerPage
        }
      });
      const data = response.data;
      historyDispatch({ type: 'SET_DATA', payload: { tab: activeTab, data, page: newPage, rowsPerPage: newRowsPerPage } });
      historyDispatch({ type: 'SET_CACHE', payload: { tab: activeTab, cacheKey, data } });
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not fetch history.');
    } finally {
      setLoading(false);
    }
  }, [activeTab, filters, cache, historyDispatch]);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await axios.get('/api/config');
        setConfig(response.data);
      } catch (error) {
        console.error("Failed to fetch config", error);
      }
    };
    const fetchModels = async () => {
      try {
        let models_endpoint;
        if (activeTab === 'video') {
          models_endpoint = '/api/models';
        } else if (activeTab === 'image') {
          models_endpoint = '/api/image-models';
        } else {
          models_endpoint = '/api/image-enrichment-models';
        }
        const response = await axios.get(models_endpoint);
        setModels(response.data.models || []);
      } catch (error) {
        console.error("Failed to fetch models:", error);
      }
    };
    fetchConfig();
    fetchModels();
  }, [activeTab]);

  return (
    <Card>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col>
          <Title level={2}>{t('history.title')}</Title>
        </Col>
        <Col>
          <Button
            type="primary"
            icon={<ReloadOutlined />}
            onClick={() => fetchHistory(false, page, rowsPerPage, true)}
            loading={loading}
          >
            {t('history.fetchButton')}
          </Button>
        </Col>
      </Row>

      <Tabs activeKey={activeTab} onChange={setActiveTab}>
        <TabPane tab={t('history.tabs.videoHistory')} key="video">
          <Card>
            <Row gutter={16} style={{ marginBottom: 16 }}>
              <Col><DatePicker.RangePicker onChange={handleDateChange} /></Col>
              <Col>
                <Select placeholder={t('history.filters.status')} style={{ width: 120 }} onChange={(value) => handleFilterChange('status', value)}>
                  <Option value="">{t('history.filters.all')}</Option>
                  <Option value="SUCCESS">Success</Option>
                  <Option value="FAILURE">Failure</Option>
                </Select>
              </Col>
              <Col>
                <Select placeholder={t('history.filters.model')} style={{ width: 120 }} onChange={(value) => handleFilterChange('model', value)}>
                  <Option value="">{t('history.filters.all')}</Option>
                  {models.map((m) => (
                    <Option key={m.id} value={m.id}>{m.name}</Option>
                  ))}
                </Select>
              </Col>
              <Col><Checkbox onChange={(e) => handleFilterChange('is_edited', e.target.checked)}>{t('history.filters.editedOnly')}</Checkbox></Col>
              <Col><Checkbox onChange={(e) => handleFilterChange('only_success', e.target.checked)}>{t('history.filters.onlySuccess')}</Checkbox></Col>
              <Col><Button icon={<FilterOutlined />} onClick={() => fetchHistory(false, 1, rowsPerPage, true)}>{t('history.filters.apply')}</Button></Col>
              <Col><Button icon={<ClearOutlined />} onClick={clearFilters} /></Col>
            </Row>
            <Row gutter={16} style={{ marginBottom: 16 }}>
              <Col flex="auto">
                <Input
                  placeholder={t('history.search.similarityPlaceholder')}
                  value={searchText}
                  onChange={(e) => historyDispatch({ type: 'SET_SEARCH_TEXT', payload: { tab: activeTab, searchText: e.target.value } })}
                />
              </Col>
              <Col>
                <Button type="primary" onClick={handleSearch}>{t('history.search.button')}</Button>
              </Col>
            </Row>
            {loading ? <Spin /> : error ? <Alert message={error} type="error" /> : (
              <>
                <Row gutter={[16, 16]}>
                  {history.map((video) => (
                    <Col xs={24} sm={12} md={8} key={video.trigger_time}>
                      <VideoCard
                        video={video}
                        models={models}
                        user={user}
                        onEditClick={openModal}
                        onShareClick={openShareModal}
                        onExtendClick={handleExtendClick}
                      />
                    </Col>
                  ))}
                </Row>
                <Pagination
                  current={page}
                  pageSize={rowsPerPage}
                  total={totalRows}
                  onChange={(newPage, newRowsPerPage) => {
                    historyDispatch({ type: 'SET_PAGE', payload: { tab: activeTab, page: newPage, rowsPerPage: newRowsPerPage } });
                    fetchHistory(false, newPage, newRowsPerPage);
                  }}
                  style={{ marginTop: 16, textAlign: 'center' }}
                />
              </>
            )}
          </Card>
        </TabPane>
        <TabPane tab={t('history.tabs.imageHistory')} key="image">
          <ImageHistory
            user={user}
            history={history}
            models={models}
            loading={loading}
            error={error}
            hasFetched={hasFetched}
            totalRows={totalRows}
            page={page}
            rowsPerPage={rowsPerPage}
            fetchHistory={fetchHistory}
            setFilters={(newFilters) => historyDispatch({ type: 'SET_FILTERS', payload: { tab: 'image', filters: newFilters } })}
            clearFilters={clearFilters}
            filters={filters}
            onUseAsFirstFrame={onUseAsFirstFrame}
            onUseAsLastFrame={onUseAsLastFrame}
            searchText={searchText}
            setSearchText={(text) => historyDispatch({ type: 'SET_SEARCH_TEXT', payload: { tab: 'image', searchText: text } })}
            handleSearch={handleSearch}
          />
        </TabPane>
        <TabPane tab={t('history.tabs.imageEnrichmentHistory')} key="image-enrichment">
          <ImageEnrichmentHistory
            user={user}
            history={history}
            models={models}
            loading={loading}
            error={error}
            hasFetched={hasFetched}
            totalRows={totalRows}
            page={page}
            rowsPerPage={rowsPerPage}
            fetchHistory={fetchHistory}
            setFilters={(newFilters) => historyDispatch({ type: 'SET_FILTERS', payload: { tab: 'image-enrichment', filters: newFilters } })}
            clearFilters={clearFilters}
            filters={filters}
            onUseAsFirstFrame={onUseAsFirstFrame}
            onUseAsLastFrame={onUseAsLastFrame}
            searchText={searchText}
            setSearchText={(text) => historyDispatch({ type: 'SET_SEARCH_TEXT', payload: { tab: 'image-enrichment', searchText: text } })}
            handleSearch={handleSearch}
          />
        </TabPane>
      </Tabs>

      {selectedVideo && (
        <EditingModal
          open={modalOpen}
          onClose={closeModal}
          onSubmit={handleSubmit}
          video={selectedVideo}
          mode={modalMode}
        />
      )}


      {shareSelectedItem && (
        <ShareModal
          open={shareModalOpen}
          onClose={closeShareModal}
          onSubmit={handleShareSubmit}
          item={shareSelectedItem}
        />
      )}
    </Card>
  );
};
export default HistoryPage;
