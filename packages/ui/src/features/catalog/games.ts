export const GAMES = [
  { id: 'arena', name: 'Rift Arena', genre: 'Action', label: 'FPS · 3D DUEL', description: 'Two sides. One showdown. Find your angle and make every shot count.', duration: '5–10 min', color: 'coral', practice: true },
  { id: 'pong', name: 'Neon Pong', genre: 'Arcade', label: 'ARCADE · REFLEXES', description: 'The classic rivalry, with a fresh spark. One more bounce can change everything.', duration: '3–5 min', color: 'violet', practice: true },
  { id: 'battleship', name: 'Fleet Command', genre: 'Strategy', label: 'STRATEGY · NAVAL DUEL', description: 'Hide your fleet, read your rival, and send their last ship to the ocean floor.', duration: '10–15 min', color: 'teal', practice: false },
] as const;
