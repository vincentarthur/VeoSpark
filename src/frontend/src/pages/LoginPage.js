import React from 'react';
import { Button, Typography, Card } from 'antd';
import { GoogleOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

const { Title, Text } = Typography;

const LoginPage = () => {
  const { t } = useTranslation();
  const handleLogin = () => {
    window.location.href = '/login';
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: '#000' }}>
      <Card
        style={{
          width: 800,
          textAlign: 'center',
          background: 'rgba(255, 255, 255, 0.1)',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255, 255, 255, 0.2)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', marginBottom: '24px' }}>
          <img src="/Google_Cloud_logo.svg" alt="Google Cloud" style={{ height: 40 }} />
          <img src="/Google_Gemini_logo.svg" alt="Gemini" style={{ height: 40, position: 'relative', bottom: '5px' }} />
        </div>
        <Title level={1} style={{ color: 'white' }}>{t('login.title')}</Title>
        <div>
          <Text type="secondary" style={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: '1.2rem' }}>
            {t('login.subtitle')}
          </Text>
        </div>
        <div style={{ marginTop: '24px' }}>
          <Button
            type="primary"
            size="large"
            icon={<GoogleOutlined />}
            onClick={handleLogin}
            style={{ width: '50%' }}
          >
            {t('login.button')}
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default LoginPage;
