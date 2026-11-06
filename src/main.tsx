import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { RELOAD_PARAM } from './lib/appUpdate';
import { installViewportMetrics } from './lib/viewport';
import './styles/index.css';

registerSW({ immediate: true });

// Publishes --kb-inset / --safe-bottom before the first paint, so bottom bars
// are positioned correctly from the start rather than settling into place.
installViewportMetrics();

// Settings' "Force reload" appends a cache-busting param to defeat the HTTP
// cache. Strip it once we're here so it doesn't stick in the address bar or
// get shared/bookmarked. replaceState leaves no history entry to go back to.
{
  const url = new URL(window.location.href);
  if (url.searchParams.has(RELOAD_PARAM)) {
    url.searchParams.delete(RELOAD_PARAM);
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Outside the router, so a crash in routing itself is still caught. */}
    <ErrorBoundary>
      {/* basename keeps routing correct when served from a sub-path, e.g. a
          GitHub Pages project site at /<repo>/. Vite injects BASE_URL. */}
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
