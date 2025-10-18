import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import axios from 'axios';
import { ConfigProvider, Spin } from 'antd';
import { ThemeProvider, useTheme } from './contexts/ThemeContext';
import { HistoryProvider } from './contexts/HistoryContext';
import { lightTheme, darkTheme } from './antdTheme';

// Import Page & Component assets
import LoginPage from './pages/LoginPage';
import HomePage from './pages/HomePage';

function AppContent() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const { theme } = useTheme();

  // Set withCredentials to true for all requests to handle session cookies
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
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <ConfigProvider theme={theme === 'light' ? lightTheme : darkTheme}>
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
    </ConfigProvider>
  );
}

function App() {
  return (
    <ThemeProvider>
      <HistoryProvider>
        <AppContent />
      </HistoryProvider>
    </ThemeProvider>
  );
}

export default App;
