// Installable app (KAI-140): registers the service worker (app/pwa/sw.ts → /sw.js, production
// builds only) and keeps people off stale code after a deploy:
// - page loads always fetch index.html from the network, so a reload or the next launch runs the
//   new build (the worker never serves cached pages);
// - a tab left open while a new version installs gets a "Reload" toast; reloading hands control to
//   the new worker first;
// - a lazy chunk of the old build that the server no longer has (vite:preloadError) reloads the
//   page once instead of leaving a half-loaded screen.
import { useEffect } from 'react';
import { useToast } from '@ui';

/** How often an open tab asks whether a new version was deployed (ms). */
const UPDATE_CHECK_MS = 30 * 60 * 1000;
const RELOADED_KEY = 'freero:reloaded-for-update';

export function AppUpdates() {
  const notify = useToast();

  // An old build's chunk is gone: reload once (not in a loop if the new build fails the same way).
  useEffect(() => {
    const onPreloadError = (e: Event) => {
      try {
        if (sessionStorage.getItem(RELOADED_KEY)) return;
        sessionStorage.setItem(RELOADED_KEY, '1');
      } catch {
        return;
      }
      e.preventDefault();
      window.location.reload();
    };
    window.addEventListener('vite:preloadError', onPreloadError);
    const settled = setTimeout(() => {
      try {
        sessionStorage.removeItem(RELOADED_KEY);
      } catch {
        // storage unavailable
      }
    }, 10_000);
    return () => {
      window.removeEventListener('vite:preloadError', onPreloadError);
      clearTimeout(settled);
    };
  }, []);

  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    let onVisible: (() => void) | null = null;
    const offers = new WeakSet<ServiceWorker>();

    const offer = (worker: ServiceWorker) => {
      if (stopped || offers.has(worker) || !navigator.serviceWorker.controller) return; // first install: nothing to replace
      offers.add(worker);
      notify('A new version of Freero is ready.', 'info', {
        duration: 0,
        action: {
          label: 'Reload',
          onClick: () => {
            navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
            worker.postMessage({ type: 'SKIP_WAITING' });
            // Already active elsewhere (another tab took it over): just reload.
            setTimeout(() => window.location.reload(), 3000);
          },
        },
      });
    };

    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then((reg) => {
        if (reg.waiting) offer(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const next = reg.installing;
          next?.addEventListener('statechange', () => {
            if (next.state === 'installed') offer(next);
          });
        });
        const check = () => void reg.update().catch(() => undefined);
        timer = setInterval(check, UPDATE_CHECK_MS);
        onVisible = () => document.visibilityState === 'visible' && check();
        if (!stopped) document.addEventListener('visibilitychange', onVisible);
      })
      .catch(() => undefined); // no worker (private mode, blocked): the app works the same without one
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      if (onVisible) document.removeEventListener('visibilitychange', onVisible);
    };
  }, [notify]);

  return null;
}
