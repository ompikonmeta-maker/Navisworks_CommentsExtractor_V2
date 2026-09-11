import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { StoreProvider } from './store/store.jsx';
import { SettingsProvider } from './store/settings.jsx';
import './index.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <SettingsProvider>
      <StoreProvider>
        <App />
      </StoreProvider>
    </SettingsProvider>
  </StrictMode>
);
