import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button, Typography, Radio, Input,
  Spin, Alert, Select, Form, Card, Row, Col, Tabs
} from 'antd';
import axios from 'axios';
import ProjectCostConfiguration from './ProjectCostConfiguration';

const { Title, Text } = Typography;
const { TabPane } = Tabs;
const { Option } = Select;

const ConfigurationsPage = () => {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [quotaType, setQuotaType] = useState('NO_LIMIT');

  useEffect(() => {
    const fetchConfiguration = async () => {
      try {
        setLoading(true);
        const response = await axios.get('/api/configurations');
        const { quota } = response.data;
        form.setFieldsValue({
          quotaType: quota.type,
          limit: quota.limit,
          period: quota.period,
        });
        setQuotaType(quota.type);
      } catch (err) {
        setError(err.response?.data?.detail || 'Failed to fetch configuration.');
      } finally {
        setLoading(false);
      }
    };
    fetchConfiguration();
  }, [form]);

  const handleSubmit = async (values) => {
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const config = {
        quota: {
          type: values.quotaType,
          limit: values.quotaType !== 'NO_LIMIT' ? parseInt(values.limit, 10) : undefined,
          period: values.quotaType !== 'NO_LIMIT' ? values.period : undefined,
        }
      };
      await axios.post('/api/configurations', config);
      setSuccess('Configuration saved successfully.');
    } catch (err) {
      setError(err.response?.data?.detail || 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <Title level={2}>{t('configurations.title')}</Title>
      <Tabs defaultActiveKey="1">
        <TabPane tab={t('configurations.globalSettings')} key="1">
          <Form form={form} layout="vertical" onFinish={handleSubmit} onValuesChange={(changedValues) => {
            if (changedValues.quotaType) {
              setQuotaType(changedValues.quotaType);
            }
          }}>
            <Form.Item name="quotaType" label={t('configurations.quotaType')}>
              <Radio.Group>
                <Radio.Button value="NO_LIMIT">{t('configurations.noLimit')}</Radio.Button>
                <Radio.Button value="COST_LIMIT">{t('configurations.costLimit')}</Radio.Button>
                <Radio.Button value="GENERATION_QUANTITY">{t('configurations.generationQuantity')}</Radio.Button>
              </Radio.Group>
            </Form.Item>

            {quotaType === 'COST_LIMIT' && (
              <Text type="secondary">{t('configurations.costLimitDescription')}</Text>
            )}
            {quotaType === 'GENERATION_QUANTITY' && (
              <Text type="secondary">{t('configurations.generationQuantityDescription')}</Text>
            )}

            {quotaType !== 'NO_LIMIT' && (
              <Row gutter={16} style={{ marginTop: 16 }}>
                <Col span={12}>
                  <Form.Item name="limit" label={t('configurations.limit')} rules={[{ required: true }]}>
                    <Input type="number" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="period" label={t('configurations.period')} rules={[{ required: true }]}>
                    <Select>
                      <Option value="day">{t('configurations.daily')}</Option>
                      <Option value="week">{t('configurations.weekly')}</Option>
                    </Select>
                  </Form.Item>
                </Col>
              </Row>
            )}

            <Form.Item>
              <Button type="primary" htmlType="submit" loading={loading}>
                {t('configurations.save')}
              </Button>
            </Form.Item>

            {error && <Alert message={error} type="error" showIcon />}
            {success && <Alert message={success} type="success" showIcon />}
          </Form>
        </TabPane>
        <TabPane tab={t('configurations.projectSettings')} key="2">
          <ProjectCostConfiguration />
        </TabPane>
      </Tabs>
    </Card>
  );
};

export default ConfigurationsPage;
