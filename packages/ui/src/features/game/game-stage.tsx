import type { ReactNode } from 'react';
import { ArenaStage } from './arena-stage';
import { BattleshipStage } from './battleship-stage';
import { PongStage } from './pong-stage';

/**
 * Which screen a given game is played on.
 *
 * Everything up to this point — the catalogue, the lobbies, the passwords, the
 * invitations, the resume list — is the same code for every game. This is where
 * they part company, and it is deliberately the only place they do.
 *
 * The catalogue lives in storage and can be edited without a redeployment, so
 * an id can arrive here that this build has no screen for. Saying so plainly
 * beats a blank box, and beats quietly starting a different game.
 */
export function GameStage({
  gameId,
  userId,
  matchId,
  password,
  onJoined,
}: {
  readonly gameId: string;
  readonly userId: string;
  readonly matchId: string;
  readonly password?: string | undefined;
  readonly onJoined: (matchId: string) => void;
}): ReactNode {
  if (gameId === 'battleship') {
    // No user id: every snapshot is built for its recipient alone, so this
    // client never has to find itself in a broadcast meant for both players.
    return <BattleshipStage matchId={matchId} password={password} onJoined={onJoined} />;
  }

  if (gameId === 'arena') {
    return (
      <ArenaStage userId={userId} matchId={matchId} password={password} onJoined={onJoined} />
    );
  }

  if (gameId === 'pong') {
    return (
      <PongStage userId={userId} matchId={matchId} password={password} onJoined={onJoined} />
    );
  }

  return (
    <p role="alert" className="error">
      This version of the site has no screen for that game yet.
    </p>
  );
}
