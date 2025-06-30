import React from 'react';
import { Button, Typography, Container, Box, Paper } from '@mui/material';
import GoogleIcon from '@mui/icons-material/Google';

const LoginPage = () => {
  const handleLogin = () => {
    const backendUrl = process.env.REACT_APP_BACKEND_URL || 'http://localhost:7860';
    window.location.href = `${backendUrl}/login`;
  };

  return (
    <Container
      component="main"
      maxWidth="sm"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
      }}
    >
      <Paper
        // MODIFIED: Replaced elevation with our new glassmorphism styles
        sx={{
          padding: { xs: 3, sm: 6 },
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          // NEW: Frosted Glass / Glassmorphism styles
          background: 'rgba(255, 255, 255, 0.7)', // Semi-transparent background
          backdropFilter: 'blur(10px) saturate(120%)',
          WebkitBackdropFilter: 'blur(10px) saturate(120%)', // For Safari support
          borderRadius: '16px',
          border: '1px solid rgba(255, 255, 255, 0.3)',
          boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.1)'
        }}
      >
        <Box mb={3}>
          <Typography component="h1" variant="h2" sx={{ fontWeight: 'bold' }}>
            Veo Studio
          </Typography>
          <Typography variant="h6" color="text.secondary">
            Unleash Your Creativity with AI Video Generation
          </Typography>
        </Box>

        <Button
          variant="contained"
          size="large"
          startIcon={<GoogleIcon />}
          onClick={handleLogin}
          sx={{
            py: 1.5,
            px: 4,
            textTransform: 'none',
            fontSize: '1.1rem',
            borderRadius: '8px',
          }}
        >
          Sign in with Google
        </Button>
      </Paper>
    </Container>
  );
};

export default LoginPage;