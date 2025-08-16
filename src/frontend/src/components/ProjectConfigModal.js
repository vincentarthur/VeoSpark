import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Form, InputNumber, Select, Checkbox, Button, Spin, Alert } from 'antd';
import axios from 'axios';

const { Option } = Select;

const ProjectConfigModal = ({ open, onClose, project }) => {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open && project) {
      setLoading(true);
      axios.get(`/api/creative-projects/${project.id}/config`)
        .then(response => {
          form.setFieldsValue(response.data);
        })
        .catch(err => {
          setError('Failed to load project configuration.');
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [open, project, form]);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      await axios.post(`/api/creative-projects/${project.id}/config`, values);
      onClose();
    } catch (err) {
      setError('Failed to save project configuration.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      title={`Configuration for ${project?.name}`}
      onCancel={onClose}
      footer={[
        <Button key="back" onClick={onClose}>
          {t('common.cancel')}
        </Button>,
        <Button key="submit" type="primary" loading={loading} onClick={handleSave}>
          {t('common.submit')}
        </Button>,
      ]}
    >
      {loading ? <Spin /> : error ? <Alert message={error} type="error" /> : (
        <Form form={form} layout="vertical">
          <Form.Item name="unrestricted" valuePropName="checked">
            <Checkbox>{t('configurations.unrestricted')}</Checkbox>
          </Form.Item>
          <Form.Item name={['quota', 'type']} label={t('configurations.quotaType')}>
            <Select>
              <Option value="NO_LIMIT">{t('configurations.noLimit')}</Option>
              <Option value="COST_LIMIT">{t('configurations.costLimit')}</Option>
              <Option value="GENERATION_QUANTITY">{t('configurations.generationQuantity')}</Option>
            </Select>
          </Form.Item>
          <Form.Item name={['quota', 'limit']} label={t('configurations.limit')}>
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name={['quota', 'period']} label={t('configurations.period')}>
            <Select>
              <Option value="daily">{t('configurations.daily')}</Option>
              <Option value="weekly">{t('configurations.weekly')}</Option>
            </Select>
          </Form.Item>
        </Form>
      )}
    </Modal>
  );
};

export default ProjectConfigModal;
