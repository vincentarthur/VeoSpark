import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { Box, Tabs, Tab, Paper, Typography } from '@mui/material';

import Header from '../components/Header';
import NotificationBanner from '../components/NotificationBanner'; // Import the new component
import Dashboard from '../components/Dashboard';
import ImagePromptGenerator from '../components/ImagePromptGenerator';
import ImageGenerator from '../components/ImageGenerator';
import HistoryPage from '../components/HistoryPage';
import AnalyticsPage from '../components/AnalyticsPage'; // Import the new page
import ConfigurationsPage from '../components/ConfigurationsPage';
import PromptGalleryPage from './PromptGalleryPage';
import GroupsPage from './GroupsPage';
import SharedItemsPage from './SharedItemsPage';

const HomePage = ({ user }) => {
  const { t } = useTranslation();
  const location = useLocation();
  const [currentTab, setCurrentTab] = useState(0);
  const [generatorTab, setGeneratorTab] = useState(0);
  const [firstFrame, setFirstFrame] = useState(null);

  const handleUseAsFirstFrame = (frame) => {
    setFirstFrame(frame);
    setCurrentTab(0);
    setGeneratorTab(1); // 1 is for Video Generator (Dashboard)
  };

  useEffect(() => {
    if (location.pathname === '/gallery') {
      setCurrentTab(1);
    } else if (location.pathname === '/history') {
      setCurrentTab(2);
    } else if (location.pathname === '/shared-items') {
      setCurrentTab(3);
    } else if (location.pathname === '/groups') {
      setCurrentTab(4);
    } else if (location.pathname === '/analytics') {
      setCurrentTab(5);
    } else if (location.pathname === '/configurations') {
      setCurrentTab(6);
    }
    else {
      setCurrentTab(0);
    }
  }, [location.pathname]);

  const handleTabChange = (event, newValue) => {
    setCurrentTab(newValue);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', bgcolor: 'background.default' }}>
      <Header user={user} />
      <NotificationBanner />
      <Paper square elevation={1}>
        <Tabs
          value={currentTab}
          onChange={handleTabChange}
          indicatorColor="primary"
          textColor="primary"
          centered
        >
          <Tab label={t('nav.generator')} component={Link} to="/" />
          <Tab label={t('nav.gallery')} component={Link} to="/gallery" />
          <Tab label={t('nav.history')} component={Link} to="/history" />
          <Tab label={t('nav.teamGallery')} component={Link} to="/shared-items" />
          {user?.role === 'APP_ADMIN' && (
            <Tab label={t('nav.groups')} component={Link} to="/groups" />
          )}
          {user?.is_cost_manager && (
            <Tab label={t('nav.analytics')} component={Link} to="/analytics" />
          )}
          {user?.role === 'APP_ADMIN' && (
            <Tab label={t('nav.configurations')} component={Link} to="/configurations" />
          )}
        </Tabs>
      </Paper>
      <Box
          component="main"
          sx={{
            flexGrow: 1,
            overflowY: 'auto',
            p: { xs: 2, sm: 3 },
          }}
        >
        <Routes>
          <Route path="/" element={
            <Box>
              <Tabs value={generatorTab} onChange={(e, newValue) => setGeneratorTab(newValue)} centered>
                <Tab label={t('nav.imageGenerator')} />
                <Tab label={t('nav.videoGenerator')} />
                <Tab label={t('nav.promptFromImages')} />
              </Tabs>
              {generatorTab === 0 && <ImageGenerator user={user} onUseAsFirstFrame={handleUseAsFirstFrame} />}
              {generatorTab === 1 && <Dashboard initialFirstFrame={firstFrame} />}
              {generatorTab === 2 && <ImagePromptGenerator />}
            </Box>
          } />
          <Route path="/history" element={<HistoryPage user={user} onUseAsFirstFrame={handleUseAsFirstFrame} />} />
          <Route path="/shared-items" element={<SharedItemsPage user={user} onUseAsFirstFrame={handleUseAsFirstFrame} />} />
          {user?.role === 'APP_ADMIN' && (
            <Route path="/groups" element={<GroupsPage />} />
          )}
          {user?.is_cost_manager && (
            <Route path="/analytics" element={<AnalyticsPage />} />
          )}
          {user?.role === 'APP_ADMIN' && (
            <Route path="/configurations" element={<ConfigurationsPage />} />
          )}
          <Route path="/gallery" element={<PromptGalleryPage user={user} />} />
        </Routes>
      </Box>
      <Box component="footer" sx={{ p: 2, mt: 'auto', textAlign: 'center', color: 'grey.700' }}>
        <Typography variant="body2">{t('footer.poweredBy')}</Typography>
      </Box>
    </Box>
  );
};
export default HomePage;
