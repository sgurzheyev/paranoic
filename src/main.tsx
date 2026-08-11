import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { P2PProvider } from './P2PProvider';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <P2PProvider>
      <App />
    </P2PProvider>
  </StrictMode>
);
