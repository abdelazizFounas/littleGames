import type { NakamaAccount } from '../src/account';
import { describe, expect, it } from 'vitest';
import { displayNameOf, toPlayerProfile } from '../src/account';

describe('toPlayerProfile', () => {
  it('maps a fully populated account', () => {
    const account: NakamaAccount = {
      email: 'player@example.com',
      user: {
        id: 'user-1',
        username: 'brave-otter',
        display_name: 'Brave Otter',
        avatar_url: 'https://example.com/a.png',
      },
    };

    expect(toPlayerProfile(account)).toEqual({
      userId: 'user-1',
      username: 'brave-otter',
      displayName: 'Brave Otter',
      avatarUrl: 'https://example.com/a.png',
      email: 'player@example.com',
      isGuest: false,
    });
  });

  it('treats an account without an email as a guest', () => {
    const account: NakamaAccount = { user: { id: 'user-2', username: 'quiet-fox' } };

    const profile = toPlayerProfile(account);

    expect(profile.isGuest).toBe(true);
    expect(profile.email).toBeNull();
  });

  it('normalises the blank strings Nakama returns for unset fields', () => {
    const account: NakamaAccount = {
      email: '',
      user: { id: 'user-3', username: 'lone-crab', display_name: '', avatar_url: '' },
    };

    const profile = toPlayerProfile(account);

    // Blank and absent must collapse to the same thing, otherwise the UI has
    // to test for both everywhere it shows a player.
    expect(profile.displayName).toBeNull();
    expect(profile.avatarUrl).toBeNull();
    expect(profile.email).toBeNull();
    expect(profile.isGuest).toBe(true);
  });

  it('survives an account with no user block', () => {
    expect(toPlayerProfile({})).toEqual({
      userId: '',
      username: '',
      displayName: null,
      avatarUrl: null,
      email: null,
      isGuest: true,
    });
  });
});

describe('displayNameOf', () => {
  it('prefers the chosen nickname', () => {
    const profile = toPlayerProfile({
      user: { id: 'user-1', username: 'brave-otter', display_name: 'Brave Otter' },
    });

    expect(displayNameOf(profile)).toBe('Brave Otter');
  });

  it('falls back to the generated username', () => {
    const profile = toPlayerProfile({ user: { id: 'user-1', username: 'brave-otter' } });

    expect(displayNameOf(profile)).toBe('brave-otter');
  });
});
