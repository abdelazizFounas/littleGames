import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { describeError } from '../../lib/describe-error';
import { useSession } from '../../session/use-session';
import { ArenaReadyPanel } from './arena-ready-panel';
import { ArenaResultPanel } from './arena-result-panel';
import { ArenaSettingsPanel } from './arena-settings-panel';
import {
  DEFAULT_ARENA_SETTINGS,
  hasCoarsePointer,
  readArenaSettings,
  writeArenaSettings,
  type ArenaSettings,
} from './arena-settings';
import {
  startArenaSession,
  type ArenaLobbyState,
  type ArenaSession,
  type ArenaSessionStatus,
} from './arena-session';
import { lockKeyboard, unlockKeyboard } from './keyboard-lock';

/**
 * The arena screen.
 *
 * React places a box on the page, reports whether the match is joined, and
 * draws the two things that are not the game: the panel and the overlay that
 * takes the pointer back. It never enters the frame loop.
 *
 * Everything that must survive fullscreen renders inside `frameRef`. That is
 * the element `requestFullscreen` is called on, and anything outside it is not
 * merely mispositioned while fullscreen is active — it is not on the screen at
 * all.
 */

/** How long to wait before writing settings out, so a dragged slider is one write. */
const SETTINGS_SAVE_DEBOUNCE_MS = 800;

const LOCAL_SETTINGS_KEY = 'littlegames.arena.settings';

/**
 * How long the pointer must be held for the browser to be taken seriously.
 *
 * A grant followed immediately by a drop is a browser that will not keep one —
 * Firefox does exactly that — and the hint tells the player so rather than the
 * mouse silently doing nothing.
 */
const MIN_HELD_MS = 1000;

/**
 * The keys the game asks the browser to hand over while it is fullscreen.
 *
 * Escape is deliberately absent: it is how a player leaves, and a game that took
 * the exit away would be a game nobody could get out of.
 */
const GAME_KEY_CODES: readonly string[] = [
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyR', 'KeyF', 'KeyC', 'KeyP', 'KeyT',
  'Space', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight',
  'Tab', 'Digit1', 'Digit2', 'Digit3', 'Digit4',
];

