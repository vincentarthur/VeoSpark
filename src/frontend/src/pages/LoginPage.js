import React from 'react';
import { Button, Typography, Card } from 'antd';
import { GoogleOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;

const LoginPage = () => {
  const handleLogin = () => {
    window.location.href = '/login';
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
      <Card
        style={{
          width: 400,
          textAlign: 'center',
          background: 'rgba(255, 255, 255, 0.1)',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255, 255, 255, 0.2)',
        }}
      >
        <Title level={2} style={{ color: 'white' }}>Veo Spark</Title>
        <Text type="secondary" style={{ color: 'rgba(255, 255, 255, 0.7)' }}>
          Unleash Your Creativity with AI Video Generation
        </Text>
        <Button
          type="primary"
          size="large"
          icon={<GoogleOutlined />}
          onClick={handleLogin}
          style={{ marginTop: 24, width: '100%' }}
        >
          Sign in with Google
        </Button>
      </Card>
    </div>
  );
};

export default LoginPage;
