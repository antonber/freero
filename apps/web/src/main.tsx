import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// '@ui' loads the design tokens (ui/tokens.css) and base styles; a relative
// import of ui/ files from here would be a deep import [W0].
import '@ui';
import { App } from './app/App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
