import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import {
  Modal, Button, Select, Spin, Alert, notification
} from 'antd';

const { Option } = Select;

const ShareToGroupModal = ({ open, onClose, asset, onComplete }) => {
  const { t } = useTranslation();
  const [groups, setGroups] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      const fetchGroups = async () => {
        setLoading(true);
        setError(null);
        try {
          const response = await axios.get('/api/groups');
          setGroups(response.data);
        } catch (err) {
          setError(err.response?.data?.detail || 'Could not fetch groups.');
        } finally {
          setLoading(false);
        }
      };
      fetchGroups();
    }
  }, [open]);

  const handleShareToGroup = async () => {
    if (!selectedGroup) {
      setError('Please select a group.');
      return;
    }
    try {
      const endpoint = asset.output_video_gcs_paths ? '/api/videos/share' : '/api/images/share';
      await axios.post(endpoint, { video: asset, item: asset, group_id: selectedGroup });
      notification.success({ message: 'Asset shared to group successfully!' });
      onComplete();
      onClose();
    } catch (err) {
      notification.error({ message: err.response?.data?.detail || 'Could not share asset to group.' });
    }
  };

  return (
    <Modal
      title={t('shareModal.title')}
      open={open}
      onOk={handleShareToGroup}
      onCancel={onClose}
      footer={[
        <Button key="back" onClick={onClose}>
          {t('common.cancel')}
        </Button>,
        <Button key="submit" type="primary" loading={loading} onClick={handleShareToGroup}>
          {t('common.submit')}
        </Button>,
      ]}
    >
      {loading && <Spin />}
      {error && <Alert message={error} type="error" />}
      <Select
        placeholder={t('shareModal.selectGroup')}
        style={{ width: '100%' }}
        onChange={(value) => setSelectedGroup(value)}
        value={selectedGroup}
      >
        {groups.map((group) => (
          <Option key={group.id} value={group.id}>{group.name}</Option>
        ))}
      </Select>
    </Modal>
  );
};

export default ShareToGroupModal;
