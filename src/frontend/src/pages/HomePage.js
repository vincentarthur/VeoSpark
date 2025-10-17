import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { Layout, Menu, Tabs, Typography } from 'antd';
import Header from '../components/Header';
import NotificationBanner from '../components/NotificationBanner';
import Dashboard from '../components/Dashboard';
import ImagePromptGenerator from '../components/ImagePromptGenerator';
import ImageGenerator from '../components/ImageGenerator';
import ConversationalImageEnrichment from '../components/ConversationalImageEnrichment';
import HistoryPage from '../components/HistoryPage';
import AnalyticsPage from '../components/AnalyticsPage';
import ConfigurationsPage from '../components/ConfigurationsPage';
import PromptGalleryPage from './PromptGalleryPage';
import CreativeProjectsPage from './CreativeProjectsPage';
import GroupsPage from './GroupsPage';
import TeamGalleryPage from './TeamGalleryPage';

const { Content, Footer } = Layout;
const { TabPane } = Tabs;

const HomePage = ({ user }) => {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [firstFrame, setFirstFrame] = useState(null);
  const [lastFrame, setLastFrame] = useState(null);
  const [activeTab, setActiveTab] = useState("1");
  const [selectedProject, setSelectedProject] = useState(null);

  const handleProjectSelect = (projectId) => {
    setSelectedProject(projectId);
  };

  const handleUseAsFirstFrame = (frame) => {
    setFirstFrame(frame);
    setActiveTab("2");
    navigate('/');
  };

  const handleUseAsLastFrame = (frame) => {
    setLastFrame(frame);
    setActiveTab("2");
    navigate('/');
  };

  const getSelectedKey = () => {
    const path = location.pathname;
    if (path.startsWith('/gallery')) return 'gallery';
    if (path.startsWith('/history')) return 'history';
    if (path.startsWith('/teamgallery')) return 'teamgallery';
    if (path.startsWith('/creative-projects')) return 'creative-projects';
    if (path.startsWith('/groups')) return 'groups';
    if (path.startsWith('/analytics')) return 'analytics';
    if (path.startsWith('/configurations')) return 'configurations';
    return 'generator';
  };

  const menuItems = [
    { key: 'generator', label: t('nav.generator'), path: '/' },
    { key: 'gallery', label: t('nav.gallery'), path: '/gallery' },
    { key: 'history', label: t('nav.history'), path: '/history' },
    { key: 'teamgallery', label: t('nav.teamGallery'), path: '/teamgallery' },
    { key: 'creative-projects', label: t('nav.creativeProjects'), path: '/creative-projects' },
    user?.role === 'APP_ADMIN' && { key: 'groups', label: t('nav.groups'), path: '/groups' },
    user?.is_cost_manager && { key: 'analytics', label: t('nav.analytics'), path: '/analytics' },
    user?.role === 'APP_ADMIN' && { key: 'configurations', label: t('nav.configurations'), path: '/configurations' },
  ].filter(Boolean);

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header user={user} />
      <NotificationBanner />
      <Menu
        onClick={({ key }) => navigate(menuItems.find(item => item.key === key).path)}
        selectedKeys={[getSelectedKey()]}
        mode="horizontal"
      >
        {menuItems.map(item => (
          <Menu.Item key={item.key}>{item.label}</Menu.Item>
        ))}
      </Menu>
      <Content style={{ padding: '0 50px', marginTop: 16 }}>
        <div style={{ padding: 24, minHeight: 280 }}>
          <Routes>
            <Route path="/" element={
              <Tabs activeKey={activeTab} onChange={setActiveTab}>
                <TabPane tab={t('nav.imageGenerator')} key="1">
                  <ImageGenerator user={user} onUseAsFirstFrame={handleUseAsFirstFrame} onUseAsLastFrame={handleUseAsLastFrame} />
                </TabPane>
                <TabPane tab={t('nav.videoGenerator')} key="2">
                  <Dashboard initialFirstFrame={firstFrame} initialLastFrame={lastFrame} />
                </TabPane>
                <TabPane tab={t('nav.imageEnrichment')} key="4">
                  <ConversationalImageEnrichment 
                    user={user} 
                    onUseAsFirstFrame={handleUseAsFirstFrame} 
                    onUseAsLastFrame={handleUseAsLastFrame}
                    selectedProject={selectedProject}
                    onProjectSelect={handleProjectSelect}
                  />
                </TabPane>
              </Tabs>
            } />
            <Route path="/history" element={<HistoryPage user={user} onUseAsFirstFrame={handleUseAsFirstFrame} onUseAsLastFrame={handleUseAsLastFrame} />} />
            <Route path="/teamgallery" element={<TeamGalleryPage user={user} onUseAsFirstFrame={handleUseAsFirstFrame} onUseAsLastFrame={handleUseAsLastFrame} />} />
            <Route path="/creative-projects" element={<CreativeProjectsPage user={user} />} />
            {user?.role === 'APP_ADMIN' && <Route path="/groups" element={<GroupsPage />} />}
            {user?.is_cost_manager && <Route path="/analytics" element={<AnalyticsPage />} />}
            {user?.role === 'APP_ADMIN' && <Route path="/configurations" element={<ConfigurationsPage />} />}
            <Route path="/gallery" element={<PromptGalleryPage user={user} />} />
          </Routes>
        </div>
      </Content>
      <Footer style={{ textAlign: 'center' }}>
        <Typography.Text type="secondary">{t('footer.poweredBy')}</Typography.Text>
      </Footer>
    </Layout>
  );
};

export default HomePage;
