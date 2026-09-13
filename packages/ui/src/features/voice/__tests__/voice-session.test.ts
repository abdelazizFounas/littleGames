import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVoiceSession } from '../voice-session';

afterEach(() => vi.unstubAllGlobals());
const listeners = () => ({
  onReady: vi.fn(),
  onMembers: vi.fn(),
  onError: vi.fn(),
  onWarning: vi.fn(),
});

describe('voice microphone lifecycle', () => {
  it('stops a microphone granted after the player cancels joining', async () => {
    let grant: (value: unknown) => void = vi.fn();
    const pending = new Promise((resolve) => {
      grant = resolve;
    });
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => pending } });
    const room = vi.fn().mockResolvedValue([]);
    const events = listeners();
    const session = createVoiceSession('match', room, events);
    session.leave();
    session.leave();
    const track = { stop: vi.fn() };
    grant({ getTracks: () => [track] });
    await vi.waitFor(() => expect(track.stop).toHaveBeenCalledOnce());
    expect(room).not.toHaveBeenCalled();
    expect(events.onReady).not.toHaveBeenCalled();
    expect(events.onError).not.toHaveBeenCalled();
  });
  it('reports microphone denial without joining or retaining a connection', async () => {
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: () => Promise.reject(new Error('Microphone permission denied.')),
      },
    });
    const room = vi.fn().mockResolvedValue([]);
    const events = listeners();
    const session = createVoiceSession('match', room, events);
    await vi.waitFor(() =>
      expect(events.onError).toHaveBeenCalledWith('Microphone permission denied.'),
    );
    session.leave();
    expect(room).not.toHaveBeenCalled();
    expect(events.onReady).not.toHaveBeenCalled();
  });
});
