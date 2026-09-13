export const DIFFICULTIES = ['easy', 'hard', 'extra-hard'] as const;
export type PracticeDifficulty = (typeof DIFFICULTIES)[number];
export const DIFFICULTY_LABELS: Record<PracticeDifficulty, string> = {
  easy: 'Easy',
  hard: 'Hard',
  'extra-hard': 'Extra Hard',
};
export function practiceDifficulty(value: string | null): PracticeDifficulty {
  return value === 'hard' || value === 'extra-hard' ? value : 'easy';
}
export const BOT_SETTINGS = {
  easy: {
    pongReaction: 18,
    pongError: 72,
    pongSpeed: 0.55,
    arenaReaction: 30,
    arenaError: 1.1,
    arenaFire: 110,
    arenaSpeed: 0.5,
  },
  hard: {
    pongReaction: 7,
    pongError: 22,
    pongSpeed: 0.82,
    arenaReaction: 10,
    arenaError: 0.3,
    arenaFire: 45,
    arenaSpeed: 0.8,
  },
  'extra-hard': {
    pongReaction: 2,
    pongError: 4,
    pongSpeed: 1,
    arenaReaction: 3,
    arenaError: 0.06,
    arenaFire: 20,
    arenaSpeed: 1,
  },
} as const;
