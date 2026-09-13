import {
  createInitialState,
  startPlacement,
  placeFleet,
  randomFleet,
  fire,
  sunkCount,
  type BattleshipState,
  type BattleshipView,
  type MarkedShot,
  type Placement,
  type Side,
  type Shot,
} from '@littlegames/battleship-logic';
export interface FleetPracticeRound {
  readonly state: BattleshipState;
  readonly incoming: readonly MarkedShot[];
  readonly outgoing: readonly MarkedShot[];
}
export function createFleetRound(random: () => number = Math.random): FleetPracticeRound {
  return {
    state: placeFleet(startPlacement(createInitialState()), 'b', randomFleet(random)).state,
    incoming: [],
    outgoing: [],
  };
}
export function deployPracticeFleet(
  round: FleetPracticeRound,
  fleet: readonly Placement[],
): FleetPracticeRound {
  return { ...round, state: placeFleet(round.state, 'a', fleet).state };
}
export function firePracticeShot(
  round: FleetPracticeRound,
  side: Side,
  shot: Shot,
): FleetPracticeRound {
  const outcome = fire(round.state, side, shot);
  if (outcome.problem || !outcome.result) return round;
  const history = side === 'a' ? 'outgoing' : 'incoming';
  return {
    ...round,
    state: outcome.state,
    [history]: [...round[history], { ...shot, result: outcome.result }],
  };
}
/** The visual component never receives the opponent's hidden fleet. */
export function practiceFleetView(round: FleetPracticeRound): BattleshipView {
  return {
    phase: round.state.phase,
    yourTurn: round.state.turn === 'a',
    yourFleet: round.state.boards.a.fleet,
    incoming: round.incoming,
    outgoing: round.outgoing,
    youAreReady: round.state.boards.a.ready,
    opponentReady: true,
    opponentPresent: true,
    yourShipsSunk: sunkCount(round.state.boards.a),
    opponentShipsSunk: sunkCount(round.state.boards.b),
    finished: round.state.phase === 'finished',
    youWon: round.state.winner === 'a',
    draft: null,
    pointer: null,
  };
}
