import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import {
  Typography, Spin, Alert, Button, Input,
  Collapse, Table, Modal, Upload, Card, notification
} from 'antd';
import { DeleteOutlined, UploadOutlined } from '@ant-design/icons';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import ManageMembersModal from '../components/ManageMembersModal';

const { Title, Text } = Typography;
const { Panel } = Collapse;

const GroupsPage = () => {
  const { t } = useTranslation();
  const [groups, setGroups] = useState([]);
  const [parsedData, setParsedData] = useState([]);
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState(null);

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

  useEffect(() => {
    fetchGroups();
  }, []);

  const handleCreateGroup = async () => {
    try {
      await axios.post('/api/groups', { name: newGroupName });
      setNewGroupName('');
      fetchGroups();
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not create group.');
    }
  };

  const handleAddMember = async (groupId, email) => {
    try {
      await axios.post(`/api/groups/${groupId}/members`, { email });
      fetchGroups();
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not add member.');
    }
  };

  const handleRemoveMember = async (groupId, memberEmail) => {
    try {
      await axios.delete(`/api/groups/${groupId}/members/${memberEmail}`);
      fetchGroups();
      notification.success({ message: t('groups.memberRemovedSuccess') });
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not remove member.');
    }
  };

  const openConfirmationDialog = (groupId, memberEmail) => {
    Modal.confirm({
      title: t('groups.confirmRemoveTitle'),
      content: t('groups.confirmRemoveDescription', { email: memberEmail }),
      onOk: () => handleRemoveMember(groupId, memberEmail),
    });
  };

  const handleBulkAdd = async (groupId, emails) => {
    const emailArray = emails.split(',').map(email => email.trim()).filter(Boolean);
    if (emailArray.length === 0) return;
    try {
      await axios.post(`/api/groups/${groupId}/members/bulk`, { emails: emailArray });
      fetchGroups();
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not add members.');
    }
  };

  const handleBulkRemove = async (groupId, emails) => {
    const emailArray = emails.split(',').map(email => email.trim()).filter(Boolean);
    if (emailArray.length === 0) return;
    try {
      await axios.delete(`/api/groups/${groupId}/members/bulk`, { data: { emails: emailArray } });
      fetchGroups();
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not remove members.');
    }
  };

  const openModal = (group) => {
    setSelectedGroup(group);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setSelectedGroup(null);
    setIsModalOpen(false);
  };

  const handleFileChange = (file) => {
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = e.target.result;
      let parsed;
      if (file.name.endsWith('.csv')) {
        parsed = Papa.parse(data, { header: true }).data;
      } else {
        const workbook = XLSX.read(data, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        parsed = XLSX.utils.sheet_to_json(worksheet);
      }
      
      const groupedData = parsed.reduce((acc, row) => {
        const groupName = row.group || row.Group;
        const memberEmail = row.member || row.Member || row.email || row.Email;
        if (groupName && memberEmail) {
          if (!acc[groupName]) {
            acc[groupName] = { groupName, members: new Set() };
          }
          acc[groupName].members.add(memberEmail);
        }
        return acc;
      }, {});

      const finalData = Object.values(groupedData).map(g => ({ ...g, members: Array.from(g.members) }));
      setParsedData(finalData);
    };

    if (file.name.endsWith('.csv')) {
        reader.readAsText(file);
    } else {
        reader.readAsBinaryString(file);
    }
    return false; // Prevent upload
  };

  const handleImport = async () => {
    if (parsedData.length === 0) return;
    try {
      await axios.post('/api/groups/import', { data: parsedData });
      notification.success({ message: 'Import successful!' });
      setParsedData([]);
      setFileName('');
      fetchGroups();
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not import groups.');
    }
  };

  const columns = [
    { title: t('groups.memberEmail'), dataIndex: 'email', key: 'email' },
    {
      title: t('common.actions'),
      key: 'actions',
      render: (text, record) => (
        <Button icon={<DeleteOutlined />} onClick={() => openConfirmationDialog(record.groupId, record.email)} danger />
      )
    }
  ];

  return (
    <Card>
      <Title level={2}>{t('groups.title')}</Title>
      {loading && <Spin />}
      {error && <Alert message={error} type="error" />}
      
      <Card style={{ marginBottom: 16 }}>
        <Title level={4}>{t('groups.createGroup')}</Title>
        <Input.Group compact>
          <Input
            style={{ width: 'calc(100% - 100px)' }}
            placeholder={t('groups.groupName')}
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
          />
          <Button type="primary" onClick={handleCreateGroup}>{t('common.submit')}</Button>
        </Input.Group>
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <Title level={4}>{t('groups.importFromFile')}</Title>
        <Text type="secondary">{t('groups.importHint')}</Text>
        <Upload beforeUpload={handleFileChange} showUploadList={false}>
          <Button icon={<UploadOutlined />} style={{ marginTop: 16 }}>
            {t('groups.selectFile')}
          </Button>
        </Upload>
        {fileName && <Text style={{ marginLeft: 8 }}>{fileName}</Text>}
        {parsedData.length > 0 && (
          <div>
            <Table
              dataSource={parsedData}
              columns={[
                { title: t('groups.groupName'), dataIndex: 'groupName', key: 'groupName' },
                { title: t('groups.membersCount', { count: '' }), dataIndex: 'members', key: 'members', render: members => members.join(', ') }
              ]}
              pagination={false}
              style={{ marginTop: 16 }}
            />
            <Button type="primary" onClick={handleImport} style={{ marginTop: 16 }}>
              {t('groups.confirmImport')}
            </Button>
          </div>
        )}
      </Card>

      <Collapse accordion>
        {groups.map((group) => (
          <Panel header={`${group.name} (${t('groups.membersCount', { count: group.members.length })})`} key={group.id}>
            <Button onClick={() => openModal(group)} style={{ marginBottom: 16 }}>
              {t('groups.manageMembers')}
            </Button>
            <Table
              dataSource={group.members.map(email => ({ email, groupId: group.id }))}
              columns={columns}
              rowKey="email"
              pagination={{ pageSize: 5 }}
            />
          </Panel>
        ))}
      </Collapse>

      {selectedGroup && (
        <ManageMembersModal
          open={isModalOpen}
          onClose={closeModal}
          group={selectedGroup}
          onAddMember={handleAddMember}
          onRemoveMember={handleRemoveMember}
          onBulkAdd={handleBulkAdd}
          onBulkRemove={handleBulkRemove}
        />
      )}
    </Card>
  );
};

export default GroupsPage;
