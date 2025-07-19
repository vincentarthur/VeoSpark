import { theme } from 'antd';

export const lightTheme = {
  token: {
    colorPrimary: '#1890ff',
    colorBgBase: '#ffffff',
  },
  algorithm: theme.defaultAlgorithm,
  components: {
    Layout: {
      colorBgHeader: '#ffffff',
      colorBgBody: '#ffffff',
    },
    Menu: {
      colorItemBg: '#ffffff',
    },
  },
};

export const darkTheme = {
  token: {
    colorPrimary: '#1890ff',
    colorBgBase: '#000000',
  },
  algorithm: theme.darkAlgorithm,
  components: {
    Layout: {
      colorBgHeader: '#000000',
      colorBgBody: '#000000',
    },
    Menu: {
      colorItemBg: '#000000',
    },
    Tabs: {
      colorText: 'rgba(255, 255, 255, 0.65)',
      colorTextActive: '#1890ff',
    }
  },
};
