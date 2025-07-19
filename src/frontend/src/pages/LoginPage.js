import React from 'react';
import { Button, Typography, Card, Row, Col } from 'antd';
import { GoogleOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;

const LoginPage = () => {
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
        <Row justify="center" align="middle" gutter={16} style={{ marginBottom: 24 }}>
          <Col>
            <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/Google_2015_logo.svg/1200px-Google_2015_logo.svg.png" alt="Google Cloud" style={{ height: 40 }} />
          </Col>
          <Col>
            <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/1/18/Google_Gemini_logo.svg/1200px-Google_Gemini_logo.svg.png" alt="Gemini" style={{ height: 40 }} />
          </Col>
          <Col>
            <img src="/VeoSpark.png" alt="VeoSpark" style={{ height: 40 }} />
          </Col>
        </Row>
        <Title level={1} style={{ color: 'white' }}>Veo Spark</Title>
        <Text type="secondary" style={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: '1.2rem' }}>
          Unleash Your Creativity with AI Video Generation
        </Text>
        <Button
          type="primary"
          size="large"
          icon={<GoogleOutlined />}
          onClick={handleLogin}
          style={{ marginTop: 24, width: '50%' }}
        >
          Sign in with Google
        </Button>
      </Card>
    </div>
  );
};

export default LoginPage;
