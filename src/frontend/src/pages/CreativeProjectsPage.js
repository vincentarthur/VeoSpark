import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import {
  Typography, Spin, Alert, Button, Input,
  Collapse, Table, Modal, Upload, Card, notification, Row, Col, Tooltip
} from 'antd';
import { DeleteOutlined, UploadOutlined, ReloadOutlined, SettingOutlined } from '@ant-design/icons';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import ManageMembersModal from '../components/ManageMembersModal';
import ProjectConfigModal from '../components/ProjectConfigModal';
import VideoCard from '../components/VideoCard';
import ImageCard from '../components/ImageCard';

const { Title, Text } = Typography;
const { Panel } = Collapse;

const CreativeProjectsPage = ({ user }) => {
  const { t } = useTranslation();
  const [projects, setProjects] = useState([]);
  const [assets, setAssets] = useState({});
  const [assetLoading, setAssetLoading] = useState({});
  const [parsedData, setParsedData] = useState([]);
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [newProjectName, setNewProjectName] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState(null);
  const [activeKeys, setActiveKeys] = useState([]);

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

  useEffect(() => {
    fetchProjects().then(() => {
      if (projects.length > 0) {
        setActiveKeys(projects.map(p => p.id));
      }
    });
  }, []);

  const handleCreateProject = async () => {
    try {
      await axios.post('/api/creative-projects', { name: newProjectName });
      setNewProjectName('');
      fetchProjects();
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not create project.');
    }
  };

  const handleAddMember = async (projectId, email) => {
    try {
      await axios.post(`/api/creative-projects/${projectId}/members`, { email });
      fetchProjects();
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not add member.');
    }
  };

  const handleRemoveMember = async (projectId, memberEmail) => {
    try {
      await axios.delete(`/api/creative-projects/${projectId}/members/${memberEmail}`);
      fetchProjects();
      notification.success({ message: t('creativeProjects.memberRemovedSuccess') });
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not remove member.');
    }
  };

  const openConfirmationDialog = (projectId, memberEmail) => {
    Modal.confirm({
      title: t('creativeProjects.confirmRemoveTitle'),
      content: t('creativeProjects.confirmRemoveDescription', { email: memberEmail }),
      onOk: () => handleRemoveMember(projectId, memberEmail),
    });
  };

  const handleBulkAdd = async (projectId, emails) => {
    const emailArray = emails.split(',').map(email => email.trim()).filter(Boolean);
    if (emailArray.length === 0) return;
    try {
      await axios.post(`/api/creative-projects/${projectId}/members/bulk`, { emails: emailArray });
      fetchProjects();
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not add members.');
    }
  };

  const handleBulkRemove = async (projectId, emails) => {
    const emailArray = emails.split(',').map(email => email.trim()).filter(Boolean);
    if (emailArray.length === 0) return;
    try {
      await axios.delete(`/api/creative-projects/${projectId}/members/bulk`, { data: { emails: emailArray } });
      fetchProjects();
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not remove members.');
    }
  };

  const openModal = (project) => {
    setSelectedProject(project);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setSelectedProject(null);
    setIsModalOpen(false);
  };

  const openConfigModal = (project) => {
    setSelectedProject(project);
    setIsConfigModalOpen(true);
  };

  const closeConfigModal = () => {
    setSelectedProject(null);
    setIsConfigModalOpen(false);
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
        const projectName = row.project || row.Project;
        const memberEmail = row.member || row.Member || row.email || row.Email;
        if (projectName && memberEmail) {
          if (!acc[projectName]) {
            acc[projectName] = { projectName, members: new Set() };
          }
          acc[projectName].members.add(memberEmail);
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
      await axios.post('/api/creative-projects/import', { data: parsedData });
      notification.success({ message: 'Import successful!' });
      setParsedData([]);
      setFileName('');
      fetchProjects();
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not import projects.');
    }
  };

  const columns = [
    { title: t('creativeProjects.memberEmail'), dataIndex: 'email', key: 'email' },
  ];

  if (user?.role === 'APP_ADMIN') {
    columns.push({
      title: t('common.actions'),
      key: 'actions',
      render: (text, record) => (
        <Button icon={<DeleteOutlined />} onClick={() => openConfirmationDialog(record.projectId, record.email)} danger />
      )
    });
  }

  return (
    <Card>
      <Title level={2}>{t('creativeProjects.title')}</Title>
      {loading && <Spin />}
      {error && <Alert message={error} type="error" />}
      
      {user?.role === 'APP_ADMIN' && (
        <Row gutter={16}>
          <Col span={12}>
            <Card style={{ marginBottom: 16 }}>
              <Title level={4}>{t('creativeProjects.createProject')}</Title>
              <Input.Group compact>
                <Input
                  style={{ width: 'calc(100% - 100px)' }}
                  placeholder={t('creativeProjects.projectName')}
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                />
                <Button type="primary" onClick={handleCreateProject}>{t('common.submit')}</Button>
              </Input.Group>
            </Card>
          </Col>
          <Col span={12}>
            <Card style={{ marginBottom: 16 }}>
              <Title level={4}>{t('creativeProjects.importFromFile')}</Title>
              <Text type="secondary">{t('creativeProjects.importHint')}</Text>
              <Upload beforeUpload={handleFileChange} showUploadList={false}>
                <Button icon={<UploadOutlined />} style={{ marginTop: 16 }}>
                  {t('creativeProjects.selectFile')}
                </Button>
              </Upload>
              {fileName && <Text style={{ marginLeft: 8 }}>{fileName}</Text>}
              {parsedData.length > 0 && (
                <div>
                  <Table
                    dataSource={parsedData}
                    columns={[
                      { title: t('creativeProjects.projectName'), dataIndex: 'projectName', key: 'projectName' },
                      { title: t('creativeProjects.membersCount', { count: '' }), dataIndex: 'members', key: 'members', render: members => members.join(', ') }
                    ]}
                    pagination={false}
                    style={{ marginTop: 16 }}
                  />
                  <Button type="primary" onClick={handleImport} style={{ marginTop: 16 }}>
                    {t('creativeProjects.confirmImport')}
                  </Button>
                </div>
              )}
            </Card>
          </Col>
        </Row>
      )}

      <Collapse activeKey={activeKeys} onChange={setActiveKeys}>
        {projects.map((project) => (
          <Panel
            header={`${project.name} (${t('creativeProjects.membersCount', { count: project.members.length })})`}
            key={project.id}
            extra={
              <Tooltip title={t('common.refresh')}>
                <Button
                  icon={<ReloadOutlined />}
                  onClick={(e) => {
                    e.stopPropagation();
                    fetchAssets(project.id);
                  }}
                />
              </Tooltip>
            }
          >
            {user?.role === 'APP_ADMIN' && <Button onClick={() => openModal(project)} style={{ marginBottom: 16 }}>
              {t('creativeProjects.manageMembers')}
            </Button>}
            <Collapse>
              <Panel header={t('creativeProjects.memberList')} key="1">
                <Table
                  dataSource={project.members.map(email => ({ email, projectId: project.id }))}
                  columns={columns}
                  rowKey="email"
                  pagination={{ pageSize: 5 }}
                />
              </Panel>
            </Collapse>
            <Title level={4} style={{ marginTop: 24 }}>{t('creativeProjects.assets')}</Title>
            {assets[project.id] ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
                {assets[project.id].map(asset => (
                  <div key={asset.id} style={{ width: '300px' }}>
                    {asset.type.toLowerCase() === 'video' ? (
                      <VideoCard video={asset} user={user} showAddToProject={false} />
                    ) : asset.type.toLowerCase() === 'image' ? (
                      <ImageCard image={asset} user={user} showAddToProject={false} />
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <Button onClick={() => fetchAssets(project.id)} loading={assetLoading[project.id]}>
                {t('creativeProjects.loadAssets')}
              </Button>
            )}
          </Panel>
        ))}
      </Collapse>

      {selectedProject && (
        <ManageMembersModal
          open={isModalOpen}
          onClose={closeModal}
          group={selectedProject}
          onAddMember={handleAddMember}
          onRemoveMember={handleRemoveMember}
          onBulkAdd={handleBulkAdd}
          onBulkRemove={handleBulkRemove}
        />
      )}
    </Card>
  );

  async function fetchAssets(projectId) {
    setAssetLoading(prev => ({ ...prev, [projectId]: true }));
    try {
      const response = await axios.get(`/api/creative-projects/${projectId}/assets`);
      setAssets(prev => ({ ...prev, [projectId]: response.data }));
    } catch (err) {
      notification.error({ message: 'Could not fetch project assets.' });
    } finally {
      setAssetLoading(prev => ({ ...prev, [projectId]: false }));
    }
  }
};

export default CreativeProjectsPage;
