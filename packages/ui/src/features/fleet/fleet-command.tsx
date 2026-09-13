import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  canDrop,
  cellsOf,
  cellLabel,
  createDraft,
  draftFleet,
  dropShip,
  heldPlacement,
  rotateDraft,
  shipAtCell,
  shipLength,
  shipName,
  shuffleDraft,
  takeShip,
  type BattleshipView,
  type MarkedShot,
  type Placement,
} from '@littlegames/battleship-logic';
import { useFleetPresentation } from './fleet-presentation';
import { TorpedoEffects } from './torpedo-effects';

export function ShipArt({ ship = 0 }: { readonly ship?: number }) {
  if (ship === 3)
    return (
      <svg viewBox="0 0 200 48" preserveAspectRatio="none" aria-hidden="true">
        <path
          d="M20 24C20 11 47 8 116 8c38 0 68 6 78 16-10 10-40 16-78 16-69 0-96-3-96-16Z"
          fill="#245568"
          stroke="#9bd6cf"
          strokeWidth="2"
        />
        <path fill="none" d="M38 24h125" stroke="#82b3b1" strokeWidth="2" />
        <rect x="84" y="15" width="32" height="18" rx="7" fill="#b4d0c4" />
        <path d="M96 15V9h8M33 13l-15-7v36l15-7" stroke="#a6d4cb" strokeWidth="2" fill="#2b6776" />
        <path fill="none" d="M15 18v12m-6-7h12" stroke="#d6dbae" strokeWidth="3" />
      </svg>
    );
  return (
    <svg viewBox="0 0 200 48" preserveAspectRatio="none" aria-hidden="true">
      <path
        d="M7 10 158 5 194 24 158 43 7 38 17 24Z"
        fill="#123849"
        stroke="#86d5d3"
        strokeWidth="2"
      />
      <path d="m19 15 137-3 36 12-36 12-137-3 9-9Z" fill="#3e8190" />
      <path d="M35 17h94v14H35z" fill="#84b4b3" />
      <path fill="none" d="M48 17v14m25-14v14m25-14v14" stroke="#254e63" strokeWidth="2" />
      {ship === 0 ? (
        <>
          <path fill="none" d="M33 24h114" stroke="#ecdda9" strokeWidth="2" strokeDasharray="9 4" />
          <path d="m85 13 8 11-8 11 2-11Z" fill="#f3eddb" />
        </>
      ) : (
        <>
          <rect x="70" y="12" width="33" height="24" rx="5" fill="#c9ded1" />
          <path fill="none" d="M99 24h35m-85 0h15" stroke="#edf5dc" strokeWidth="4" />
          {ship < 3 && <circle cx="140" cy="24" r="7" fill="#bdcfbb" />}
        </>
      )}
    </svg>
  );
}
function vesselStyle(
  ship: Placement,
  index: number,
): CSSProperties & Record<`--${string}`, number> {
  return {
    '--ship-length': shipLength(index),
    '--ship-column': ship.column,
    '--ship-row': ship.row,
  };
}
function Radar() {
  return (
    <div className="fleet-radar" aria-hidden="true">
      <i />
      <span />
      <b>+</b>
    </div>
  );
}
interface GridProps {
  readonly kind: 'own' | 'enemy';
  readonly ships: readonly (Placement | null)[];
  readonly shots: readonly MarkedShot[];
  readonly selected: number | null;
  readonly preview: readonly number[];
  readonly invalid: boolean;
  readonly interactive: boolean;
  readonly onCell: (cell: number) => void;
  readonly onHover?: (cell: number | null) => void;
}
function OceanGrid({
  kind,
  ships,
  shots,
  selected,
  preview,
  invalid,
  interactive,
  onCell,
  onHover,
}: GridProps) {
  const [focused, setFocused] = useState(0);
  const observed = new Map(shots.map((shot) => [shot.row * 10 + shot.column, shot.result]));
  const occupied = new Map(
    ships.flatMap((ship, index) =>
      ship
        ? cellsOf(ship, shipLength(index)).map(
            (cell) => [cell.row * 10 + cell.column, shipName(index)] as const,
          )
        : [],
    ),
  );
  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    const offset = { ArrowUp: -10, ArrowDown: 10, ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (offset === undefined) return;
    event.preventDefault();
    const next = Math.max(0, Math.min(99, focused + offset));
    setFocused(next);
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-cell="${next}"]`)?.focus();
  }
  return (
    <div className={`fleet-grid fleet-grid--${kind}`}>
      <div className="fleet-grid__letters" aria-hidden="true">
        {'ABCDEFGHIJ'.split('').map((letter) => (
          <span key={letter}>{letter}</span>
        ))}
      </div>
      <div className="fleet-grid__numbers" aria-hidden="true">
        {Array.from({ length: 10 }, (_, index) => (
          <span key={index}>{index + 1}</span>
        ))}
      </div>
      <div
        className="fleet-grid__cells"
        role="group"
        aria-label={kind === 'own' ? 'Your ocean grid' : 'Enemy ocean grid'}
        onKeyDown={navigate}
        onPointerLeave={() => onHover?.(null)}
      >
        {Array.from({ length: 100 }, (_, cell) => {
          const result = observed.get(cell);
          const label = `${kind === 'enemy' ? 'Target' : 'Position'} ${cellLabel(Math.floor(cell / 10), cell % 10)}, ${result ?? occupied.get(cell) ?? 'unexplored'}`;
          return (
            <button
              type="button"
              key={cell}
              data-cell={cell}
              className={`fleet-cell${occupied.has(cell) ? ' fleet-cell--occupied' : ''}${result ? ` fleet-cell--${result}` : ''}${selected === cell ? ' fleet-cell--selected' : ''}${preview.includes(cell) ? (invalid ? ' fleet-cell--invalid' : ' fleet-cell--preview') : ''}`}
              aria-label={label}
              aria-pressed={selected === cell}
              aria-disabled={!interactive || (kind === 'enemy' && !!result)}
              tabIndex={focused === cell ? 0 : -1}
              onFocus={() => {
                setFocused(cell);
                onHover?.(cell);
              }}
              onPointerEnter={() => onHover?.(cell)}
              onClick={() => {
                if (interactive && (kind !== 'enemy' || !result)) onCell(cell);
              }}
            >
              <span>{result === 'miss' ? '·' : result ? '✦' : selected === cell ? '+' : ''}</span>
            </button>
          );
        })}
        <div className="fleet-grid__ships" aria-hidden="true">
          {ships.map(
            (ship, index) =>
              ship && (
                <div
                  key={index}
                  className={`fleet-vessel${cellsOf(ship, shipLength(index)).every((cell) => observed.has(cell.row * 10 + cell.column)) ? ' fleet-vessel--sunk' : ''}${ship.orientation === 'vertical' ? ' fleet-vessel--vertical' : ''}`}
                  style={vesselStyle(ship, index)}
                >
                  <ShipArt ship={index} />
                </div>
              ),
          )}
        </div>
      </div>
    </div>
  );
}
export interface FleetCommandProps {
  readonly view: BattleshipView;
  readonly onConfirm: (fleet: readonly Placement[]) => void;
  readonly onFire: (row: number, column: number) => void;
  readonly blocked?: boolean;
  readonly notice?: string | null;
  readonly opponent?: string;
  readonly overlay?: ReactNode;
  readonly controls?: ReactNode;
  readonly onAnimationChange?: (busy: boolean) => void;
}
export function FleetCommand({
  view: source,
  onConfirm,
  onFire,
  blocked = false,
  notice,
  opponent = 'Opponent',
  overlay,
  controls,
  onAnimationChange,
}: FleetCommandProps) {
  const { view, active, reducedMotion } = useFleetPresentation(source, !!overlay);
  const animating = active !== null;
  useEffect(() => {
    onAnimationChange?.(animating);
  }, [animating, onAnimationChange]);
  const revealedFleet = Array.from(
    { length: 5 },
    (_, index) => view.revealedShips?.find((ship) => ship.index === index)?.placement ?? null,
  );
  const [draft, setDraft] = useState(createDraft);
  const [hover, setHover] = useState<number | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const [placementNotice, setPlacementNotice] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const placing = (view.phase === 'waiting' || view.phase === 'placement') && !view.youAreReady;
  const readyFleet = draftFleet(draft);
  const selectedShot = view.outgoing.some((shot) => shot.row * 10 + shot.column === target);
  const canFire =
    view.phase === 'playing' &&
    view.yourTurn &&
    !blocked &&
    !animating &&
    target !== null &&
    !selectedShot;
  const placement =
    hover === null ? null : heldPlacement(draft, Math.floor(hover / 10), hover % 10);
  const preview =
    placement && draft.held !== null
      ? cellsOf(placement, shipLength(draft.held))
          .filter((cell) => cell.row >= 0 && cell.row < 10 && cell.column >= 0 && cell.column < 10)
          .map((cell) => cell.row * 10 + cell.column)
      : [];
  const invalid = hover !== null && !canDrop(draft, Math.floor(hover / 10), hover % 10);
  const hits = view.outgoing.filter((shot) => shot.result !== 'miss').length;
  const last = view.outgoing.at(-1);
  useEffect(() => {
    const change = () => setFullscreen(document.fullscreenElement === frame.current);
    document.addEventListener('fullscreenchange', change);
    return () => document.removeEventListener('fullscreenchange', change);
  }, []);
  function place(cell: number) {
    const row = Math.floor(cell / 10),
      column = cell % 10;
    if (draft.held !== null) {
      if (!canDrop(draft, row, column)) {
        setPlacementNotice('That ship needs clear water. Try another position or rotate it.');
        return;
      }
      const placed = dropShip(draft, row, column);
      const next = placed.slots.findIndex((ship) => ship === null);
      setDraft(next < 0 ? placed : takeShip(placed, next, 0));
      setPlacementNotice('');
    } else {
      const ship = shipAtCell(draft, row, column);
      if (ship !== null)
        setDraft({
          ...takeShip(draft, ship, 0),
          orientation: draft.slots[ship]?.orientation ?? 'horizontal',
        });
    }
  }
  function rotate() {
    setDraft(rotateDraft);
    setPlacementNotice('');
  }
  const phaseTitle = view.finished
    ? view.youWon
      ? 'The ocean is yours.'
      : 'Your fleet fought bravely.'
    : placing
      ? 'Position your fleet.'
      : view.phase !== 'playing'
        ? 'Fleet deployed. Standing by.'
        : view.yourTurn
          ? 'Your move, commander.'
          : `${opponent} is searching…`;
  return (
    <div
      className="fleet-command"
      ref={frame}
      onKeyDown={(event) => {
        if (placing && !blocked && ['r', 'R', 't', 'T'].includes(event.key)) {
          event.preventDefault();
          rotate();
        }
      }}
    >
      <div inert={!!overlay}>
        <header className="fleet-command__header">
          <div>
            <span className="fleet-kicker">NORTH ATLANTIC · NAVAL OPERATIONS</span>
            <h2>
              Command the waters<span>.</span>
            </h2>
          </div>
          <div className="fleet-header-controls">
            {controls}
            <button
              className="fleet-fullscreen"
              aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              onClick={() => {
                const change = fullscreen
                  ? document.exitFullscreen()
                  : frame.current?.requestFullscreen?.();
                void change?.catch(() =>
                  setPlacementNotice('Fullscreen is unavailable in this browser.'),
                );
              }}
            >
              {fullscreen ? '↙' : '⛶'}
            </button>
          </div>
        </header>
        <div
          className={`fleet-mission${view.yourTurn && view.phase === 'playing' ? ' fleet-mission--active' : ''}`}
        >
          <Radar />
          <div>
            <span className="fleet-kicker">
              {view.finished
                ? 'MISSION COMPLETE'
                : placing
                  ? '01 / DEPLOYMENT'
                  : view.phase === 'playing'
                    ? '02 / ENGAGEMENT'
                    : 'AWAITING ORDERS'}
            </span>
            <h3>{phaseTitle}</h3>
            <p>
              {view.finished
                ? 'Every shot tells a story. Make the next one yours.'
                : placing
                  ? 'Select a ship, then choose its position. Keep all five in your waters.'
                  : view.phase !== 'playing'
                    ? 'The battle begins when both fleets are confirmed.'
                    : view.yourTurn
                      ? 'Select a coordinate and fire. Land a hit to take another shot.'
                      : 'Watch your waters. Your next opening is coming.'}
            </p>
          </div>
          <div className="fleet-mission__stat">
            <strong>
              {view.finished
                ? view.youWon
                  ? 'VICTORY'
                  : 'DEFEAT'
                : placing
                  ? `${draft.slots.filter(Boolean).length}/5`
                  : `${view.opponentShipsSunk}/5`}
            </strong>
            <span>{placing ? 'SHIPS POSITIONED' : 'ENEMY SHIPS SUNK'}</span>
          </div>
        </div>
        {(notice || placementNotice) && (
          <p role="status" className="fleet-notice">
            {notice || placementNotice}
          </p>
        )}
        <div
          data-paused={!!overlay}
          className={`fleet-operations${placing ? ' fleet-operations--deployment' : ''}`}
        >
          {placing ? (
            <section className="fleet-board-card">
              <div className="fleet-board-heading">
                <div>
                  <span className="fleet-kicker">FRIENDLY SECTOR</span>
                  <h3>Your deployment zone</h3>
                </div>
                <span className="fleet-coordinate">
                  {hover === null ? 'A1—J10' : cellLabel(Math.floor(hover / 10), hover % 10)}
                </span>
              </div>
              <OceanGrid
                kind="own"
                ships={draft.slots}
                shots={[]}
                selected={null}
                preview={preview}
                invalid={invalid}
                interactive={!blocked}
                onCell={place}
                onHover={setHover}
              />
              <p className="fleet-board-note">
                {draft.held !== null
                  ? `Placing ${shipName(draft.held)} · ${draft.orientation} · R to rotate`
                  : 'Select a vessel in the dock. Select a placed ship to reposition it.'}
              </p>
            </section>
          ) : (
            <section className="fleet-board-card fleet-board-card--enemy">
              <div className="fleet-board-heading">
                <div>
                  <span className="fleet-kicker">HOSTILE SECTOR</span>
                  <h3>Enemy waters</h3>
                </div>
                <span className="fleet-coordinate">
                  {target === null ? 'NO TARGET' : cellLabel(Math.floor(target / 10), target % 10)}
                </span>
              </div>
              <OceanGrid
                kind="enemy"
                ships={revealedFleet}
                shots={view.outgoing}
                selected={selectedShot ? null : target}
                preview={[]}
                invalid={false}
                interactive={view.yourTurn && !blocked && !animating && !view.finished}
                onCell={setTarget}
              />
              <div className="fleet-fire-control">
                <div>
                  <span className="fleet-kicker">
                    {target === null || selectedShot ? 'SELECT A COORDINATE' : 'TARGET ACQUIRED'}
                  </span>
                  <strong>
                    {target === null || selectedShot
                      ? 'Awaiting target'
                      : `Sector ${cellLabel(Math.floor(target / 10), target % 10)}`}
                  </strong>
                </div>
                <button
                  className="button button--primary"
                  disabled={!canFire}
                  onClick={() => {
                    if (canFire && target !== null) {
                      onFire(Math.floor(target / 10), target % 10);
                      setTarget(null);
                    }
                  }}
                >
                  Fire torpedo ↗
                </button>
              </div>
            </section>
          )}
          {placing ? (
            <aside className="fleet-dock">
              <div className="fleet-board-heading">
                <div>
                  <span className="fleet-kicker">FLEET MANIFEST</span>
                  <h3>Five ships. One mission.</h3>
                </div>
              </div>
              <div className="fleet-dock__ships">
                {Array.from({ length: 5 }, (_, ship) => (
                  <button
                    key={ship}
                    disabled={blocked}
                    className={`fleet-ship-card${draft.held === ship ? ' fleet-ship-card--selected' : ''}`}
                    aria-pressed={draft.held === ship}
                    aria-label={`Select ${shipName(ship)}, ${shipLength(ship)} cells`}
                    onClick={() => {
                      setDraft(takeShip(draft, ship, 0));
                      setPlacementNotice('');
                      setHover(null);
                      if (window.innerWidth < 701)
                        frame.current
                          ?.querySelector('.fleet-grid--own')
                          ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                    }}
                  >
                    <div>
                      <strong>{shipName(ship)}</strong>
                      <span>
                        {draft.held === ship
                          ? 'SELECTED'
                          : draft.slots[ship]
                            ? 'POSITIONED ✓'
                            : `${shipLength(ship)} CELLS`}
                      </span>
                    </div>
                    <ShipArt ship={ship} />
                    <div className="fleet-ship-card__pips" aria-hidden="true">
                      {Array.from({ length: shipLength(ship) }, (_pip, pip) => (
                        <i key={pip} />
                      ))}
                    </div>
                  </button>
                ))}
              </div>
              <div className="fleet-dock__tools">
                <button
                  className="button"
                  disabled={blocked}
                  onClick={() => {
                    setDraft(shuffleDraft(draft));
                    setPlacementNotice('');
                  }}
                >
                  Auto arrange ⤨
                </button>
                <button
                  className="button"
                  disabled={blocked || draft.held === null}
                  onClick={rotate}
                >
                  Rotate ↻
                </button>
                <button
                  className="link-button"
                  disabled={blocked}
                  onClick={() => setDraft(createDraft())}
                >
                  Clear board
                </button>
              </div>
              <button
                className="button button--primary fleet-deploy"
                disabled={blocked || !readyFleet}
                onClick={() => {
                  if (readyFleet) onConfirm(readyFleet);
                }}
              >
                Deploy fleet <span>→</span>
              </button>
              <p className="fleet-board-note">
                Positions lock when you deploy. Your rival cannot see your fleet.
              </p>
            </aside>
          ) : (
            <section className="fleet-board-card">
              <div className="fleet-board-heading">
                <div>
                  <span className="fleet-kicker">FRIENDLY SECTOR</span>
                  <h3>Your waters</h3>
                </div>
                <span className="fleet-coordinate">{5 - view.yourShipsSunk} AFLOAT</span>
              </div>
              <OceanGrid
                kind="own"
                ships={view.yourFleet}
                shots={view.incoming}
                selected={null}
                preview={[]}
                invalid={false}
                interactive={false}
                onCell={() => undefined}
              />
              <div className="fleet-survival">
                {Array.from({ length: 5 }, (_, ship) => {
                  const position = view.yourFleet[ship];
                  const sunk =
                    position &&
                    cellsOf(position, shipLength(ship)).every((cell) =>
                      view.incoming.some(
                        (shot) => shot.row === cell.row && shot.column === cell.column,
                      ),
                    );
                  return (
                    <span className={sunk ? 'is-sunk' : ''} key={ship}>
                      {shipName(ship)}
                      <b>{sunk ? 'SUNK' : 'AFLOAT'}</b>
                    </span>
                  );
                })}
              </div>
            </section>
          )}
          {active && (
            <TorpedoEffects
              event={active}
              frame={frame}
              reducedMotion={reducedMotion}
              paused={!!overlay}
            />
          )}
        </div>
        <footer className="fleet-telemetry">
          <div>
            <span className="fleet-kicker">SHOTS FIRED</span>
            <strong>{String(view.outgoing.length).padStart(2, '0')}</strong>
          </div>
          <div>
            <span className="fleet-kicker">DIRECT HITS</span>
            <strong>{String(hits).padStart(2, '0')}</strong>
          </div>
          <div className="fleet-last-shot" role="status">
            <span className="fleet-kicker">LAST TRANSMISSION</span>
            <strong>
              {last
                ? `${cellLabel(last.row, last.column)} · ${last.result === 'miss' ? 'Open water' : last.result === 'sunk' ? 'Enemy vessel sunk' : 'Direct hit. Fire again.'}`
                : 'Sonar online. Waters uncharted.'}
            </strong>
          </div>
          <div className="fleet-legend">
            <span>
              <i /> Miss
            </span>
            <span>
              <i /> Hit
            </span>
          </div>
        </footer>
      </div>
      {overlay}
    </div>
  );
}
