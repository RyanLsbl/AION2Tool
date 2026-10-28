import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ToastProvider } from './ui';
import '@fontsource/cinzel/latin-600.css';
import '@fontsource/cinzel/latin-700.css';
import './styles.css';

// Farbschema vor dem ersten Rendern setzen (kein Aufblitzen); dunkel ist Standard
try {
  const t = localStorage.getItem('theme');
  if (t === 'light' || t === 'system') document.documentElement.dataset.theme = t;
} catch {
  // Speicher nicht verfügbar
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
);
