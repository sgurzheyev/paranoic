import { Capacitor } from '@capacitor/core';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import InAppBrowserFallback from './InAppBrowserFallback';
import { isInAppBrowser } from './inAppBrowser';
import { P2PProvider } from './P2PProvider';
import { LanguageProvider } from './i18n';

if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
  document.documentElement.classList.add('capacitor-android');
}

const inApp = isInAppBrowser();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {inApp ? (
      <InAppBrowserFallback />
    ) : (
      <P2PProvider>
        <LanguageProvider>
          <App />
        </LanguageProvider>
      </P2PProvider>
    )}
  </StrictMode>
);
