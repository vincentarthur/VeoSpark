import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import {
  Typography, Spin, Alert, Row, Col, Select, Button, Card, Modal
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import VideoCard from '../components/VideoCard';
import ImageCard from '../components/ImageCard';

const { Title } = Typography;
const { Option } = Select;

const TeamGalleryPage = ({ user, onUseAsFirstFrame }) => {
  const { t } = useTranslation();
  const [groups, setGroups] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchGroups = async () => {
      try {
        const response = await axios.get('/api/groups');
        setGroups(response.data);
        if (response.data.length > 0) {
          setSelectedGroup(response.data[0].id);
        }
      } catch (err) {
        setError(err.response?.data?.detail || 'Could not fetch groups.');
      }
    };
    fetchGroups();
  }, []);

  const fetchItems = async () => {
    if (!selectedGroup) return;
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get(`/api/teamgallery/${selectedGroup}/items`);
      setItems(response.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not fetch shared items.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedGroup) {
        fetchItems();
    }
  }, [selectedGroup]);

  const handleDeleteClick = (item) => {
    Modal.confirm({
      title: t('teamGallery.confirmDeleteTitle'),
      content: t('teamGallery.confirmDeleteDescription'),
      onOk: async () => {
        try {
          await axios.delete(`/api/teamgallery/${item.id}`);
          setItems(items.filter((v) => v.id !== item.id));
        } catch (err) {
          setError(err.response?.data?.detail || 'Could not delete item.');
        }
      }
    });
  };

  return (
    <Card>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col>
          <Title level={2}>{t('teamGallery.title')}</Title>
        </Col>
        <Col>
          <Button
            type="primary"
            icon={<ReloadOutlined />}
            onClick={fetchItems}
            loading={loading}
            disabled={!selectedGroup}
          >
            {t('teamGallery.refresh')}
          </Button>
        </Col>
      </Row>
      
      <Select
        value={selectedGroup}
        style={{ width: '100%', marginBottom: 16 }}
        onChange={setSelectedGroup}
        placeholder={t('teamGallery.selectGroup')}
      >
        {groups.map((group) => (
          <Option key={group.id} value={group.id}>{group.name}</Option>
        ))}
      </Select>

      {loading && <Spin />}
      {error && <Alert message={error} type="error" />}
      
      {!loading && !error && items.length === 0 && (
        <Typography.Text>{t('teamGallery.noItems')}</Typography.Text>
      )}

      {!loading && !error && items.length > 0 && (
        <Row gutter={[16, 16]}>
          {items.map((item) => (
            <Col xs={24} sm={12} md={8} key={item.id}>
              {item.type === 'image' ? (
                <ImageCard image={item} user={user} onShareDelete={handleDeleteClick} onUseAsFirstFrame={onUseAsFirstFrame} />
              ) : (
                <VideoCard video={{...item, signed_urls: [item.signed_url]}} user={user} onShareDelete={handleDeleteClick} />
              )}
            </Col>
          ))}
        </Row>
      )}
    </Card>
  );
};

export default TeamGalleryPage;
