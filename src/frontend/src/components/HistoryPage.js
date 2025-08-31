import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import {
  Row, Col, Typography, Spin, Alert, Button,
  DatePicker, Select, Checkbox, Card, Pagination, Tabs
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

const { Title } = Typography;
const { Option } = Select;
const { TabPane } = Tabs;

const HistoryPage = ({ user, onUseAsFirstFrame }) => {
  const { t } = useTranslation();
  const [history, setHistory] = useState([]);
  const [activeTab, setActiveTab] = useState("video");
  const [hasFetched, setHasFetched] = useState(false);
  const [, setConfig] = useState({ enable_upscale: false });
  const [totalRows, setTotalRows] = useState(0);
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [models, setModels] = useState([]);

  const [filters, setFilters] = useState({
    start_date: null,
    end_date: null,
    status: '',
    model: '',
    is_edited: false,
    only_success: false,
  });

  const handleFilterChange = (name, value) => {
    setFilters(prev => ({ ...prev, [name]: value }));
  };

  const handleDateChange = (dates) => {
    if (dates) {
      setFilters(prev => ({
        ...prev,
        start_date: dates[0].format('YYYY-MM-DD'),
        end_date: dates[1].format('YYYY-MM-DD'),
      }));
    } else {
      setFilters(prev => ({ ...prev, start_date: null, end_date: null }));
    }
  };

  const clearFilters = () => {
    setFilters({
      start_date: null,
      end_date: null,
      status: '',
      model: '',
      is_edited: false,
      only_success: false,
    });
    fetchHistory(true);
  };

  const { 
    modalOpen, 
    selectedVideo, 
    modalMode, 
    openModal, 
    closeModal, 
    handleSubmit 
  } = useEditingModal(() => {
    fetchHistory();
  });


  const {
    modalOpen: shareModalOpen,
    selectedItem: shareSelectedItem,
    openModal: openShareModal,
    closeModal: closeShareModal,
    handleSubmit: handleShareSubmit,
  } = useShareModal(() => {});

  const fetchHistory = async (isCleared = false, newPage = 1, newRowsPerPage = 10) => {
    setLoading(true);
    setError(null);
    setHasFetched(true);

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
      setHistory(response.data.rows);
      setTotalRows(response.data.total);
      setPage(newPage);
      setRowsPerPage(newRowsPerPage);
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not fetch history.');
      setHistory([]);
    } finally {
      setLoading(false);
    }
  };

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
    // fetchHistory();
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
            onClick={() => fetchHistory()}
            loading={loading}
          >
            {t('history.fetchButton')}
          </Button>
        </Col>
      </Row>

      <Tabs activeKey={activeTab} onChange={(key) => {
        setActiveTab(key);
        setHistory([]);
        setHasFetched(false);
      }}>
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
              <Col><Button icon={<FilterOutlined />} onClick={() => fetchHistory()}>{t('history.filters.apply')}</Button></Col>
              <Col><Button icon={<ClearOutlined />} onClick={clearFilters} /></Col>
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
                      />
                    </Col>
                  ))}
                </Row>
                <Pagination
                  current={page}
                  pageSize={rowsPerPage}
                  total={totalRows}
                  onChange={(newPage, newRowsPerPage) => fetchHistory(false, newPage, newRowsPerPage)}
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
            setFilters={setFilters}
            clearFilters={clearFilters}
            filters={filters}
            onUseAsFirstFrame={onUseAsFirstFrame}
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
            setFilters={setFilters}
            clearFilters={clearFilters}
            filters={filters}
            onUseAsFirstFrame={onUseAsFirstFrame}
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
