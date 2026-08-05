import type { ReactNode } from 'react';
import { Link } from 'react-router';
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
        <li key={game.id}>
          <Link className="game-card" to={`/games/${game.id}`}>
            <span className="game-card__name">{game.name}</span>
            <span className="game-card__tagline">{game.tagline}</span>
            <span className="game-card__meta">{playerCount(game.minPlayers, game.maxPlayers)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
