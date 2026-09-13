import type { ArtilleryState } from './index';
export interface ArtillerySnapshot {
  version: number;
  state: ArtilleryState;
  seat: number;
  names: string[];
  connected: boolean[];
  remainingSeconds: number;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
function point(value: unknown): boolean {
  return record(value) && finite(value['x']) && finite(value['y']);
}
function pair(value: unknown, check: (item: unknown) => boolean): boolean {
  return Array.isArray(value) && value.length === 2 && value.every(check);
}
export function isArtillerySnapshot(value: unknown): value is ArtillerySnapshot {
  if (
    !record(value) ||
    value['version'] !== 1 ||
    ![0, 1].includes(Number(value['seat'])) ||
    !finite(value['remainingSeconds']) ||
    !pair(value['names'], (item) => typeof item === 'string') ||
    !pair(value['connected'], (item) => typeof item === 'boolean')
  )
    return false;
  const state = value['state'];
  if (
    !record(state) ||
    !['setup', 'playing', 'round-over', 'finished'].includes(String(state['phase'])) ||
    !['round', 'turn', 'turns', 'revision', 'wind', 'winner'].every((key) => finite(state[key]))
  )
    return false;
  const options = state['options'];
  if (
    !record(options) ||
    !['mesa', 'alpine', 'moon'].includes(String(options['map'])) ||
    !['bestOf', 'health', 'wind', 'turnSeconds'].every((key) => finite(options[key]))
  )
    return false;
  if (
    !pair(state['scores'], finite) ||
    !pair(state['ready'], (item) => typeof item === 'boolean') ||
    !pair(
      state['tanks'],
      (item) =>
        record(item) &&
        ['health', 'heavy', 'scatter'].every((key) => finite(item[key])) &&
        typeof item['shield'] === 'boolean' &&
        typeof item['shieldUsed'] === 'boolean',
    )
  )
    return false;
  const shot = state['lastShot'];
  return (
    shot === null ||
    (record(shot) &&
      ['id', 'player', 'angle', 'power'].every((key) => finite(shot[key])) &&
      ['shell', 'heavy', 'scatter'].includes(String(shot['weapon'])) &&
      point(shot['impact']) &&
      pair(shot['damage'], finite) &&
      Array.isArray(shot['path']) &&
      shot['path'].length <= 402 &&
      shot['path'].every(point))
  );
}
