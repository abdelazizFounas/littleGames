import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { GAMES } from '../features/catalog/games';
import type { PracticeSession } from '../features/practice/practice-session';
import { describeError } from '../lib/describe-error';

export function PracticeRoute() {
  const { gameId } = useParams();
  if (gameId !== 'arena' && gameId !== 'pong') return <section className="panel"><h1>Choose your warm-up.</h1><p className="lede">Solo practice is available for Rift Arena and Neon Pong.</p><Link className="button" to="/practice/arena">Practice Arena →</Link><Link className="text-link" to="/practice/pong">Practice Pong →</Link></section>;
  return <PracticeGame key={gameId} gameId={gameId}/>;
}
function PracticeGame({ gameId }: { readonly gameId: 'arena' | 'pong' }) {
  const container = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const session = useRef<PracticeSession | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'playing' | 'paused' | 'finished'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState('');
  const [attempt, setAttempt] = useState(0);
  const game = gameId === 'arena' ? GAMES[0] : GAMES[1];
  useEffect(() => {
    let cancelled = false;
    let current: PracticeSession | null = null;
    setStatus('loading'); setError(null);
    async function mount() {
      const module = gameId === 'arena' ? await import('../features/practice/arena-practice') : await import('../features/practice/pong-practice');
      if (cancelled || !container.current) return;
      current = await module.createPractice(container.current, {
        onPause: () => { if (!cancelled) setStatus('paused'); },
        onFinish: message => { if (!cancelled) { setResult(message); setStatus('finished'); } },
        onError: message => { if (!cancelled) { setError(message); setStatus('paused'); } },
      });
      if (cancelled) { current.stop(); return; }
      session.current = current;
      setStatus('ready');
    }
    void mount().catch(cause => { if (!cancelled) setError(describeError(cause, 'The game could not start. Please check WebGL support in your browser.')); });
    return () => { cancelled = true; current?.stop(); session.current = null; };
  }, [gameId, attempt]);
  function start(restart = false) { setError(null); if (restart || status === 'finished') session.current?.restart(); session.current?.start(); setStatus('playing'); }
  return <section className="practice-page">
    <div className="practice-heading"><div><p className="eyebrow"><span className="status-dot"/> SOLO PRACTICE · NO ACCOUNT NEEDED</p><h1>{game.name}<span className="lime">.</span></h1></div><Link className="button" to={`/games/${gameId}`}>Ready for a real rival? ↗</Link></div>
    <p className="hint">{gameId === 'arena' ? 'Warm up against a moving bot. First to 7 eliminations wins. Right-click for precise scoped shots.' : 'You’re the green paddle on the left. Beat the bot to 11 points.'}</p>
    <div ref={frame} className="practice-frame"><div ref={container} className={`stage__surface${gameId === 'arena' ? ' stage__surface--arena' : ''}`}/>
      {status !== 'playing' && <div className="practice-overlay"><p className="eyebrow">A LITTLE PRACTICE GOES A LONG WAY</p><h2>{error && status === 'loading' ? 'Let’s try that again.' : status === 'loading' ? 'Building your playground…' : status === 'finished' ? result : status === 'paused' ? 'Take a breather.' : 'Meet your practice rival.'}</h2><p>{gameId === 'arena' ? 'WASD to move · Mouse to aim · Click to fire · Right-click to scope · Shift to crouch' : 'Arrow keys or W / S to move. On touchscreens, drag on the court.'}</p>{error && <p role="alert" className="error">{error}</p>}{status !== 'loading' ? <button className="button button--primary" onClick={() => start()}>{status === 'paused' ? 'Resume game' : status === 'finished' ? 'Play again' : 'Let’s play'} ↗</button> : error && <button className="button" onClick={() => setAttempt(value => value + 1)}>Retry</button>}</div>}
    <button className="button practice-fullscreen-exit" onClick={() => { void document.exitFullscreen().catch(() => { session.current?.pause(); }); }}>Exit fullscreen ⛶</button></div>
    <div className="practice-toolbar"><span>{gameId === 'arena' ? 'WASD · MOUSE · SPACE TO JUMP · ESC TO PAUSE' : '↑ ↓ TO MOVE · ESC TO PAUSE'} · PRACTICE SCORES STAY LOCAL</span><div className="actions"><button className="button" disabled={status === 'loading'} onClick={() => session.current?.pause()}>Pause</button><button className="button" disabled={status === 'loading'} onClick={() => { session.current?.pause(); session.current?.restart(); setStatus('ready'); }}>Restart</button><button className="button" onClick={() => { const target = frame.current; if (!target) return; const change = document.fullscreenElement ? document.exitFullscreen() : target.requestFullscreen?.(); void change?.catch(() => { setError('Fullscreen is unavailable. You can keep playing in this window.'); session.current?.pause(); }); }}>Fullscreen ⛶</button></div></div>
    <Link className="text-link" to={`/practice/${gameId === 'arena' ? 'pong' : 'arena'}`}>Try {gameId === 'arena' ? 'Neon Pong' : 'Rift Arena'} practice →</Link>
  </section>;
}
