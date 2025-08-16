import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import {
  Modal, Button, Select, Spin, Alert, notification
} from 'antd';

const { Option } = Select;

const ShareToProjectModal = ({ open, onClose, asset, onComplete }) => {
  const { t } = useTranslation();
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      const fetchProjects = async () => {
        setLoading(true);
        setError(null);
        try {
          const response = await axios.get('/api/creative-projects');
          setProjects(response.data);
        } catch (err) {
          setError(err.response?.data?.detail || 'Could not fetch projects.');
        } finally {
          setLoading(false);
        }
      };
      fetchProjects();
    }
  }, [open]);

  const handleShareToProject = async () => {
    if (!selectedProject) {
      setError('Please select a project.');
      return;
    }
    try {
      await axios.post(`/api/creative-projects/${selectedProject}/assets`, { asset });
      notification.success({ message: 'Asset added to project successfully!' });
      onComplete();
      onClose();
    } catch (err) {
      notification.error({ message: err.response?.data?.detail || 'Could not add asset to project.' });
    }
  };

  return (
    <Modal
      title={t('creativeProjects.addToProject')}
      open={open}
      onOk={handleShareToProject}
      onCancel={onClose}
      footer={[
        <Button key="back" onClick={onClose}>
          {t('common.cancel')}
        </Button>,
        <Button key="submit" type="primary" loading={loading} onClick={handleShareToProject}>
          {t('common.submit')}
        </Button>,
      ]}
    >
      {loading && <Spin />}
      {error && <Alert message={error} type="error" />}
      <Select
        placeholder={t('creativeProjects.selectProject')}
        style={{ width: '100%' }}
        onChange={(value) => setSelectedProject(value)}
        value={selectedProject}
      >
        {projects.map((project) => (
          <Option key={project.id} value={project.id}>{project.name}</Option>
        ))}
      </Select>
    </Modal>
  );
};

export default ShareToProjectModal;
