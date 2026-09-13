import { useCallback, useEffect, useRef, useState } from 'react';
import type { HockeyInput, HockeySnapshot } from '@littlegames/hockey-logic';
import type { HockeyConnection } from '@littlegames/net';
import { useSession } from '../../session/use-session';
import { describeError } from '../../lib/describe-error';
import { HockeyGame } from './hockey-game';
export function HockeyStage({
  matchId,
  password,
  onJoined,
}: {
  readonly matchId: string;
  readonly password?: string | undefined;
  readonly onJoined: (id: string) => void;
}) {
  const { joinHockey } = useSession();
  const connection = useRef<HockeyConnection | null>(null),
    seq = useRef(0),
    shots = useRef(0);
  const [snapshot, setSnapshot] = useState<HockeySnapshot>(),
    [notice, setNotice] = useState<string | null>('Connecting to the rink…');
  useEffect(() => {
    let active = true,
      current: HockeyConnection | null = null;
    void joinHockey(
      {
        onSnapshot(next) {
          if (active) {
            setSnapshot(next);
            setNotice(null);
          }
        },
        onConnectionChange(status) {
          if (active) {
            setNotice(status === 'live' ? null : 'Reconnecting to the rink…');
            seq.current = 0;
            shots.current = 0;
          }
        },
        onError(error) {
          if (active) setNotice(describeError(error, 'The rink could not connect.'));
        },
      },
      matchId,
      password,
    )
      .then((joined) => {
        if (!active) {
          void joined.leave();
          return undefined;
        }
        current = joined;
        connection.current = joined;
        onJoined(joined.matchId);
        return undefined;
      })
      .catch((error) => {
        if (active) setNotice(describeError(error, 'Could not join this rink.'));
      });
    return () => {
      active = false;
      connection.current = null;
      if (current) void current.leave();
    };
  }, [joinHockey, matchId, password, onJoined]);
  const input = useCallback((value: HockeyInput) => {
    if (!connection.current) return;
    if (value.shoot) shots.current++;
    void connection.current
      .send(++seq.current, value.x, value.y, shots.current)
      .catch(() => setNotice('Your connection is interrupted. Reconnecting…'));
  }, []);
  return <HockeyGame snapshot={snapshot} onInput={input} notice={notice} />;
}
