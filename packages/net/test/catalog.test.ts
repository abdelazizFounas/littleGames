import { describe, expect, it } from 'vitest';
import { toGameSummary } from '../src/catalog';

const validEntry = {
  id: 'pong',
  name: 'Pong',
  tagline: 'Two paddles, one ball.',
  description: 'The original head-to-head duel.',
  minPlayers: 2,
  maxPlayers: 2,
};

describe('toGameSummary', () => {
  it('accepts a complete entry', () => {
    expect(toGameSummary(validEntry)).toEqual(validEntry);
  });

  it('drops anything that is not an object', () => {
    expect(toGameSummary(null)).toBeNull();
    expect(toGameSummary(undefined)).toBeNull();
    expect(toGameSummary('pong')).toBeNull();
    expect(toGameSummary(42)).toBeNull();
    expect(toGameSummary([validEntry])).toBeNull();
  });

  it.each(['id', 'name', 'tagline', 'description', 'minPlayers', 'maxPlayers'])(
    'drops an entry missing %s',
    (field) => {
      const incomplete: Record<string, unknown> = { ...validEntry };
      delete incomplete[field];

      expect(toGameSummary(incomplete)).toBeNull();
    },
  );

  it('drops an entry whose text fields are blank', () => {
    expect(toGameSummary({ ...validEntry, name: '' })).toBeNull();
  });

  it('drops player counts that are not positive whole numbers', () => {
    expect(toGameSummary({ ...validEntry, minPlayers: 0 })).toBeNull();
    expect(toGameSummary({ ...validEntry, minPlayers: 2.5 })).toBeNull();
    expect(toGameSummary({ ...validEntry, maxPlayers: -1 })).toBeNull();
    expect(toGameSummary({ ...validEntry, maxPlayers: '2' })).toBeNull();
  });

  it('drops an entry whose maximum is below its minimum', () => {
    // A console edit can produce this, and it would render as a game nobody
    // could ever start.
    expect(toGameSummary({ ...validEntry, minPlayers: 4, maxPlayers: 2 })).toBeNull();
  });

  it('ignores unknown fields so the catalogue can gain some later', () => {
    expect(toGameSummary({ ...validEntry, comingSoon: true })).toEqual(validEntry);
  });
});
