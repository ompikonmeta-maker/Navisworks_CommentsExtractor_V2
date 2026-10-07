import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Root from './Root.jsx';
import { StoreProvider } from './store/store.jsx';
import { SettingsProvider } from './store/settings.jsx';
import './index.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <SettingsProvider>
      <StoreProvider>
        <Root />
      </StoreProvider>
    </SettingsProvider>
  </StrictMode>
);
