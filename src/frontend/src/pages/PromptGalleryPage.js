import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import {
  Typography, Spin, Alert, Input, Button,
  Table, Modal, Tag, Dropdown, Menu, Card, Row, Col
} from 'antd';
import { PlusOutlined, DeleteOutlined, UnorderedListOutlined, GlobalOutlined } from '@ant-design/icons';

const { Title } = Typography;
const { Search } = Input;

const PromptGalleryPage = ({ user }) => {
  const { t } = useTranslation();
  const [prompts, setPrompts] = useState([]);
  const [totalRows, setTotalRows] = useState(0);
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [newPrompt, setNewPrompt] = useState({ text: '', keywords: '' });
  const [translating, setTranslating] = useState(false);

  const fetchPrompts = useCallback(async (fetchAll = false, newPage = 1, newRowsPerPage = 10) => {
    setLoading(true);
    setError(null);
    try {
      const params = {
        page: newPage,
        page_size: newRowsPerPage
      };
      if (searchTerm && !fetchAll) params.tags = searchTerm;
      const response = await axios.get('/api/prompts', { params });
      setPrompts(response.data.rows);
      setTotalRows(response.data.total);
      setPage(newPage);
      setRowsPerPage(newRowsPerPage);
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not fetch prompts.');
    } finally {
      setLoading(false);
    }
  }, [searchTerm]);

  useEffect(() => {
    // Don't fetch on initial load
  }, []);

  const handleAddPrompt = async () => {
    try {
      await axios.post('/api/prompts', {
        prompt_text: newPrompt.text,
        keywords: newPrompt.keywords.split(',').map(k => k.trim()).filter(Boolean),
      });
      setModalOpen(false);
      setNewPrompt({ text: '', keywords: '' });
      fetchPrompts();
    } catch (err) {
      Alert.error(err.response?.data?.detail || 'Failed to add prompt.');
    }
  };

  const handleTranslate = async (targetLanguage) => {
    if (!newPrompt.text) return;
    setTranslating(true);
    try {
      const response = await axios.post('/api/translate', {
        text: newPrompt.text,
        target_language: targetLanguage,
      });
      setNewPrompt({ ...newPrompt, text: response.data.translated_text });
    } catch (err) {
      Alert.error(err.response?.data?.detail || 'Failed to translate prompt.');
    } finally {
      setTranslating(false);
    }
  };

  const handleDeletePrompt = async (promptId) => {
    Modal.confirm({
      title: t('gallery.confirmDelete'),
      onOk: async () => {
        try {
          await axios.delete(`/api/prompts/${promptId}`);
          fetchPrompts();
        } catch (err) {
          Alert.error(err.response?.data?.detail || 'Failed to delete prompt.');
        }
      }
    });
  };

  const columns = [
    { title: t('gallery.promptText'), dataIndex: 'prompt_text', key: 'prompt_text' },
    {
      title: t('gallery.tags'), dataIndex: 'keywords', key: 'keywords',
      render: keywords => (
        <>
          {keywords?.map(kw => <Tag key={kw}>{kw}</Tag>)}
        </>
      )
    },
    { title: t('gallery.by'), dataIndex: 'created_by_name', key: 'created_by_name' },
    {
      title: 'Actions', key: 'actions',
      render: (text, record) => (
        user?.email === record.created_by_email && (
          <Button icon={<DeleteOutlined />} onClick={() => handleDeletePrompt(record.id)} danger />
        )
      )
    }
  ];

  const translateMenu = (
    <Menu onClick={({ key }) => handleTranslate(key)}>
      <Menu.Item key="English">English</Menu.Item>
      <Menu.Item key="Chinese">Chinese</Menu.Item>
    </Menu>
  );

  return (
    <Card>
      <Title level={2}>{t('nav.gallery')}</Title>
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={16}>
          <Col>
            <Search
              placeholder={t('gallery.tags')}
              onSearch={() => fetchPrompts()}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ width: 200 }}
            />
          </Col>
          <Col>
            <Button icon={<UnorderedListOutlined />} onClick={() => fetchPrompts(true)}>
              {t('gallery.listAll')}
            </Button>
          </Col>
          <Col>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
              {t('gallery.addPrompt')}
            </Button>
          </Col>
        </Row>
      </Card>

      {loading ? <Spin /> : error ? <Alert message={error} type="error" /> : (
        <Table
          columns={columns}
          dataSource={prompts}
          rowKey="id"
          pagination={{
            current: page,
            pageSize: rowsPerPage,
            total: totalRows,
            onChange: (newPage, newRowsPerPage) => fetchPrompts(false, newPage, newRowsPerPage),
          }}
        />
      )}

      <Modal
        title={t('gallery.addPrompt')}
        visible={modalOpen}
        onOk={handleAddPrompt}
        onCancel={() => setModalOpen(false)}
      >
        <Input.TextArea
          rows={4}
          placeholder={t('gallery.promptText')}
          value={newPrompt.text}
          onChange={(e) => setNewPrompt({ ...newPrompt, text: e.target.value })}
          style={{ marginBottom: 16 }}
        />
        <Input
          placeholder={t('gallery.tags')}
          value={newPrompt.keywords}
          onChange={(e) => setNewPrompt({ ...newPrompt, keywords: e.target.value })}
          style={{ marginBottom: 16 }}
        />
        <Dropdown overlay={translateMenu}>
          <Button icon={<GlobalOutlined />} loading={translating}>
            {t('Translate')}
          </Button>
        </Dropdown>
      </Modal>
    </Card>
  );
};

export default PromptGalleryPage;
