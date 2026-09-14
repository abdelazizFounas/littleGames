import type { Client, Session } from '@heroiclabs/nakama-js';
import { isHockeySnapshot, type HockeySnapshot } from '@littlegames/hockey-logic';
import { openMatchSocket, type ConnectionState } from './match-socket';
import type { NakamaConfig } from './config';
export interface HockeyConnection {
  matchId: string;
  send: (seq: number, x: number, y: number, shots: number, charging: boolean) => Promise<void>;
  leave: () => Promise<void>;
}
export interface HockeyListeners {
  onSnapshot: (snapshot: HockeySnapshot) => void;
  onConnectionChange: (status: ConnectionState) => void;
  onError: (error: unknown) => void;
}
export async function joinHockeyMatch(
  client: Client,
  config: NakamaConfig,
  session: Session,
  matchId: string,
  listeners: HockeyListeners,
  password = '',
): Promise<HockeyConnection> {
  const socket = await openMatchSocket(
    client,
    config,
    session,
    matchId,
    {
      onConnectionChange: listeners.onConnectionChange,
      onError: listeners.onError,
      onData(opcode, data) {
        if (opcode !== 3) return;
        try {
          const value: unknown = JSON.parse(new TextDecoder().decode(data));
          if (!isHockeySnapshot(value))
            throw new Error('Invalid hockey snapshot. Reload to update.');
          listeners.onSnapshot(value);
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
    send: (seq, x, y, shots, charging) =>
      socket.send(
        1,
        new TextEncoder().encode(JSON.stringify({ version: 2, seq, x, y, shots, charging })),
      ),
  };
}
