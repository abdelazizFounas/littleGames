import { useRegisterSW } from 'virtual:pwa-register/react';
import { useLocation } from 'react-router';

/** Updates wait until the player leaves the game, then remain opt-in. */
export function UpdateNotice() {
  const { pathname, search } = useLocation();
  const { needRefresh: [available, setAvailable], updateServiceWorker } = useRegisterSW();
  if (!available || pathname.startsWith('/practice/') || (pathname.startsWith('/games/') && new URLSearchParams(search).has('match'))) return null;
  return <aside className="update-notice" role="status"><span>A fresh version is ready.</span><button className="button" onClick={() => { void updateServiceWorker(true).catch(() => setAvailable(false)); }}>Refresh</button><button className="link-button link-button--inline" onClick={() => setAvailable(false)}>Later</button></aside>;
}
