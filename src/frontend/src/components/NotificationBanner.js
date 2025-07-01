import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Alert, Container, Collapse } from '@mui/material';
import { styled, alpha } from '@mui/material/styles';

const StyledAlert = styled(Alert)(({ theme }) => ({
  borderRadius: theme.shape.borderRadius,
  border: `1px solid ${alpha(theme.palette.primary.main, 0.3)}`,
  backgroundColor: alpha(theme.palette.primary.main, 0.1),
  color: theme.palette.text.primary,
  '& .MuiAlert-icon': {
    color: theme.palette.primary.main,
  },
}));

const NotificationBanner = () => {
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    const fetchBannerMessages = async () => {
      try {
        const { data } = await axios.get('/api/notification-banner');
        if (data.messages && Array.isArray(data.messages)) {
          // We'll add a unique ID to each message for stable rendering and dismissal
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
    <Container maxWidth="xl" sx={{ mt: 2, mb: -1, display: 'flex', flexDirection: 'column', gap: 1 }}>
      {messages.map((msg) => (
        <Collapse in={true} key={msg.id}>
          <StyledAlert severity="info" onClose={() => handleClose(msg.id)}>
            {msg.text}
          </StyledAlert>
        </Collapse>
      ))}
    </Container>
  );
};

export default NotificationBanner;
