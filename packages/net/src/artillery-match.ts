import type { Client, Session } from '@heroiclabs/nakama-js';
import {
  isArtillerySnapshot,
  type ArtillerySnapshot,
  type Action,
} from '@littlegames/artillery-logic';
import type { NakamaConfig } from './config';
import { openMatchSocket, type ConnectionState } from './match-socket';
export interface ArtilleryMatchListeners {
  onSnapshot: (snapshot: ArtillerySnapshot) => void;
  onRefused: (reason: string) => void;
  onConnectionChange: (state: ConnectionState) => void;
  onError: (error: unknown) => void;
}
export interface ArtilleryConnection {
  matchId: string;
  act: (action: Action, revision: number) => Promise<void>;
  leave: () => Promise<void>;
}
export async function joinArtilleryMatch(
  client: Client,
  config: NakamaConfig,
  session: Session,
  matchId: string,
  listeners: ArtilleryMatchListeners,
  password = '',
): Promise<ArtilleryConnection> {
  const socket = await openMatchSocket(
    client,
    config,
    session,
    matchId,
    {
      onConnectionChange: listeners.onConnectionChange,
      onError: listeners.onError,
      onData(opcode, data) {
        try {
          const value: unknown = JSON.parse(new TextDecoder().decode(data));
          if (opcode === 3) {
            if (!isArtillerySnapshot(value))
              throw new Error('Unsupported artillery snapshot. Reload to update the game.');
            listeners.onSnapshot(value);
          } else if (
            opcode === 4 &&
            typeof value === 'object' &&
            value !== null &&
            'reason' in value &&
            typeof value.reason === 'string'
          )
            listeners.onRefused(value.reason);
        } catch (error) {
          listeners.onError(error);
        }
      },
    },
    password,
  );
  return {
    matchId: socket.matchId,
    leave: socket.leave,
    act: (action, revision) =>
      socket.send(
        1,
        new TextEncoder().encode(JSON.stringify({ version: 1, action: { ...action, revision } })),
      ),
  };
}
