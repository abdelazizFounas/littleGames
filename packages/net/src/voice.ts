import type { Client, Session } from '@heroiclabs/nakama-js';
export interface VoiceMember {
  userId: string;
  name: string;
  peerId: string;
}
export async function updateVoiceRoom(
  client: Client,
  session: Session,
  matchId: string,
  action: 'join' | 'poll' | 'leave',
  peerId: string,
): Promise<VoiceMember[]> {
  const response = await client.rpc(session, 'voice_room', { matchId, action, peerId });
  const value: unknown = response.payload;
  if (!value || typeof value !== 'object') throw new Error('The voice room is unavailable.');
  if ('error' in value && typeof value.error === 'string') throw new Error(value.error);
  if (!('members' in value) || !Array.isArray(value.members))
    throw new Error('The voice roster is unavailable.');
  return value.members.filter(
    (member: unknown): member is VoiceMember =>
      typeof member === 'object' &&
      member !== null &&
      'userId' in member &&
      typeof member.userId === 'string' &&
      'name' in member &&
      typeof member.name === 'string' &&
      'peerId' in member &&
      typeof member.peerId === 'string',
  );
}
