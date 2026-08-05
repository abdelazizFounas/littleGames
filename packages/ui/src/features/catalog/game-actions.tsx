import type { LobbySummary } from '@littlegames/net';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useAsyncAction } from '../../lib/use-async-action';
import { useSession } from '../../session/use-session';

type Panel = 'none' | 'create' | 'list';

/**
 * The three ways into a game.
 *
 * Every one of them resolves a lobby first and then navigates to it, so the
 * game screen is never reached without knowing which match it is for. Landing
 * there and being put into whatever was lying around is how a player ends up in
 * a stranger's game, or back in one that is already over.
 */
export function GameActions({ gameId }: { readonly gameId: string }): ReactNode {
  const { findOpenLobby, openLobby, listOpenLobbies, checkLobby } = useSession();
  const navigate = useNavigate();
  const action = useAsyncAction('That did not work.');
  const [panel, setPanel] = useState<Panel>('none');
  const [password, setPassword] = useState('');
  const [lobbies, setLobbies] = useState<LobbySummary[]>([]);
  const [challenged, setChallenged] = useState<LobbySummary | null>(null);
  const [entry, setEntry] = useState('');

  const enter = (matchId: string, key: string): void => {
    const query = new URLSearchParams({ match: matchId });
    if (key !== '') {
      query.set('key', key);
    }
    void navigate(`/games/${gameId}?${query.toString()}`);
  };

  return (
    <div className="game-actions">
      <div className="actions">
        <button
          type="button"
          className="button button--primary"
          disabled={action.pending}
          onClick={() => {
            action.run(async () => {
              enter(await findOpenLobby(gameId), '');
            });
          }}
        >
          Quick game
        </button>
        <button
          type="button"
          className="button"
          onClick={() => {
            setPanel(panel === 'create' ? 'none' : 'create');
          }}
        >
          Create lobby
        </button>
        <button
          type="button"
          className="button"
          disabled={action.pending}
          onClick={() => {
            setPanel('list');
            setChallenged(null);
            action.run(async () => {
              setLobbies(await listOpenLobbies(gameId));
            });
          }}
        >
          List lobbies
        </button>
      </div>

      {action.error !== null && (
        <p role="alert" className="error">
          {action.error}
        </p>
      )}

      {panel === 'create' && (
        <form
          className="form"
          onSubmit={(event) => {
            event.preventDefault();
            action.run(async () => {
              const matchId = await openLobby(gameId, password);
              enter(matchId, password);
            });
          }}
        >
          <label className="field">
            <span>Password — leave empty to let anyone in</span>
            <input
              type="text"
              autoComplete="off"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
              }}
            />
          </label>
          <button type="submit" className="button" disabled={action.pending}>
            {action.pending ? 'Opening…' : 'Open the lobby'}
          </button>
        </form>
      )}

      {panel === 'list' && (
        <div className="form">
          <h2>Waiting for an opponent</h2>
          {lobbies.length === 0 ? (
            <p className="hint">No lobby is waiting. Open one and share the link.</p>
          ) : (
            <ul className="lobby-list">
              {lobbies.map((lobby) => (
                <li key={lobby.matchId}>
                  <span className="lobby-list__host">{lobby.host}</span>
                  <span className="lobby-list__meta">{lobby.locked ? 'password' : 'open'}</span>
                  <button
                    type="button"
                    className="button"
                    onClick={() => {
                      if (lobby.locked) {
                        setEntry('');
                        setChallenged(lobby);
                        return;
                      }
                      enter(lobby.matchId, '');
                    }}
                  >
                    Join
                  </button>
                </li>
              ))}
            </ul>
          )}

          {challenged !== null && (
            <form
              className="form"
              onSubmit={(event) => {
                event.preventDefault();
                // Asked here so a wrong password is answered on this screen.
                // The door is still checked when the socket joins; this only
                // saves building a game nobody is getting into.
                action.run(async () => {
                  await checkLobby(challenged.matchId, entry);
                  enter(challenged.matchId, entry);
                });
              }}
            >
              <label className="field">
                <span>Password for {challenged.host}&apos;s lobby</span>
                <input
                  type="password"
                  autoComplete="off"
                  required
                  value={entry}
                  onChange={(event) => {
                    setEntry(event.target.value);
                  }}
                />
              </label>
              <button type="submit" className="button" disabled={action.pending}>
                {action.pending ? 'Checking…' : 'Enter'}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
