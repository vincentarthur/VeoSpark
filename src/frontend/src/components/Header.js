import React from 'react';
import { useTranslation } from 'react-i18next';
import { Layout, Typography, Button, Avatar, Select, Switch, Tooltip } from 'antd';
import { useTheme } from '../contexts/ThemeContext';

const { Header: AntHeader } = Layout;
const { Title } = Typography;
const { Option } = Select;

const Header = ({ user }) => {
  const { t, i18n } = useTranslation();
  const { theme, toggleTheme } = useTheme();

  const handleLogout = () => {
    window.location.href = '/logout';
  };

  const handleLanguageChange = (lang) => {
    i18n.changeLanguage(lang);
  };

  return (
    <AntHeader style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', borderBottom: '1px solid #f0f0f0' }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <img src="/VeoSpark.png" alt="VeoSpark Logo" style={{ height: '36px', marginRight: '10px' }} />
        <Title level={4} style={{ margin: 0,
          background: 'linear-gradient(45deg, #FE6B8B 30%, #FF8E53 90%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
        }}>
          {t('header.title')}
        </Title>
      </div>
      {user && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <Select
            value={i18n.language.split('-')[0]}
            onChange={handleLanguageChange}
            style={{ width: 120 }}
          >
            <Option value="en">English</Option>
            <Option value="zh">中文</Option>
            <Option value="ja">日本語</Option>
          </Select>
          <Tooltip title={t('header.toggleTheme')}>
            <Switch
              checked={theme === 'dark'}
              onChange={toggleTheme}
              checkedChildren="Dark"
              unCheckedChildren="Light"
            />
          </Tooltip>
          <Avatar src={user.picture} alt={user.name} />
          <Typography.Text style={{ display: 'none' }}>{user.name}</Typography.Text>
          <Button onClick={handleLogout}>{t('header.logout')}</Button>
        </div>
      )}
    </AntHeader>
  );
};

export default Header;
