import type { ReactNode } from 'react';
import type { ArenaLobbyState } from './arena-session';

/**
 * The panel over the arena before the round opens.
 *
 * Nobody is dropped into a duel they were not looking at: the countdown waits
 * until both players have said they are ready, and until then this is what they
 * see — over the arena, with the arena itself still being drawn behind it. It is
 * also where the settings are reached, so a player can tune their sensitivity
 * before it matters rather than after being shot for it.
 */
export function ArenaReadyPanel({
  lobby,
  onReady,
  onOpenSettings,
  touchLayout,
}: {
  readonly lobby: ArenaLobbyState;
  readonly onReady: () => void;
  readonly onOpenSettings: () => void;
  /** A phone has no Escape key, so it is not told to press one. */
  readonly touchLayout: boolean;
}): ReactNode {
  const waitingForOpponent = !lobby.opponentPresent;
  const opponentStatus = waitingForOpponent
    ? 'Nobody has taken the other half yet.'
    : lobby.opponentReady
      ? `${lobby.opponentName} is ready.`
      : `${lobby.opponentName} is still getting ready.`;

  return (
    <div className="arena-panel" role="dialog" aria-label="Ready to start">
      <div className="arena-panel__card">
        <h2 className="arena-panel__title">
          {lobby.youAreReady ? 'Waiting for your opponent' : 'Ready when you are'}
        </h2>
        <p className="arena-panel__status">{opponentStatus}</p>

        <div className="arena-panel__actions">
          <button
            type="button"
            className={`button ${lobby.youAreReady ? '' : 'button--primary'}`}
            onClick={onReady}
          >
            {lobby.youAreReady ? 'Not ready after all' : 'Ready'}
          </button>
          <button type="button" className="button" onClick={onOpenSettings}>
            Settings
          </button>
        </div>

        <p className="arena-panel__hint">
          {touchLayout ? (
            <>
              Once you are both ready, a three-second countdown opens the round. One half of the
              screen moves you and the other turns the view — wherever your thumb lands is the
              middle. The gear opens the settings.
            </>
          ) : (
            <>
              Clicking <strong>Ready</strong> also takes the mouse. Once you both are, a
              three-second countdown opens the round. <kbd>P</kbd> or <kbd>Esc</kbd> brings the
              settings back at any time.
            </>
          )}
        </p>
      </div>
    </div>
  );
}
