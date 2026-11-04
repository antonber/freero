import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// '@ui' loads the design tokens (ui/tokens.css) and base styles; a relative
// import of ui/ files from here would be a deep import [W0].
import '@ui';
import { installProblemCollector } from './app/problems/diagnostics';
import { bootLocale } from './app/i18n/locale';

// Errors and failed requests of this tab, for "Report a problem" (a small ring buffer, scrubbed).
installProblemCollector();

// The interface language is decided and its translations installed BEFORE the app's modules load,
// so every label — including those evaluated when a module loads — is in that language
// (docs/design/i18n.md).
void bootLocale().then(async () => {
  const { App } = await import('./app/App');
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
