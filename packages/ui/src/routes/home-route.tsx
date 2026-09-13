import { useState } from 'react';
import { Link } from 'react-router';
import { GameArt } from '../components/game-art';
import { GAMES } from '../features/catalog/games';
import { ResumePanel } from '../features/catalog/resume-panel';
import { useSession } from '../session/use-session';

export function HomeRoute() {
  const { state } = useSession();
  const [filter, setFilter] = useState('All games');
  const [query, setQuery] = useState('');
  const games = GAMES.filter(
    (game) =>
      (filter === 'All games' || game.genre === filter) &&
      `${game.name} ${game.description} ${game.label}`
        .toLocaleLowerCase('en')
        .includes(query.toLocaleLowerCase('en')),
  );
  return (
    <div className="home">
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero__copy">
          <p className="eyebrow">
            <span className="status-dot" /> SMALL GAMES. BIG RIVALRIES.
          </p>
          <h1 id="hero-title">
            A little break.
            <br />A <em>big</em>
            <br />
            rematch<span className="lime">.</span>
          </h1>
          <p className="hero__description">
            Challenge your friends, sharpen your reflexes, and lose track of time. Your next great
            game starts here.
          </p>
          <div className="hero__actions">
            <a className="button button--primary" href="#games">
              Find your game <span>↗</span>
            </a>
            <Link className="text-link" to="/practice/arena">
              Try solo practice <span>→</span>
            </Link>
          </div>
          <div className="hero__perks">
            <span>✓ Free to play</span>
            <span>✓ No downloads</span>
            <span>✓ In your browser</span>
          </div>
        </div>
        <Link
          to="/practice/arena"
          className="hero__visual"
          aria-label="Try Rift Arena in practice mode"
        >
          <GameArt game="arena" hero />
          <div className="hero__sticker">
            YOUR
            <br />
            MOVE <span>↗</span>
          </div>
          <span className="hero__badge">
            <span className="status-dot" /> MEET YOUR NEXT OBSESSION
          </span>
          <div className="hero__caption">
            <div>
              <span>A DIFFERENT KIND OF HIGH GROUND</span>
              <strong>Rift Arena</strong>
            </div>
            <span className="round-arrow">↗</span>
          </div>
        </Link>
      </section>
      <div className="ticker" aria-hidden="true">
        <span>ONE LINK. ONE FRIEND. GAME ON.</span>
        <b>✳</b>
        <span>GOOD OLD-FASHIONED FUN.</span>
        <b>✳</b>
        <span>JUST ONE MORE ROUND?</span>
        <b>✳</b>
      </div>
      <section className="catalog-section" id="games" aria-labelledby="catalog-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">PICK YOUR PLAYGROUND</p>
            <h2 id="catalog-title">
              A game for every mood<span className="lime">.</span>
            </h2>
          </div>
          <span className="small-label">05 GAMES · ENDLESS REMATCHES</span>
        </div>
        {state.status === 'signed-in' && <ResumePanel />}
        <div className="catalog-toolbar">
          <div className="filter-tabs" role="group" aria-label="Filter games">
            {['All games', 'Action', 'Arcade', 'Strategy'].map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={filter === item}
                onClick={() => setFilter(item)}
              >
                {item}
              </button>
            ))}
          </div>
          <label className="search-field">
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find a game…"
              aria-label="Search games"
            />
          </label>
        </div>
        <div className="catalog-grid">
          {games.map((game) => (
            <article className={`cover-card cover-card--${game.color}`} key={game.id}>
              <Link
                to={`/games/${game.id}`}
                className="cover-card__art"
                aria-label={`Discover ${game.name}`}
              >
                <GameArt game={game.id} />
                <span className="cover-card__number">0{GAMES.indexOf(game) + 1}</span>
                <span className="cover-card__mode">2 PLAYERS</span>
                <span className="cover-card__play">↗</span>
              </Link>
              <div className="cover-card__body">
                <p className="eyebrow">{game.label}</p>
                <h3>
                  <Link to={`/games/${game.id}`}>{game.name}</Link>
                </h3>
                <p>{game.description}</p>
                <div className="cover-card__bottom">
                  <span>◷ {game.duration}</span>
                  <Link to={`/games/${game.id}`}>
                    Play <span>→</span>
                  </Link>
                </div>
              </div>
            </article>
          ))}
        </div>
        {games.length === 0 && (
          <div className="empty-state">
            <h3>No games match your search.</h3>
            <button
              className="button"
              onClick={() => {
                setFilter('All games');
                setQuery('');
              }}
            >
              Show all games
            </button>
          </div>
        )}
      </section>
      <section className="friend-banner">
        <span className="friend-banner__symbol" aria-hidden="true">
          ✳
        </span>
        <div>
          <p className="eyebrow">YOUR BEST RIVAL? YOUR BEST FRIEND.</p>
          <h2>
            Good rivalries
            <br />
            go the distance.
          </h2>
          <p>Create a lobby. Share a link. We’ll bring the playground.</p>
        </div>
        <Link className="button" to="/guide">
          How it works <span>↗</span>
        </Link>
      </section>
      <section className="steps-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">LESS WAITING. MORE PLAYING.</p>
            <h2>Three steps. Zero fuss.</h2>
          </div>
        </div>
        <div className="steps-grid">
          {[
            [
              '01',
              'Find your match',
              'Action, reflexes, or strategy. There’s a little challenge for every kind of player.',
            ],
            [
              '02',
              'Bring your rival',
              'Jump in as a guest, open a lobby, and send the link to a friend.',
            ],
            [
              '03',
              'Run it back',
              'Simple rules. Short rounds. The hard part is knowing when to stop.',
            ],
          ].map(([n, title, text]) => (
            <div key={n}>
              <span className="step-number">{n}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          ))}
        </div>
      </section>
      <div className="home-note">
        <span>MADE FOR THE JOY OF PLAYING.</span>
        <span>No installation. Just a good connection and a competitive streak.</span>
      </div>
    </div>
  );
}
