import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import {
  Typography, Spin, Alert, Button,
  DatePicker, Select, Row, Col, Pagination, Card, Input
} from 'antd';
import { 
  FilterOutlined, ClearOutlined
} from '@ant-design/icons';
import ImageCard from './ImageCard';
import ShareModal from './ShareModal';
import { useShareModal } from '../hooks/useShareModal';

const { Option } = Select;

const ImageHistory = ({
  user, history, models, loading, error, hasFetched, totalRows, page,
  rowsPerPage, fetchHistory, setFilters, clearFilters, filters,
  onUseAsFirstFrame, onUseAsLastFrame, searchText, setSearchText, handleSearch
}) => {
  const { t } = useTranslation();

  const {
    modalOpen: shareModalOpen,
    selectedItem: shareSelectedItem,
    openModal: openShareModal,
    closeModal: closeShareModal,
    handleSubmit: handleShareSubmit,
  } = useShareModal(() => {
    console.log("Item shared successfully");
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

  return (
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
        <Col><Button icon={<FilterOutlined />} onClick={() => fetchHistory(false, 1, rowsPerPage, true)}>{t('history.filters.apply')}</Button></Col>
        <Col><Button icon={<ClearOutlined />} onClick={clearFilters} /></Col>
      </Row>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col flex="auto">
          <Input
            placeholder={t('history.search.similarityPlaceholder')}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onPressEnter={handleSearch}
          />
        </Col>
        <Col>
          <Button type="primary" onClick={handleSearch}>{t('history.search.button')}</Button>
        </Col>
      </Row>

      {loading ? (
        <Spin />
      ) : error ? (
        <Alert message={error} type="error" />
      ) : !hasFetched ? (
        <Typography.Text>{t('history.pressFetch')}</Typography.Text>
      ) : hasFetched && history.length === 0 ? (
        <Typography.Text>{t('history.noResults')}</Typography.Text>
      ) : (
        <>
          <Row gutter={[16, 16]}>
            {history.map((image) => (
              <Col xs={24} sm={12} md={8} key={image.trigger_time}>
                <ImageCard
                  image={image}
                  models={models}
                  user={user}
                  onShareClick={openShareModal}
                  onUseAsFirstFrame={onUseAsFirstFrame}
                  onUseAsLastFrame={onUseAsLastFrame}
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

export default ImageHistory;
