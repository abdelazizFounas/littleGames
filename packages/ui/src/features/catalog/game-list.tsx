import type { ReactNode } from 'react';
import { GameActions } from './game-actions';
import { useCatalog } from './use-catalog';

function playerCount(minPlayers: number, maxPlayers: number): string {
  return minPlayers === maxPlayers
    ? `${String(minPlayers)} players`
    : `${String(minPlayers)}–${String(maxPlayers)} players`;
}

export function GameList(): ReactNode {
  const catalog = useCatalog();

  if (catalog.status === 'loading') {
    return <p className="hint">Loading games…</p>;
  }

  if (catalog.status === 'failed') {
    return (
      <p role="alert" className="error">
        {catalog.error}
      </p>
    );
  }

  if (catalog.data.length === 0) {
    // Reachable when the catalogue collection is empty, which means the server
    // seeded nothing. Saying so beats an unexplained blank area.
    return <p className="hint">No games are available yet.</p>;
  }

  return (
    <ul className="game-list">
      {catalog.data.map((game) => (
        <li key={game.id} className="game-card">
          <span className="game-card__name">{game.name}</span>
          <span className="game-card__tagline">{game.tagline}</span>
          <span className="game-card__meta">{playerCount(game.minPlayers, game.maxPlayers)}</span>
          <GameActions gameId={game.id} />
        </li>
      ))}
    </ul>
  );
}
