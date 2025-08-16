import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Form, Button, Table, Select, InputNumber, Checkbox, notification } from 'antd';
import axios from 'axios';

const { Option } = Select;

const ProjectCostConfiguration = () => {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchProjectsAndConfigs = async () => {
      setLoading(true);
      try {
        const projectsResponse = await axios.get('/api/creative-projects');
        const projectsData = projectsResponse.data.map(p => ({ ...p, key: p.id, quota: {}, unrestricted: false }));

        const configPromises = projectsData.map(p =>
          axios.get(`/api/creative-projects/${p.id}/config`)
        );
        
        const configResponses = await Promise.all(configPromises);

        const projectsWithConfigs = projectsData.map((project, index) => {
          const config = configResponses[index].data;
          return { ...project, ...config };
        });

        setProjects(projectsWithConfigs);
        form.setFieldsValue({ projects: projectsWithConfigs });

      } catch (error) {
        notification.error({ message: 'Failed to load project configurations.' });
      } finally {
        setLoading(false);
      }
    };

    fetchProjectsAndConfigs();
  }, [form]);

  const handleSave = async () => {
    setLoading(true);
    try {
      const values = await form.validateFields();
      const payload = values.projects.map((p, index) => ({
        ...p,
        project_id: projects[index].id,
      }));
      await axios.post('/api/creative-projects/config/bulk', payload);
      notification.success({ message: 'Configurations saved successfully!' });
    } catch (error) {
      notification.error({ message: 'Failed to save configurations.' });
    } finally {
      setLoading(false);
    }
  };

  const columns = [
    {
      title: t('creativeProjects.projectName'),
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: t('configurations.unrestricted'),
      dataIndex: 'unrestricted',
      key: 'unrestricted',
      render: (text, record, index) => (
        <Form.Item name={['projects', index, 'unrestricted']} valuePropName="checked" noStyle initialValue={text}>
          <Checkbox />
        </Form.Item>
      ),
    },
    {
      title: t('configurations.quotaType'),
      dataIndex: ['quota', 'type'],
      key: 'quota_type',
      render: (text, record, index) => (
        <Form.Item name={['projects', index, 'quota', 'type']} noStyle initialValue={text}>
          <Select style={{ width: 150 }}>
            <Option value="NO_LIMIT">{t('configurations.noLimit')}</Option>
            <Option value="COST_LIMIT">{t('configurations.costLimit')}</Option>
            <Option value="GENERATION_QUANTITY">{t('configurations.generationQuantity')}</Option>
          </Select>
        </Form.Item>
      ),
    },
    {
      title: t('configurations.limit'),
      dataIndex: ['quota', 'limit'],
      key: 'quota_limit',
      render: (text, record, index) => (
        <Form.Item name={['projects', index, 'quota', 'limit']} noStyle initialValue={text}>
          <InputNumber />
        </Form.Item>
      ),
    },
    {
      title: t('configurations.period'),
      dataIndex: ['quota', 'period'],
      key: 'quota_period',
      render: (text, record, index) => (
        <Form.Item name={['projects', index, 'quota', 'period']} noStyle initialValue={text}>
          <Select style={{ width: 120 }}>
            <Option value="daily">{t('configurations.daily')}</Option>
            <Option value="weekly">{t('configurations.weekly')}</Option>
            <Option value="total">{t('configurations.total')}</Option>
          </Select>
        </Form.Item>
      ),
    },
  ];

  return (
    <Form form={form} onFinish={handleSave}>
      <Table
        dataSource={projects}
        columns={columns}
        pagination={false}
        rowKey="id"
      />
      <Button type="primary" htmlType="submit" loading={loading} style={{ marginTop: 16 }}>
        {t('configurations.save')}
      </Button>
    </Form>
  );
};

export default ProjectCostConfiguration;
