import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import InAppBrowserFallback from './InAppBrowserFallback';
import { isInAppBrowser } from './inAppBrowser';
import { P2PProvider } from './P2PProvider';

const inApp = isInAppBrowser();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {inApp ? (
      <InAppBrowserFallback />
    ) : (
      <P2PProvider>
        <App />
      </P2PProvider>
    )}
  </StrictMode>
);
