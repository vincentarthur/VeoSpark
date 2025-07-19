import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Alert } from 'antd';

const NotificationBanner = () => {
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    const fetchBannerMessages = async () => {
      try {
        const { data } = await axios.get('/api/notification-banner');
        if (data.messages && Array.isArray(data.messages)) {
          setMessages(data.messages.map((msg, index) => ({ id: index, text: msg })));
        }
      } catch (error) {
        console.error("Could not fetch banner messages:", error);
      }
    };
    fetchBannerMessages();
  }, []);

  const handleClose = (id) => {
    setMessages((prevMessages) => prevMessages.filter((msg) => msg.id !== id));
  };

  if (messages.length === 0) {
    return null;
  }

  return (
    <div style={{ padding: '0 50px', marginTop: 16 }}>
      {messages.map((msg) => (
        <Alert
          key={msg.id}
          message={msg.text}
          type="info"
          showIcon
          closable
          onClose={() => handleClose(msg.id)}
          style={{ marginBottom: 8 }}
        />
      ))}
    </div>
  );
};

export default NotificationBanner;