export function ArenaStage({
  userId,
  matchId,
  password,
  onJoined,
}: {
  readonly userId: string;
  readonly matchId: string;
  readonly password?: string | undefined;
  readonly onJoined: (matchId: string) => void;
}): ReactNode {
  const { joinArena, loadGameSettings, saveGameSettings } = useSession();
  const frameRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<ArenaSession | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [status, setStatus] = useState<ArenaSessionStatus>({ kind: 'connecting' });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Whether the game currently holds the mouse. Drives the one-line hint. */
  const [holdsPointer, setHoldsPointer] = useState(false);
  const lockGainedAt = useRef(0);
  /** Why the browser would not hide the pointer, if it would not. */
  const [lockRefusal, setLockRefusal] = useState<string | null>(null);
  /** Set once this browser has proved it will not hold the pointer. */
  const [lockUnreliable, setLockUnreliable] = useState(false);
  const [lobby, setLobby] = useState<ArenaLobbyState>({
    phase: 'waiting',
    youAreReady: false,
    opponentPresent: false,
    opponentReady: false,
    opponentName: 'your opponent',
    ownScore: 0,
    opponentScore: 0,
    won: false,
  });
  // Read from this browser first so the controls are right on the first frame
  // rather than a round trip later; the account's copy is adopted below if it
  // turns out to be the newer one.
  const [settings, setSettings] = useState<ArenaSettings>(() =>
    readArenaSettings(readCachedSettings()),
  );
  const [touchLayout] = useState(hasCoarsePointer);

  // The account's copy, fetched once the screen mounts. Local storage is a
  // cache here, not the record: whichever was written last wins, which is the
  // right answer for one person editing their own preferences on two machines.
  useEffect(() => {
    let cancelled = false;
    const adoptNewer = async (): Promise<void> => {
      const stored = await loadGameSettings('arena');
      // The newer of the two copies wins, and the local one is only a cache. A
      // player who tuned their aim on this machine keeps it; one who tuned it
      // on another and signed in here gets what they set there.
      if (cancelled || stored === null || stored.updatedAt < readCachedTimestamp()) {
        return;
      }
      const adopted = readArenaSettings(stored.value);
      setSettings(adopted);
      sessionRef.current?.updateSettings(adopted);
    };

    void adoptNewer().catch(() => {
      // Settings that will not load are not a reason to refuse to play: the
      // cached copy, or the defaults, are already in hand.
    });
    return () => {
      cancelled = true;
    };
  }, [loadGameSettings]);

  const applySettings = useCallback(
    (next: ArenaSettings) => {
      setSettings(next);
      // Straight into the live input source, with no re-render of anything that
      // draws: the loop reads the settings object it was handed.
      sessionRef.current?.updateSettings(next);

      const updatedAt = Date.now();
      const blob = writeArenaSettings(next);
      writeCachedSettings(blob, updatedAt);

      if (saveTimer.current !== null) {
        clearTimeout(saveTimer.current);
      }
      saveTimer.current = setTimeout(() => {
        void saveGameSettings('arena', blob, updatedAt).catch(() => {
          // The local copy is already written, so a failed round trip costs the
          // player nothing until they change machines.
        });
      }, SETTINGS_SAVE_DEBOUNCE_MS);
    },
    [saveGameSettings],
  );

  const openSettings = useCallback((): void => {
    setSettingsOpen(true);
    // Releasing the pointer is what lets the mouse reach the panel. It does not
    // leave fullscreen, so the panel stays over the game where it belongs.
    sessionRef.current?.release();
  }, []);

  /** Closes the settings and asks for the pointer straight back. */
  const closeSettings = useCallback((): void => {
    setSettingsOpen(false);
    sessionRef.current?.resume();
  }, []);

  /**
   * The one key that opens the settings also closes them.
   *
   * Escape cannot do the opening: a browser spends it exiting pointer lock and
   * never delivers the key. Losing the lock is therefore read as the request,
   * below. Once the panel is open the pointer is free, so Escape arrives
   * normally and closes it — which is what everyone expects it to do.
   */
  const onSettingsKey = useCallback(
    (event: KeyboardEvent): void => {
      if (event.code !== 'Escape' && event.code !== 'KeyP') {
        return;
      }
      event.preventDefault();
      closeSettings();
    },
    [closeSettings],
  );

  useEffect(() => {
    if (!settingsOpen) {
      return undefined;
    }
    window.addEventListener('keydown', onSettingsKey);
    return () => {
      window.removeEventListener('keydown', onSettingsKey);
    };
  }, [onSettingsKey, settingsOpen]);

  /** Says this player is ready, and takes the mouse with the same gesture. */
  const toggleReady = useCallback((): void => {
    const next = !lobby.youAreReady;
    sessionRef.current?.setReady(next);
    setLobby((current) => ({ ...current, youAreReady: next }));
    if (next) {
      // The click is the user gesture pointer lock needs, and there will not be
      // another one before the countdown ends.
      sessionRef.current?.resume();
    }
  }, [lobby.youAreReady]);

  // Held in a ref so the session, which is started once, always calls the
  // current one rather than the one that existed when it started.
  const openSettingsRef = useRef(openSettings);
  openSettingsRef.current = openSettings;

  // The settings the session is started with, kept in a ref so that changing
  // them never re-runs the effect below and drops the player out of the match
  // they are tuning.
  const settingsAtStart = useRef(settings);
  settingsAtStart.current = settings;

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return undefined;
    }

    const abort = new AbortController();
    let cancelled = false;

    const run = async (): Promise<void> => {
      try {
        const session = await startArenaSession(
          container,
          userId,
          matchId,
          password ?? '',
          settingsAtStart.current,
          joinArena,
          {
            onStatus: (next) => {
              if (cancelled) {
                return;
              }
              setStatus(next);
              if (next.kind === 'playing') {
                onJoined(next.matchId);
              }
            },
            onLockChange: (next) => {
              if (cancelled) {
                return;
              }
              setHoldsPointer(next);
              if (next) {
                lockGainedAt.current = Date.now();
                setLockRefusal(null);
                return;
              }

              // A pointer handed straight back is a browser that will not keep
              // one, and the hint says so rather than the mouse silently doing
              // nothing.
              if (Date.now() - lockGainedAt.current < MIN_HELD_MS) {
                setLockUnreliable(true);
              }

              // And nothing else. Losing the pointer used to open the settings,
              // on the reasoning that no browser delivers Escape while it is
              // hidden — but it also goes when the window loses focus, and a
              // menu that appears because you alt-tabbed is a menu nobody asked
              // for. The settings open when they are asked for: P, or the gear.
            },
            onLobbyChange: (next) => {
              if (!cancelled) {
                setLobby(next);
              }
            },
            onLockRefused: (reason) => {
              if (!cancelled) {
                setLockRefusal(reason);
              }
            },
            onOpenSettings: () => {
              if (!cancelled) {
                openSettingsRef.current();
              }
            },
          },
          abort.signal,
        );
        if (cancelled) {
          session.stop();
          return;
        }
        sessionRef.current = session;
        session.updateSettings(settingsAtStart.current);
      } catch (cause) {
        if (!cancelled) {
          setStatus({ kind: 'failed', message: describeError(cause, 'Could not start the match.') });
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      abort.abort();
      sessionRef.current?.stop();
      sessionRef.current = null;
    };
  }, [joinArena, matchId, onJoined, password, userId]);

  useEffect(() => {
    const onChange = (): void => {
      const full = document.fullscreenElement !== null;
      setIsFullscreen(full);
      // Only in fullscreen, because that is the only place a browser will hand
      // its shortcuts over. Ctrl+W closing the tab mid-duel is the reason this
      // exists at all.
      if (full) {
        void lockKeyboard(GAME_KEY_CODES);
      } else {
        unlockKeyboard();
      }
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      unlockKeyboard();
    };
  }, []);

  useEffect(
    () => () => {
      if (saveTimer.current !== null) {
        clearTimeout(saveTimer.current);
      }
    },
    [],
  );

  const toggleFullscreen = useCallback((): void => {
    const frame = frameRef.current;
    if (frame === null) {
      return;
    }
    if (document.fullscreenElement === null) {
      void frame.requestFullscreen().catch(() => undefined);
    } else {
      void document.exitFullscreen().catch(() => undefined);
    }
  }, []);


  return (
    <div className="stage">
      <div ref={frameRef} className="stage__frame">
        <div ref={containerRef} className="stage__surface stage__surface--arena" />

        {/* Before the round opens, and only then. There is no pause in this
            game: the opponent is always playing, so nothing that stops the
            player ever claims to have stopped the match. */}
        {status.kind === 'playing' && !settingsOpen && lobby.phase === 'waiting' && (
          <ArenaReadyPanel
            lobby={lobby}
            onReady={toggleReady}
            onOpenSettings={openSettings}
            touchLayout={touchLayout}
          />
        )}

        {/* One line, not a box: the round is running and nothing about it has
            stopped, so nothing here behaves as though it had. It says the one
            thing the player cannot see for themselves — that the mouse is
            theirs and a click gives it back to the game. */}
        {status.kind === 'playing' && !settingsOpen && !holdsPointer && lobby.phase !== 'waiting' && (
          <p className="arena-hint">
            {lockUnreliable
              ? 'This browser keeps giving the pointer back, so the mouse cannot turn the view. Press P for the settings.'
              : lockRefusal === null
                ? 'Click to take the mouse'
                : `This browser would not hide the pointer: ${lockRefusal}`}
          </p>
        )}

        {/* Once it is decided, over the same arena. The round is over and
            nobody is shooting, so this one really can take the screen. */}
        {status.kind === 'playing' && !settingsOpen && lobby.phase === 'finished' && (
          <ArenaResultPanel
            won={lobby.won}
            ownScore={lobby.ownScore}
            opponentScore={lobby.opponentScore}
            opponentName={lobby.opponentName}
          />
        )}

        {settingsOpen && (
          <ArenaSettingsPanel
            settings={settings}
            onChange={applySettings}
            onClose={closeSettings}
            touchLayout={touchLayout}
            live={lobby.phase !== 'waiting'}
          />
        )}
      </div>

      <div className="stage__bar">
        {status.kind === 'connecting' && <p className="hint stage__hint">Joining a match…</p>}
        {status.kind === 'playing' && (
          <p className="hint stage__hint">
            You hold the <strong>{status.seat}</strong> half. Move with the keys, look with the
            mouse, click to fire. <kbd>P</kbd> or <kbd>Esc</kbd> for settings.
          </p>
        )}
        {status.kind === 'reconnecting' && (
          <p className="hint stage__hint">Connection lost. Getting you back in…</p>
        )}
        {status.kind === 'failed' && (
          <p role="alert" className="error stage__hint">
            {status.message}
          </p>
        )}
        <button type="button" className="button" onClick={toggleFullscreen}>
          {isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        </button>
      </div>
    </div>
  );
}

/** The browser-local cache of the settings, and when it was written. */
function readCachedSettings(): unknown {
  try {
    const raw = window.localStorage.getItem(LOCAL_SETTINGS_KEY);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function readCachedTimestamp(): number {
  const cached: unknown = readCachedSettings();
  if (typeof cached !== 'object' || cached === null) {
    return 0;
  }
  const { updatedAt } = cached as { updatedAt?: unknown };
  return typeof updatedAt === 'number' ? updatedAt : 0;
}

function writeCachedSettings(blob: Record<string, unknown>, updatedAt: number): void {
  try {
    window.localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify({ ...blob, updatedAt }));
  } catch {
    // Storage blocked, as it is in private browsing on iOS. The account copy is
    // still written, so the settings survive anyway — one round trip later.
  }
}

export { DEFAULT_ARENA_SETTINGS };
