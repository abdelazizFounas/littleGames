import type { Peer, MediaConnection } from 'peerjs';
import type { VoiceMember } from '@littlegames/net';
export interface RemoteVoice extends VoiceMember {
  muted: boolean;
  playing: boolean;
  audio: HTMLAudioElement;
}
export interface VoiceSession {
  leave: () => void;
  mute: (muted: boolean) => void;
  muteRemote: (id: string, muted: boolean) => void;
  resumeRemote: (id: string) => void;
}
export function createVoiceSession(
  matchId: string,
  room: (match: string, action: 'join' | 'poll' | 'leave', peer: string) => Promise<VoiceMember[]>,
  listeners: {
    onReady: () => void;
    onMembers: (members: RemoteVoice[]) => void;
    onError: (message: string) => void;
    onWarning: (message: string) => void;
  },
): VoiceSession {
  const id = `lg-${crypto.randomUUID()}`;
  let peer: Peer | null = null,
    stream: MediaStream | null = null,
    stopped = false,
    joined = false,
    muted = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let openingTimer: ReturnType<typeof setTimeout> | undefined;
  let roster: VoiceMember[] = [];
  const calls = new Map<string, MediaConnection>(),
    remotes = new Map<string, RemoteVoice>(),
    mutedUsers = new Set<string>();
  const emit = () => {
    if (!stopped) listeners.onMembers([...remotes.values()]);
  };
  function remove(peerId: string) {
    const remote = remotes.get(peerId);
    if (remote) {
      remote.audio.pause();
      remote.audio.srcObject = null;
      remotes.delete(peerId);
    }
    const call = calls.get(peerId);
    calls.delete(peerId);
    call?.close();
    emit();
  }
  function leave() {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    clearTimeout(openingTimer);
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    for (const peerId of calls.keys()) remove(peerId);
    peer?.destroy();
    peer = null;
    if (joined) void room(matchId, 'leave', id).catch(() => undefined);
  }
  function fail(error: unknown) {
    if (stopped) return;
    listeners.onError(
      error instanceof Error ? error.message : 'Voice connection failed. Leave and join again.',
    );
    leave();
  }
  function attach(call: MediaConnection) {
    if (stopped || calls.has(call.peer)) {
      call.close();
      return;
    }
    calls.set(call.peer, call);
    const connectionTimer = setTimeout(() => {
      if (calls.get(call.peer) === call && !remotes.has(call.peer)) {
        remove(call.peer);
        listeners.onWarning(
          'A direct audio connection could not be established. Try another network.',
        );
      }
    }, 15000);
    call.on('stream', (remoteStream) => {
      const member = roster.find((item) => item.peerId === call.peer);
      if (!member || stopped) {
        call.close();
        return;
      }
      clearTimeout(connectionTimer);
      const previous = remotes.get(call.peer);
      if (previous) {
        previous.audio.pause();
        previous.audio.srcObject = null;
      }
      const audio = new Audio();
      audio.autoplay = true;
      audio.srcObject = remoteStream;
      audio.muted = mutedUsers.has(member.userId);
      const remote: RemoteVoice = { ...member, audio, muted: audio.muted, playing: false };
      remotes.set(call.peer, remote);
      void audio
        .play()
        .then(() => {
          remote.playing = true;
          emit();
          return undefined;
        })
        .catch(() => {
          remote.playing = false;
          emit();
        });
      emit();
      for (const track of remoteStream.getTracks())
        track.addEventListener('ended', () => remove(call.peer), { once: true });
    });
    call.on('close', () => {
      clearTimeout(connectionTimer);
      if (calls.get(call.peer) === call) remove(call.peer);
    });
    call.on('error', () => {
      clearTimeout(connectionTimer);
      if (calls.get(call.peer) === call) remove(call.peer);
    });
  }
  async function refresh(action: 'join' | 'poll') {
    const members = await room(matchId, action, id);
    if (stopped) {
      if (action === 'join') void room(matchId, 'leave', id).catch(() => undefined);
      return;
    }
    joined = true;
    roster = members;
    for (const peerId of calls.keys())
      if (!members.some((member) => member.peerId === peerId)) remove(peerId);
    for (const member of members) {
      if (member.peerId === id || calls.has(member.peerId) || !stream || !peer) continue;
      // Exactly one caller per pair, regardless of who joined first.
      if (id < member.peerId) attach(peer.call(member.peerId, stream));
    }
    if (action === 'join') listeners.onReady();
    timer = setTimeout(() => {
      void refresh('poll').catch(fail);
    }, 3000);
  }
  async function start() {
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error('Microphone access requires HTTPS and a supported browser.');
    const local = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    if (stopped) {
      local.getTracks().forEach((track) => track.stop());
      return;
    }
    stream = local;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
      track.addEventListener(
        'ended',
        () =>
          fail(new Error('Microphone disconnected. Join again to select an available microphone.')),
        { once: true },
      );
    });
    const { Peer: PeerClient } = await import('peerjs');
    if (stopped) return;
    peer = new PeerClient(id, {
      host: location.hostname,
      port: location.port ? Number(location.port) : location.protocol === 'https:' ? 443 : 80,
      path: '/peerjs',
      secure: location.protocol === 'https:',
      config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] },
    });
    openingTimer = setTimeout(
      () => fail(new Error('Voice signaling timed out. Please join again.')),
      20000,
    );
    peer.on('open', () => {
      clearTimeout(openingTimer);
      void refresh('join').catch(fail);
    });
    peer.on('call', (call) => {
      void room(matchId, 'poll', id)
        .then((members) => {
          if (stopped || !stream || !members.some((member) => member.peerId === call.peer)) {
            call.close();
            return undefined;
          }
          roster = members;
          attach(call);
          if (calls.get(call.peer) === call) call.answer(stream);
          return undefined;
        })
        .catch(() => call.close());
    });
    peer.on('error', (error) => {
      if (error.type !== 'peer-unavailable') fail(error);
    });
    peer.on('disconnected', () => {
      if (!stopped) fail(new Error('Voice signaling disconnected. Join again to reconnect.'));
    });
    peer.on('close', () => {
      if (!stopped) fail(new Error('Voice room closed.'));
    });
  }
  void start().catch(fail);
  return {
    leave,
    mute(value) {
      muted = value;
      stream?.getAudioTracks().forEach((track) => {
        track.enabled = !value;
      });
    },
    muteRemote(userId, value) {
      if (value) mutedUsers.add(userId);
      else mutedUsers.delete(userId);
      for (const remote of remotes.values())
        if (remote.userId === userId) {
          remote.audio.muted = value;
          remote.muted = value;
        }
      emit();
    },
    resumeRemote(userId) {
      for (const remote of remotes.values())
        if (remote.userId === userId)
          void remote.audio
            .play()
            .then(() => {
              remote.playing = true;
              emit();
              return undefined;
            })
            .catch(() => listeners.onWarning('Tap the audio control again to enable playback.'));
    },
  };
}
