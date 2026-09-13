import type { BattleshipView, MarkedShot, Placement } from '@littlegames/battleship-logic';
import {
  BattleshipOrientation,
  BattleshipPhase,
  BattleshipShotResult,
  type BattleshipSnapshot,
} from '@littlegames/core';
export function emptyFleetView(): BattleshipView {
  return {
    phase: 'waiting',
    yourTurn: false,
    yourFleet: [],
    incoming: [],
    outgoing: [],
    youAreReady: false,
    opponentReady: false,
    opponentPresent: false,
    yourShipsSunk: 0,
    opponentShipsSunk: 0,
    finished: false,
    youWon: false,
    draft: null,
    pointer: null,
  };
}
const shot = (item: BattleshipSnapshot['incoming'][number]): MarkedShot => ({
  row: item.row,
  column: item.column,
  result:
    item.result === BattleshipShotResult.SHOT_RESULT_SUNK
      ? 'sunk'
      : item.result === BattleshipShotResult.SHOT_RESULT_HIT
        ? 'hit'
        : 'miss',
});
export function fleetView(snapshot: BattleshipSnapshot): BattleshipView {
  const yourFleet: Placement[] = snapshot.yourFleet.map((ship) => ({
    row: ship.row,
    column: ship.column,
    orientation:
      ship.orientation === BattleshipOrientation.ORIENTATION_VERTICAL ? 'vertical' : 'horizontal',
  }));
  return {
    ...emptyFleetView(),
    phase:
      snapshot.phase === BattleshipPhase.PHASE_FINISHED
        ? 'finished'
        : snapshot.phase === BattleshipPhase.PHASE_PLAYING
          ? 'playing'
          : snapshot.phase === BattleshipPhase.PHASE_PLACEMENT
            ? 'placement'
            : 'waiting',
    yourTurn: snapshot.yourTurn,
    yourFleet,
    revealedShips: snapshot.revealedShips.flatMap(({ index, placement }) =>
      placement && index < 5 && placement.row < 10 && placement.column < 10
        ? [
            {
              index,
              placement: {
                row: placement.row,
                column: placement.column,
                orientation:
                  placement.orientation === BattleshipOrientation.ORIENTATION_VERTICAL
                    ? ('vertical' as const)
                    : ('horizontal' as const),
              },
            },
          ]
        : [],
    ),
    incoming: snapshot.incoming.map(shot),
    outgoing: snapshot.outgoing.map(shot),
    youAreReady: snapshot.youAreReady,
    opponentReady: snapshot.opponentReady,
    opponentPresent: snapshot.opponentPresent,
    yourShipsSunk: snapshot.yourShipsSunk,
    opponentShipsSunk: snapshot.opponentShipsSunk,
    finished: snapshot.finished,
    youWon: snapshot.youWon,
  };
}
