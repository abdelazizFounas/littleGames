import { useEffect, useRef, useState } from 'react';
import type { Placement } from '@littlegames/battleship-logic';
import { BattleshipOrientation } from '@littlegames/core';
import type { BattleshipConnection } from '@littlegames/net';
import { useSession } from '../../session/use-session';
import { describeError } from '../../lib/describe-error';
import { FleetCommand } from '../fleet/fleet-command';
import { emptyFleetView, fleetView } from '../fleet/fleet-view';

export function BattleshipStage({
  matchId,
  password,
  onJoined,
}: {
  readonly matchId: string;
  readonly password?: string | undefined;
  readonly onJoined: (matchId: string) => void;
}) {
  const { joinBattleship } = useSession();
  const connection = useRef<BattleshipConnection | null>(null);
  const [view, setView] = useState(emptyFleetView);
  const [link, setLink] = useState('connecting');
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [queued, setQueued] = useState<readonly Placement[] | null>(null);
  const sending = useRef(false);
  const latest = useRef(view);
  const waitingFleet = useRef<readonly Placement[] | null>(null);
  const flush = useRef<() => void>(() => undefined);
  useEffect(() => {
    let active = true;
    let current: BattleshipConnection | null = null;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let firstSnapshot = false;
    setLink('connecting');
    flush.current = () => {
      const fleet = waitingFleet.current;
      if (
        !current ||
        !fleet ||
        sending.current ||
        latest.current.phase !== 'placement' ||
        latest.current.youAreReady
      )
        return;
      sending.current = true;
      void current
        .placeFleet(
          fleet.map((ship) => ({
            row: ship.row,
            column: ship.column,
            orientation:
              ship.orientation === 'vertical'
                ? BattleshipOrientation.ORIENTATION_VERTICAL
                : BattleshipOrientation.ORIENTATION_HORIZONTAL,
          })),
        )
        .catch((cause) => {
          if (!active) return;
          sending.current = false;
          waitingFleet.current = null;
          setQueued(null);
          setNotice(describeError(cause, 'Could not deploy your fleet. Please try again.'));
        });
    };
    void joinBattleship(
      {
        onSnapshot(snapshot) {
          if (!active) return;
          firstSnapshot = true;
          clearTimeout(deadline);
          const next = fleetView(snapshot);
          latest.current = next;
          setView(next);
          setLink('live');
          setPending(false);
          if (next.youAreReady) {
            waitingFleet.current = null;
            setQueued(null);
            sending.current = false;
          }
          flush.current();
        },
        onRefused(reason) {
          if (active) {
            sending.current = false;
            waitingFleet.current = null;
            setQueued(null);
            setPending(false);
            setNotice(reason);
          }
        },
        onConnectionChange(status) {
          if (active) {
            setLink(status);
            sending.current = false;
            setPending(false);
            if (status === 'live') flush.current();
          }
        },
        onError(cause) {
          if (active) {
            setNotice(describeError(cause, 'The connection ran into an error.'));
            setLink('lost');
          }
        },
      },
      matchId,
      password ?? '',
    )
      .then((joined) => {
        if (!active) {
          void joined.leave();
          return undefined;
        }
        current = joined;
        connection.current = joined;
        onJoined(joined.matchId);
        flush.current();
        if (!firstSnapshot)
          deadline = setTimeout(() => {
            if (active) {
              setLink('lost');
              setNotice('The game did not send its state. Reload to reconnect.');
            }
          }, 10000);
        return undefined;
      })
      .catch((cause) => {
        if (active) {
          setLink('lost');
          setNotice(describeError(cause, 'Could not join this fleet battle.'));
        }
      });
    return () => {
      active = false;
      clearTimeout(deadline);
      flush.current = () => undefined;
      connection.current = null;
      if (current) void current.leave();
    };
  }, [joinBattleship, matchId, password, onJoined]);
  useEffect(() => {
    if (!pending) return undefined;
    const timeout = setTimeout(() => {
      setPending(false);
      setNotice('Your shot was not confirmed. Check your connection and try again.');
    }, 8000);
    return () => clearTimeout(timeout);
  }, [pending]);
  const visible = queued ? { ...view, youAreReady: true, yourFleet: queued } : view;
  return (
    <div className="stage fleet-online">
      <FleetCommand
        view={visible}
        blocked={link !== 'live' || pending || !!queued}
        notice={
          notice ??
          (link === 'connecting'
            ? 'Connecting to command…'
            : link === 'reconnecting'
              ? 'Reconnecting. Your fleet is safe.'
              : link === 'lost'
                ? 'Connection lost. Reload to rejoin.'
                : null)
        }
        onConfirm={(fleet) => {
          waitingFleet.current = fleet;
          setQueued(fleet);
          setNotice(null);
          flush.current();
        }}
        onFire={(row, column) => {
          if (!connection.current || pending || !view.yourTurn) return;
          setPending(true);
          setNotice(null);
          void connection.current.fire(row, column).catch((cause) => {
            setPending(false);
            setNotice(describeError(cause, 'Could not fire. Try again.'));
          });
        }}
      />
    </div>
  );
}
