import React, { useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { AppBar, Toolbar, Typography, Button, Avatar, Box, Select, MenuItem, FormControl, Switch, Tooltip } from '@mui/material';
import { ThemeContext } from '../contexts/ThemeContext';

const Header = ({ user }) => {
  const { t, i18n } = useTranslation();
  const { toggleTheme, themeMode } = useContext(ThemeContext);

  const handleLogout = () => {
    // Since the frontend is served by the backend, we can use a relative URL for logout.
    window.location.href = '/logout';
  };

  // 3. This function is the core of the manual switch.
  //    It's called whenever the user selects a new language from the dropdown.
  const handleLanguageChange = (event) => {
    const lang = event.target.value; // This will be 'en', 'zh', or 'ja'
    i18n.changeLanguage(lang); // This command tells the i18next library to switch the language.
  };

  return (
    <AppBar position="static" color="default" elevation={0} sx={{ borderBottom: '1px solid #ddd' }}>
      <Toolbar>
        <Box sx={{ flexGrow: 1, display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <img src="/VeoSpark.png" alt="VeoSpark Logo" style={{ height: '36px', marginRight: '10px' }} />
          <Typography
            variant="h6"
            component="div"
            sx={{
              fontWeight: 700,
              letterSpacing: '1px',
              background: 'linear-gradient(45deg, #FE6B8B 30%, #FF8E53 90%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            {t('header.title')}
          </Typography>
        </Box>
        {user && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>

            {/* 2. This is the UI for the language switcher. */}
            <FormControl size="small" variant="outlined" sx={{ minWidth: 100 }}>
              <Select
                // The value is bound to the currently active language.
                // We use .split('-')[0] to handle cases like 'en-US' -> 'en'.
                value={i18n.language.split('-')[0]}
                // The onChange event is linked to our handler function.
                onChange={handleLanguageChange}
                sx={{ borderRadius: '8px' }}
              >
                <MenuItem value={'en'}>English</MenuItem>
                <MenuItem value={'zh'}>中文</MenuItem>
                <MenuItem value={'ja'}>日本語</MenuItem>
              </Select>
            </FormControl>

            <Tooltip title={t('header.toggleTheme')}>
              <Switch checked={themeMode === 'dark'} onChange={toggleTheme} />
            </Tooltip>

            <Avatar src={user.picture} alt={user.name} />
            <Typography sx={{ display: { xs: 'none', sm: 'block' } }}>{user.name}</Typography>
            <Button variant="outlined" color="inherit" onClick={handleLogout}>
              {t('header.logout')}
            </Button>
          </Box>
        )}
      </Toolbar>
    </AppBar>
  );
};
export default Header;
