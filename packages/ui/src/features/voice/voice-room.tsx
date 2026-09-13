import { useEffect, useRef, useState } from 'react';
import { useSession } from '../../session/use-session';
import { createVoiceSession, type RemoteVoice, type VoiceSession } from './voice-session';
export function VoiceRoom({ matchId }: { readonly matchId: string }) {
  const { voiceRoom } = useSession();
  const session = useRef<VoiceSession | null>(null);
  const [status, setStatus] = useState<'off' | 'joining' | 'on'>('off');
  const [muted, setMuted] = useState(false);
  const [members, setMembers] = useState<RemoteVoice[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(
    () => () => {
      session.current?.leave();
      session.current = null;
    },
    [matchId],
  );
  function leave() {
    session.current?.leave();
    session.current = null;
    setStatus('off');
    setMembers([]);
    setMuted(false);
  }
  return (
    <section className="voice-room" aria-label="Match voice chat">
      <div>
        <p className="eyebrow">MATCH VOICE</p>
        <h3>{status === 'on' ? 'Your rival, a little closer.' : 'Talk through the rivalry.'}</h3>
        <p className="hint">
          Optional voice chat for this match. Your microphone starts only when you join.
        </p>
      </div>
      <div className="voice-room__actions">
        {status === 'off' ? (
          <button
            className="button"
            onClick={() => {
              setError(null);
              setStatus('joining');
              session.current = createVoiceSession(matchId, voiceRoom, {
                onReady: () => setStatus('on'),
                onMembers: setMembers,
                onWarning: setError,
                onError: (message) => {
                  setError(message);
                  setStatus('off');
                  setMembers([]);
                  setMuted(false);
                },
              });
            }}
          >
            Join voice 🎙
          </button>
        ) : (
          <>
            <button
              className="button"
              disabled={status === 'joining'}
              aria-pressed={muted}
              onClick={() => {
                session.current?.mute(!muted);
                setMuted(!muted);
              }}
            >
              {muted ? 'Unmute microphone' : 'Mute microphone'}
            </button>
            <button className="button" onClick={leave}>
              {status === 'joining' ? 'Cancel connection' : 'Leave voice'}
            </button>
          </>
        )}
      </div>
      {status === 'joining' && <p role="status">Connecting your microphone…</p>}
      {status === 'on' && members.length === 0 && (
        <p role="status" className="hint">
          You are in voice. Waiting for another player to join.
        </p>
      )}
      {members.length > 0 && (
        <ul className="voice-room__members">
          {members.map((member) => (
            <li key={member.userId}>
              <span>● {member.name}</span>
              <button
                className="button"
                aria-label={`${member.muted ? 'Unmute' : 'Mute'} ${member.name}`}
                aria-pressed={member.muted}
                onClick={() => session.current?.muteRemote(member.userId, !member.muted)}
              >
                {member.muted ? 'Unmute player' : 'Mute player'}
              </button>
              {!member.playing && (
                <button
                  className="button"
                  onClick={() => session.current?.resumeRemote(member.userId)}
                >
                  Enable audio
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
