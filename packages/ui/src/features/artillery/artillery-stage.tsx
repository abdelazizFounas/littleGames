import { useEffect, useRef, useState } from 'react';
import { createArtillery, type ArtillerySnapshot, type Action } from '@littlegames/artillery-logic';
import type { ArtilleryConnection } from '@littlegames/net';
import { useSession } from '../../session/use-session';
import { describeError } from '../../lib/describe-error';
import { ArtilleryCommand } from './artillery-command';
export function ArtilleryStage({
  matchId,
  password,
  onJoined,
}: {
  readonly matchId: string;
  readonly password?: string | undefined;
  readonly onJoined: (id: string) => void;
}) {
  const { joinArtillery } = useSession();
  const connection = useRef<ArtilleryConnection | null>(null);
  const [snapshot, setSnapshot] = useState<ArtillerySnapshot>({
    version: 1,
    state: createArtillery(),
    seat: 0,
    names: ['You', 'Waiting for a rival'],
    connected: [true, false],
    remainingSeconds: 30,
  });
  const [link, setLink] = useState('connecting');
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    let active = true,
      current: ArtilleryConnection | null = null;
    void joinArtillery(
      {
        onSnapshot(next) {
          if (active) {
            setSnapshot(next);
            setLink('live');
            setPending(false);
          }
        },
        onRefused(reason) {
          if (active) {
            setNotice(reason);
            setPending(false);
          }
        },
        onConnectionChange(next) {
          if (active) {
            setLink(next);
            setPending(false);
          }
        },
        onError(error) {
          if (active) {
            setNotice(describeError(error, 'Could not connect to the battlefield.'));
            setLink('lost');
          }
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
        if (active) {
          setNotice(describeError(error, 'Could not join the duel.'));
          setLink('lost');
        }
      });
    return () => {
      active = false;
      connection.current = null;
      if (current) void current.leave();
    };
  }, [joinArtillery, matchId, password, onJoined]);
  useEffect(() => {
    if (!pending) return undefined;
    const timer = setTimeout(() => {
      setPending(false);
      setNotice('The action was not confirmed. Check your connection and try again.');
    }, 8000);
    return () => clearTimeout(timer);
  }, [pending]);
  function send(action: Action) {
    if (!connection.current || pending || link !== 'live') return;
    setPending(true);
    setNotice(null);
    void connection.current.act(action, snapshot.state.revision).catch((error) => {
      setPending(false);
      setNotice(describeError(error, 'Could not send that action.'));
    });
  }
  return (
    <ArtilleryCommand
      state={snapshot.state}
      seat={snapshot.seat}
      names={snapshot.names}
      connected={snapshot.connected}
      remainingSeconds={snapshot.remainingSeconds}
      blocked={
        pending ||
        link !== 'live' ||
        (snapshot.state.phase === 'playing' &&
          snapshot.remainingSeconds > snapshot.state.options.turnSeconds)
      }
      notice={
        notice ??
        (link === 'live'
          ? null
          : link === 'connecting'
            ? 'Connecting to the battlefield…'
            : 'Connection interrupted. Reload to rejoin your tank.')
      }
      onAction={send}
    />
  );
}
