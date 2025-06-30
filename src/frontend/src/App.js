import React, { useState, useEffect } from 'react'; // <--- THIS LINE IS CRUCIAL
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'; // <--- AND THIS ONE
import axios from 'axios';

// Import Material-UI components
import { CircularProgress, Box, CssBaseline } from '@mui/material';

// Import Page & Component assets
import LoginPage from './pages/LoginPage';
import HomePage from './pages/HomePage';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  axios.defaults.baseURL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:7860';
  axios.defaults.withCredentials = true;

  useEffect(() => {
    const verifyUser = async () => {
      try {
        const { data } = await axios.get('/api/user/me');
        if (data.authenticated) {
          setUser(data);
        }
      } catch (error) {
        setUser(null);
      } finally {
        setLoading(false);
      }
    };
    verifyUser();
  }, []);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <>
      <CssBaseline />
      <Box sx={{
          minHeight: '100vh',
          width: '100%',
          background: 'linear-gradient(to top right, #6a85b6 0%, #bac8e0 100%)',
          overflow: 'auto',
      }}>
        <Router>
          <Routes>
            <Route
              path="/login"
              element={user ? <Navigate to="/" /> : <LoginPage />}
            />
            <Route
              path="/*"
              element={user ? <HomePage user={user} /> : <Navigate to="/login" />}
            />
          </Routes>
        </Router>
      </Box>
    </>
  );
}

export default App;
