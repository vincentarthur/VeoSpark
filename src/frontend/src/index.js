import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './i18n';
import { ThemeProvider } from './contexts/ThemeContext';
import { UserProvider } from './contexts/UserContext';

// Import the main Roboto font for Material-UI
import '@fontsource/roboto/300.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';

// Import a CSS reset file or a global stylesheet for consistent styling
import './index.css';

// Find the 'root' div from public/index.html
const root = ReactDOM.createRoot(document.getElementById('root'));

// Render the main <App /> component into the 'root' div
root.render(
  <React.StrictMode>
    <ThemeProvider>
      <UserProvider>
        <App />
      </UserProvider>
    </ThemeProvider>
  </React.StrictMode>
);
