import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import {
  Row, Col, Spin, Alert, Button,
  Card, Pagination, Input, Tabs
} from 'antd';
import {
  FilterOutlined
} from '@ant-design/icons';
import VideoCard from './VideoCard';

const { TabPane } = Tabs;

const VideoHistorySelector = ({ onVideoSelect, onExtendClick }) => {
  const { t } = useTranslation();
  const [history, setHistory] = useState([]);
  const [totalRows, setTotalRows] = useState(0);
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(6);
  const [filters] = useState({
    start_date: null,
    end_date: null,
    status: 'SUCCESS',
    model: '',
    is_edited: false,
  });
  const [searchText, setSearchText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [models, setModels] = useState([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [activeTab, setActiveTab] = useState('search');

  const fetchHistory = useCallback(async (newPage = 1, newRowsPerPage = 6) => {
    setLoading(true);
    setError(null);
    setHasSearched(true);

    const params = {
      ...filters,
      page: newPage,
      page_size: newRowsPerPage,
    };

    try {
      const response = await axios.get('/api/videos/history', { params });
      setHistory(response.data.rows || []);
      setTotalRows(response.data.total_rows || 0);
      setPage(newPage);
      setRowsPerPage(newRowsPerPage);
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not fetch history.');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const fetchSimilarity = useCallback(async (newPage = 1, newRowsPerPage = 6) => {
    if (!searchText) {
      setHistory([]);
      setTotalRows(0);
      return;
    }
    setLoading(true);
    setError(null);
    setHasSearched(true);

    const params = {
      ...filters,
      text: searchText,
      page: newPage,
      page_size: newRowsPerPage,
    };

    try {
      const response = await axios.post('/api/videos/search_similarity_video', params);
      setHistory(response.data.rows || []);
      setTotalRows(response.data.total_rows || 0);
      setPage(newPage);
      setRowsPerPage(newRowsPerPage);
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not fetch similar videos.');
    } finally {
      setLoading(false);
    }
  }, [filters, searchText]);

  useEffect(() => {
    const fetchModels = async () => {
      try {
        const response = await axios.get('/api/models');
        setModels(response.data.models || []);
      } catch (error) {
        console.error("Failed to fetch models:", error);
      }
    };
    fetchModels();
  }, []);

  const renderContent = (showFetchButton = false) => {
    if (loading) return <Spin />;
    if (error) return <Alert message={error} type="error" />;
    return (
      <>
        {showFetchButton && (
          <Button onClick={() => fetchHistory(1, rowsPerPage)} style={{ marginBottom: 16 }}>
            {t('history.fetchAllVideos')}
          </Button>
        )}
        <Row gutter={[16, 16]}>
          {history.length === 0 && hasSearched && <Alert message={t('history.noResults')} type="info" />}
          {history.map((video) => (
            <Col xs={24} sm={12} md={8} key={video.trigger_time}>
              <VideoCard
                video={video}
                models={models}
                user={{}}
                onCardClick={() => onVideoSelect(video)}
                onExtendClick={onExtendClick}
                enableSelection={true}
              />
            </Col>
          ))}
        </Row>
        <Pagination
          current={page}
          pageSize={rowsPerPage}
          total={totalRows}
          onChange={(newPage, newRowsPerPage) => {
            if (activeTab === 'search') {
              fetchSimilarity(newPage, newRowsPerPage);
            } else {
              fetchHistory(newPage, newRowsPerPage);
            }
          }}
          style={{ marginTop: 16, textAlign: 'center' }}
        />
      </>
    );
  };

  return (
    <Card>
      <Tabs activeKey={activeTab} onChange={setActiveTab}>
        <TabPane tab={t('history.search.video')} key="search">
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col flex="auto">
              <Input
                placeholder={t('history.search.placeholder')}
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                onPressEnter={() => fetchSimilarity(1, rowsPerPage)}
              />
            </Col>
            <Col><Button icon={<FilterOutlined />} onClick={() => fetchSimilarity(1, rowsPerPage)}>{t('history.search.button')}</Button></Col>
          </Row>
          {renderContent()}
        </TabPane>
        <TabPane tab={t('history.tabs.allVideos')} key="all">
          {history.length === 0 && !hasSearched ? (
            <Button onClick={() => fetchHistory(1, rowsPerPage)} style={{ marginBottom: 16 }}>
              {t('history.fetchAllVideos')}
            </Button>
          ) : (
            renderContent()
          )}
        </TabPane>
      </Tabs>
    </Card>
  );
};

export default VideoHistorySelector;
