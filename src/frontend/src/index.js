import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './i18n';
import 'antd/dist/reset.css';

// Import a CSS reset file or a global stylesheet for consistent styling
import './index.css';

// Find the 'root' div from public/index.html
const root = ReactDOM.createRoot(document.getElementById('root'));

// Render the main <App /> component into the 'root' div
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
