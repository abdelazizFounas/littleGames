import { displayNameOf } from '@littlegames/net';
import { useEffect } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { useAsyncAction } from '../lib/use-async-action';
import { UpdateNotice } from './update-notice';
import { useSession } from '../session/use-session';

export function AppLayout() {
  const { state, signOutPlayer } = useSession();
  const signOut = useAsyncAction('Could not sign out.');
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
    const labels: Record<string, string> = {'/': 'Small games, big rivalries', '/guide': 'How to play', '/login': 'Sign in', '/privacy': 'Your data', '/profile': 'My profile', '/games/arena': 'Rift Arena', '/games/pong': 'Neon Pong', '/games/battleship': 'Fleet Command', '/practice/arena': 'Rift Arena practice', '/practice/pong': 'Neon Pong practice'};
    document.title = `${labels[pathname] ?? 'Your move'} · LittleGames`;
  }, [pathname]);
  return <>
    <a href="#main-content" className="skip-link">Skip to content</a>
    <header className="masthead"><div className="masthead__inner">
      <Link className="masthead__brand" to="/" aria-label="LittleGames, home"><span className="brand-mark" aria-hidden="true">l<span>g</span></span>little<span>games</span><span className="brand-period" aria-hidden="true">✦</span></Link>
      <nav className="main-nav" aria-label="Main navigation"><NavLink to="/" end>The games</NavLink><NavLink to="/practice/arena">Practice</NavLink><NavLink to="/guide">How to play</NavLink></nav>
      <div className="masthead__nav">{state.status === 'signed-in' ? <><Link className="profile-link" to="/profile">{displayNameOf(state.profile)}</Link><button type="button" className="link-button link-button--inline" disabled={signOut.pending} onClick={() => signOut.run(signOutPlayer)} aria-label="Sign out">↪</button></> : <Link className="button button--small" to="/login">Let’s play <span>↗</span></Link>}</div>
    </div></header>
    {signOut.error !== null && <p role="alert" className="error error--banner">{signOut.error}</p>}
    <main className="app" id="main-content" tabIndex={-1}><Outlet/></main>
    <UpdateNotice/>
    <footer className="site-footer"><div><Link to="/" className="footer-brand">little<span>games</span><span className="lime">.</span></Link><p>Little breaks. Great games.</p></div><nav aria-label="Useful links"><Link to="/">The games</Link><Link to="/guide">Help & rules</Link><Link to="/privacy">Your data</Link></nav><span className="footer-signature">PLAY A LITTLE. ENJOY A LOT.</span></footer>
  </>;
}
